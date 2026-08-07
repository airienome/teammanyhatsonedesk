import { handleOwnerSmsReply, textOwnerForOutOfControl } from "../lib/owner-alert.mjs";
import { ALERT_Z } from "../lib/spc.mjs";
import { twilioConfigured, ownerPhone } from "../lib/sms.mjs";

/**
 * Twilio SMS webhook + manual test endpoint.
 *
 * Inbound (Twilio): POST application/x-www-form-urlencoded
 *   Body, From, MessageSid, …
 *   → TwiML reply
 *
 * Manual test: POST JSON
 *   { "action": "alert", "storeId": "plant-the-future" }
 *   { "action": "reply", "body": "APPROVE", "from": "+1…" }
 *
 * Configure Twilio number webhook:
 *   https://YOUR_HOST/api/sms
 */
function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    const raw = req.body;
    // form-urlencoded from Twilio
    if (raw.includes("=") && !raw.trim().startsWith("{")) {
      const params = Object.fromEntries(new URLSearchParams(raw));
      return params;
    }
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return { Body: raw };
    }
  }
  return req.body;
}

function twiml(message) {
  const escaped = String(message)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    res.status(200).json({
      ok: true,
      twilio: twilioConfigured(),
      ownerPhoneSet: Boolean(ownerPhone()),
      alertZ: ALERT_Z,
      hint: "POST from Twilio (form) or JSON { action: 'alert' | 'reply', body: 'APPROVE' }",
      webhook: "/api/sms",
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "GET or POST only" });
    return;
  }

  try {
    const body = parseBody(req);

    // Twilio inbound SMS
    const isTwilioInbound =
      body.Body != null ||
      body.body != null ||
      body.MessageSid ||
      body.SmsSid;

    if (isTwilioInbound && !body.action) {
      const result = await handleOwnerSmsReply({
        from: body.From || body.from,
        body: body.Body || body.body || "",
        messageSid: body.MessageSid || body.SmsSid || null,
      });
      res.setHeader("Content-Type", "text/xml");
      res.status(200).send(twiml(result.replyText));
      return;
    }

    const action = String(body.action || body.args?.action || "alert").toLowerCase();

    if (action === "reply") {
      const result = await handleOwnerSmsReply({
        from: body.from || body.From || ownerPhone(),
        body: body.body || body.Body || body.text || "",
        messageSid: body.messageSid || null,
      });
      res.status(200).json(result);
      return;
    }

    // Manual / agent-triggered SPC → SMS
    const result = await textOwnerForOutOfControl({
      storeId: body.storeId || body.store_id || null,
      caseId: body.caseId || body.case_id || null,
      force: Boolean(body.force),
      toNumber: body.to || body.to_number || null,
      reason: String(body.reason || "spc_out_of_control"),
      order:
        body.qty || body.when || body.where
          ? {
              qty: body.qty != null ? Number(body.qty) : undefined,
              when: body.when,
              where: body.where,
              item: body.item,
              ticketCents: body.ticketCents,
              caseId: body.caseId,
            }
          : null,
    });

    if (!result.texted.length) {
      res.status(200).json({
        ok: true,
        status: "in_control",
        alertZ: ALERT_Z,
        message:
          result.skipped[0]?.message ||
          `No store outside statistical control (≥${ALERT_Z}σ). Owner not texted.`,
        skipped: result.skipped,
        analysis: result.analysis,
      });
      return;
    }

    const first = result.texted[0];
    res.status(200).json({
      ok: true,
      status: "texted",
      alertZ: ALERT_Z,
      message: first.message,
      caseId: first.caseId,
      sid: first.sid,
      toMasked: first.toMasked,
      breachSummary: first.breachSummary,
      texted: result.texted,
      skipped: result.skipped,
      analysis: result.analysis,
    });
  } catch (err) {
    console.error(err);
    const status =
      err.code === "NO_TWILIO" || err.code === "NO_OWNER_PHONE" ? 503 : 500;
    res.status(status).json({
      ok: false,
      error: err.message || "SMS handler failed",
      code: err.code || "SMS_FAILED",
      alertZ: ALERT_Z,
    });
  }
}
