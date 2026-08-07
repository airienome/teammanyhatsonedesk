import twilio from "twilio";
import { ALERT_Z } from "./spc.mjs";

const SMS_COOLDOWN_MS = 10 * 60_000;

export function maskPhone(phone) {
  const s = String(phone || "");
  if (s.length < 4) return "****";
  return `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

export function twilioConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      (process.env.TWILIO_FROM_NUMBER?.trim() ||
        process.env.TWILIO_PHONE_NUMBER?.trim())
  );
}

export function ownerPhone() {
  return (
    process.env.OWNER_PHONE?.trim() ||
    process.env.HACKATHON_PARTNER_PHONE?.trim() ||
    null
  );
}

export function getTwilioFrom() {
  return (
    process.env.TWILIO_FROM_NUMBER?.trim() ||
    process.env.TWILIO_PHONE_NUMBER?.trim() ||
    null
  );
}

export function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken) {
    const err = new Error(
      "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required."
    );
    err.code = "NO_TWILIO_CREDS";
    throw err;
  }
  return twilio(accountSid, authToken);
}

export function buildEnrichmentSms({
  name,
  role,
  linkedin,
  publicNotes = [],
} = {}) {
  const notes = (publicNotes || []).slice(0, 2).join(" ");
  const parts = [
    `Found him — ${name || "contact"}`,
    role ? `(${role})` : null,
    linkedin ? `LinkedIn: ${linkedin}` : null,
    notes || null,
  ].filter(Boolean);
  return parts.join(". ").slice(0, 1500);
}

/** Plain-English SPC alert SMS — no σ jargon for the owner. */
export function buildOwnerAlertSms({
  storeName,
  breachSummary,
  order = null,
  caseId = null,
  plan = null,
} = {}) {
  const shop = storeName || "a Joe's location";
  const plain = plainBreach(breachSummary);
  const orderBit = order?.qty
    ? ` After a ${order.qty}-pie catering order${
        order.where ? ` to ${order.where}` : ""
      }.`
    : ".";
  const moneyBit =
    order?.ticketCents != null
      ? ` (~$${Math.round(Number(order.ticketCents) / 100).toLocaleString()})`
      : "";
  const helpBit =
    plan?.needsHelp && plan.helpShare
      ? ` Closest help: Miami Beach can take ~${plan.helpShare} pies.`
      : "";

  const lines = [
    `OwnerRadar: ${shop} looks off vs your other shops${moneyBit}.`,
    `${plain}${orderBit}${helpBit}`.replace(/\.\./g, "."),
    `Reply APPROVE to coordinate, REVIEW for detail, or CALL to talk.`,
  ];
  if (caseId) lines.push(`Case ${caseId}`);
  return lines.filter(Boolean).join("\n");
}

function plainBreach(summary) {
  if (!summary) {
    return `Something material is outside your normal bands (≥${ALERT_Z}σ internally).`;
  }
  const cleaned = String(summary)
    .replace(/[±+]?\d+(\.\d+)?\s*σ/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/;\s*/g, ", ")
    .trim();
  if (!cleaned || cleaned.length < 4) {
    return "Kitchen load / capacity is way outside what's normal for this shop.";
  }
  return `What's off: ${cleaned}.`;
}

/**
 * Send an SMS to the owner (Pablo / OWNER_PHONE) via Twilio.
 * Used by enrichment (/api/text-owner) and SPC alerts.
 */
export async function sendOwnerSms({
  body,
  toNumber = null,
  fromNumber = null,
} = {}) {
  const to = toNumber || ownerPhone();
  const from = fromNumber || getTwilioFrom();

  if (!to) {
    const err = new Error("OWNER_PHONE is not set — cannot text the owner.");
    err.code = "NO_OWNER_PHONE";
    throw err;
  }
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    const err = new Error(
      "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required."
    );
    err.code = "NO_TWILIO_CREDS";
    throw err;
  }
  if (!from) {
    const err = new Error(
      "TWILIO_FROM_NUMBER is required (Twilio SMS-capable number in E.164)."
    );
    err.code = "NO_TWILIO_FROM";
    throw err;
  }
  if (!body || !String(body).trim()) {
    const err = new Error("SMS body is required");
    err.code = "NO_BODY";
    throw err;
  }

  const client = getTwilioClient();
  const msg = await client.messages.create({
    to,
    from,
    body: String(body).trim().slice(0, 1500),
  });

  return {
    ok: true,
    sid: msg.sid || null,
    status: msg.status || "queued",
    toMasked: maskPhone(to),
    fromMasked: maskPhone(from),
    bodyPreview: String(body).slice(0, 120),
    body: String(body),
    to,
    from,
  };
}

/** Alias used by SPC alert path. */
export async function sendSms({ to, body } = {}) {
  return sendOwnerSms({ body, toNumber: to });
}

export async function recentlyTextedOwner(sql, storeId) {
  const since = new Date(Date.now() - SMS_COOLDOWN_MS).toISOString();
  const rows = await sql`
    SELECT id FROM store_events
    WHERE store_id = ${storeId}
      AND event_type IN ('owner_sms', 'owner_sms_sent')
      AND occurred_at >= ${since}
    LIMIT 1
  `;
  return Boolean(rows[0]);
}

/** Parse inbound owner reply into a command. */
export function parseOwnerSmsCommand(rawBody) {
  const text = String(rawBody || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ");

  if (!text) return { command: null, raw: rawBody };

  if (
    /\bAPPROVE\b/.test(text) ||
    text === "YES" ||
    text === "Y" ||
    text === "OK" ||
    text === "GO"
  ) {
    return { command: "APPROVE", raw: rawBody };
  }
  if (/\bREVIEW\b/.test(text) || text === "INFO" || text === "DETAILS") {
    return { command: "REVIEW", raw: rawBody };
  }
  if (
    /\bCALL\b/.test(text) ||
    /\bCALL MANAGER\b/.test(text) ||
    text === "PHONE"
  ) {
    return { command: "CALL", raw: rawBody };
  }
  return { command: "UNKNOWN", raw: rawBody };
}
