import { getSql } from "./snapshot.mjs";

/**
 * Place an outbound alert call to the hackathon partner ("owner").
 * Prefers Retell if configured, else ElevenLabs Twilio outbound.
 */
export async function placeOwnerCall({
  caseId = "ORDER-300-HACKATHON",
  qty = 300,
  when = "ASAP",
  where = "the dock, Wynwood",
  item = "cheese pies",
  storeId = "miami-wynwood",
  toNumber = null,
  reason = "material_order_alert",
} = {}) {
  const to =
    toNumber ||
    process.env.OWNER_PHONE ||
    process.env.HACKATHON_PARTNER_PHONE ||
    null;

  if (!to) {
    const err = new Error(
      "OWNER_PHONE (or HACKATHON_PARTNER_PHONE) is not set — add the partner E.164 number in Vercel env."
    );
    err.code = "NO_OWNER_PHONE";
    throw err;
  }

  const dynamic = {
    case_id: String(caseId),
    qty: String(qty),
    when: String(when),
    where: String(where),
    item: String(item),
    store_id: String(storeId),
    reason: String(reason),
  };

  let provider = null;
  let providerResponse = null;

  if (process.env.RETELL_API_KEY && process.env.RETELL_FROM_NUMBER) {
    provider = "retell";
    const body = {
      from_number: process.env.RETELL_FROM_NUMBER,
      to_number: to,
      retell_llm_dynamic_variables: dynamic,
      metadata: { caseId, reason, storeId },
    };
    if (process.env.RETELL_OWNER_AGENT_ID) {
      body.override_agent_id = process.env.RETELL_OWNER_AGENT_ID;
    }
    const res = await fetch("https://api.retellai.com/v2/create-phone-call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    providerResponse = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(
        providerResponse?.message ||
          providerResponse?.error ||
          `Retell dial failed (${res.status})`
      );
      err.code = "RETELL_DIAL_FAILED";
      err.providerResponse = providerResponse;
      throw err;
    }
  } else if (
    process.env.ELEVENLABS_API_KEY &&
    process.env.ELEVENLABS_OWNER_AGENT_ID &&
    process.env.ELEVENLABS_OWNER_PHONE_NUMBER_ID
  ) {
    provider = "elevenlabs";
    const res = await fetch(
      "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: process.env.ELEVENLABS_OWNER_AGENT_ID,
          agent_phone_number_id: process.env.ELEVENLABS_OWNER_PHONE_NUMBER_ID,
          to_number: to,
          conversation_initiation_client_data: {
            dynamic_variables: dynamic,
          },
        }),
      }
    );
    providerResponse = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(
        providerResponse?.detail ||
          providerResponse?.message ||
          `ElevenLabs dial failed (${res.status})`
      );
      err.code = "ELEVENLABS_DIAL_FAILED";
      err.providerResponse = providerResponse;
      throw err;
    }
  } else {
    const err = new Error(
      "No dial provider configured. Set RETELL_API_KEY + RETELL_FROM_NUMBER (+ optional RETELL_OWNER_AGENT_ID) or ELEVENLABS_API_KEY + ELEVENLABS_OWNER_AGENT_ID + ELEVENLABS_OWNER_PHONE_NUMBER_ID."
    );
    err.code = "NO_DIAL_PROVIDER";
    throw err;
  }

  const callId =
    providerResponse?.call_id ||
    providerResponse?.callId ||
    providerResponse?.conversation_id ||
    providerResponse?.conversationId ||
    null;

  // Mirror into Neon so the command center can show the outbound alert
  try {
    const sql = getSql();
    await sql`
      INSERT INTO phone_calls (
        store_id, direction, duration_sec, outcome, caller_label
      ) VALUES (
        ${storeId},
        'outbound',
        0,
        'owner_alert_dialed',
        ${`owner_partner:${provider}`}
      )
    `;
    await sql`
      INSERT INTO store_events (
        store_id, event_type, severity, title, body, payload
      ) VALUES (
        ${storeId},
        'owner_call',
        'alert',
        'OwnerRadar calling owner (partner)',
        ${`Outbound alert dialed via ${provider} for ${qty} pies · ${where}`},
        ${JSON.stringify({
          caseId,
          qty,
          when,
          where,
          item,
          provider,
          callId,
          toMasked: maskPhone(to),
          reason,
        })}
      )
    `;
  } catch (dbErr) {
    console.error("call-owner DB write failed", dbErr);
  }

  return {
    ok: true,
    dialed: true,
    provider,
    callId,
    toMasked: maskPhone(to),
    caseId,
    qty,
    when,
    where,
    item,
    storeId,
    message: `Calling owner (hackathon partner) about ${qty} ${item} for ${where}.`,
    providerResponse,
  };
}

function maskPhone(phone) {
  const s = String(phone);
  if (s.length < 4) return "****";
  return `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}
