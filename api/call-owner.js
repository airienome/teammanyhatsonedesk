import { dialOwnerForOutOfControl } from "../lib/call-owner.mjs";
import { ALERT_Z } from "../lib/spc.mjs";

/**
 * OwnerRadar manager webhook — dials the hackathon partner only when
 * live KPIs are outside statistical control (≥ ALERT_Z σ).
 *
 * POST https://teammanyhatsonedesk.vercel.app/api/call-owner
 *
 * Body (all optional):
 * {
 *   "storeId": "plant-the-future",  // limit to one store; else all OOC stores
 *   "force": false,              // bypass cooldown only (still requires ≥2σ)
 *   "to": "+1XXXXXXXXXX"         // override OWNER_PHONE
 * }
 *
 * Does NOT hardcode order size. If every store is in control, returns
 * status "in_control" and does not dial.
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

    const result = await dialOwnerForOutOfControl({
      storeId: args.storeId || args.store_id || null,
      caseId: args.caseId || args.case_id || null,
      force: Boolean(args.force),
      toNumber: args.to || args.to_number || args.phone || args.ownerPhone || null,
      reason: String(args.reason || "spc_out_of_control"),
      order:
        args.qty || args.when || args.where || args.item
          ? {
              qty: args.qty != null ? Number(args.qty) : undefined,
              when: args.when,
              where: args.where || args.location,
              item: args.item,
              caseId: args.caseId || args.case_id,
            }
          : null,
    });

    if (!result.dialed.length) {
      const skipReason = result.skipped[0]?.reason || "in_statistical_control";
      const status =
        skipReason === "cooldown"
          ? "cooldown"
          : skipReason === "in_statistical_control"
            ? "in_control"
            : "skipped";
      res.status(200).json({
        ok: true,
        status,
        alertZ: ALERT_Z,
        message:
          result.skipped[0]?.message ||
          `No store outside statistical control (≥${ALERT_Z}σ). Owner not called.`,
        skipped: result.skipped,
        analysis: result.analysis,
      });
      return;
    }

    const first = result.dialed[0];
    res.status(200).json({
      ok: true,
      status: "dialing",
      alertZ: ALERT_Z,
      message: first.message,
      caseId: first.caseId,
      provider: first.provider,
      callId: first.callId,
      toMasked: first.toMasked,
      breachSummary: first.breachSummary,
      dialed: result.dialed.map((d) => ({
        storeId: d.storeId,
        storeName: d.storeName,
        caseId: d.caseId,
        breachSummary: d.breachSummary,
        callId: d.callId,
      })),
      skipped: result.skipped,
      analysis: result.analysis,
    });
  } catch (err) {
    console.error(err);
    const status =
      err.code === "NO_OWNER_PHONE" || err.code === "NO_DIAL_PROVIDER"
        ? 503
        : err.code === "IN_CONTROL"
          ? 200
          : 500;
    res.status(status).json({
      ok: err.code === "IN_CONTROL",
      status: err.code === "IN_CONTROL" ? "in_control" : "error",
      error: err.message || "Failed to call owner",
      code: err.code || "CALL_OWNER_FAILED",
      alertZ: ALERT_Z,
    });
  }
}
