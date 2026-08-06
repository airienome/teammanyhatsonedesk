import { placeOwnerCall } from "../lib/call-owner.mjs";

/**
 * Manager tool webhook — OwnerRadar dials the hackathon partner ("owner").
 *
 * Paste into Retell / ElevenLabs as a custom function / webhook tool:
 *   POST https://teammanyhatsonedesk.vercel.app/api/call-owner
 *
 * Body (all optional — pulls from material case defaults):
 * {
 *   "qty": 300,
 *   "when": "ASAP",
 *   "where": "the dock, Wynwood",
 *   "item": "cheese pies",
 *   "caseId": "ORDER-300-HACKATHON",
 *   "to": "+1XXXXXXXXXX"   // optional override; else OWNER_PHONE env
 * }
 */
function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return {};
    }
  }
  return req.body;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  try {
    const body = parseBody(req);
    const args = body.args || body.arguments || body;

    const result = await placeOwnerCall({
      caseId: args.caseId || args.case_id || "ORDER-300-HACKATHON",
      qty: Number(args.qty ?? args.quantity ?? 300),
      when: String(args.when ?? "ASAP"),
      where: String(args.where ?? args.location ?? "the dock, Wynwood"),
      item: String(args.item ?? "cheese pies"),
      storeId: String(args.storeId || args.store_id || "miami-wynwood"),
      toNumber: args.to || args.to_number || args.phone || args.ownerPhone || null,
      reason: String(args.reason || "manager_tool_call_owner"),
    });

    // Voice agents often need a short speakable result
    res.status(200).json({
      ok: true,
      status: "dialing",
      message: result.message,
      caseId: result.caseId,
      provider: result.provider,
      callId: result.callId,
      toMasked: result.toMasked,
    });
  } catch (err) {
    console.error(err);
    const status =
      err.code === "NO_OWNER_PHONE" || err.code === "NO_DIAL_PROVIDER"
        ? 503
        : 500;
    res.status(status).json({
      ok: false,
      error: err.message || "Failed to call owner",
      code: err.code || "CALL_OWNER_FAILED",
    });
  }
}
