import {
  insertCateringOrder,
  OWNER_CALL_QTY_THRESHOLD,
} from "../lib/orders.mjs";
import { fetchNetworkSnapshot } from "../lib/snapshot.mjs";
import { ALERT_Z } from "../lib/spc.mjs";

/**
 * ElevenLabs webhook tool endpoint for Sofia (Plant The Future gallery).
 *
 * Body — qty is required from the agent (whatever the caller ordered):
 * {
 *   "qty": <integer from conversation>,
 *   "when": "ASAP",
 *   "where": "1 Hotel South Beach lobby",
 *   "item": "moss wall panels"
 * }
 *
 * Owner escalation: SPC ≥2σ OR qty > OWNER_CALL_QTY_THRESHOLD (8).
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const qtyRaw = body.qty ?? body.quantity ?? body.pizza_count;
    if (qtyRaw == null || Number.isNaN(Number(qtyRaw))) {
      res.status(400).json({
        error: "qty is required — pass the panel/piece count from the conversation",
      });
      return;
    }

    const qty = Math.max(1, Number(qtyRaw));
    const when = String(body.when ?? body.needed_by ?? "ASAP");
    const where = String(
      body.where ?? body.delivery_location ?? "1 Hotel South Beach lobby"
    );
    const item = String(body.item ?? body.pizza_type ?? "moss wall panels");

    const result = await insertCateringOrder({
      qty,
      when,
      where,
      item,
      channel: "phone",
      callerLabel: body.callerLabel || "elevenlabs_sofia",
      note: `${qty} ${item} · ${when} · ${where}`,
    });

    const snapshot = await fetchNetworkSnapshot();
    const dialed = result.ownerCall?.dialed?.length || 0;
    let escalateNote;
    if (result.largeCatering) {
      escalateNote = ` Large commission (qty > ${OWNER_CALL_QTY_THRESHOLD}): owner alert ${dialed ? "dialed" : "queued/skipped"}.${
        result.spcOutOfControl
          ? ` Also ≥${ALERT_Z}σ: ${result.breachSummary}.`
          : ""
      }`;
    } else if (result.outOfControl) {
      escalateNote = ` Out of statistical control (≥${ALERT_Z}σ): ${result.breachSummary}. Owner alert ${dialed ? "dialed" : "queued/skipped"}.`;
    } else {
      escalateNote = ` KPIs within ${ALERT_Z}σ and qty ≤ ${OWNER_CALL_QTY_THRESHOLD} — owner not called.`;
    }

    res.status(200).json({
      ok: true,
      message:
        (result.fulfillment?.needsHelp
          ? `Order entered at Plant The Future: ${qty} ${item} ${when} to ${where}. Pollinator helping with ${result.fulfillment.helpShare} panels.`
          : `Order entered at Plant The Future: ${qty} ${item} ${when} to ${where}.`) +
        escalateNote,
      caseId: result.caseId,
      isMaterial: result.outOfControl,
      outOfControl: result.outOfControl,
      largeCatering: result.largeCatering,
      ownerCallQtyThreshold: OWNER_CALL_QTY_THRESHOLD,
      alertZ: ALERT_Z,
      breachSummary: result.breachSummary,
      spcFlags: result.spcFlags,
      ownerCall: result.ownerCall
        ? {
            dialed: result.ownerCall.dialed?.length || 0,
            skipped: result.ownerCall.skipped || [],
          }
        : null,
      storeId: result.storeId,
      helpStoreId: result.helpStoreId,
      fulfillment: result.fulfillment,
      qty,
      item,
      when,
      where,
      kpi: {
        capacityUtil: result.kpi.capacityUtil,
        inventoryDays: result.kpi.inventoryDays,
        pizzasToday: result.kpi.pizzasToday,
      },
      snapshot,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Order failed" });
  }
}
