import {
  insertCateringOrder,
  OWNER_CALL_QTY_THRESHOLD,
} from "../lib/orders.mjs";
import { fetchNetworkSnapshot } from "../lib/snapshot.mjs";
import { ALERT_Z } from "../lib/spc.mjs";

/**
 * Retell custom function + post-call webhook entry.
 * Escalation: SPC ≥2σ OR qty > OWNER_CALL_QTY_THRESHOLD (10).
 */
function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function extractFromRetell(body) {
  const args = body.args || body.arguments || body;
  const analysis =
    body.call?.call_analysis?.custom_analysis_data ||
    body.call_analysis?.custom_analysis_data ||
    {};

  const qtyRaw = args.qty ?? args.quantity ?? analysis.qty ?? analysis.quantity;
  const qty = qtyRaw != null ? Number(qtyRaw) : null;
  const when = String(args.when ?? analysis.when ?? "ASAP");
  const where = String(
    args.where ?? args.location ?? analysis.where ?? "the dock, Wynwood"
  );
  const callId = body.call?.call_id || body.call_id || null;

  return { qty, when, where, callId };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
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

    const event = body.event || body.name;
    if (event && !["call_analyzed", "call_ended"].includes(event) && !body.args && !body.qty) {
      if (!body.call_analysis && !body.call?.call_analysis) {
        res.status(200).json({ ok: true, ignored: event });
        return;
      }
    }

    const { qty, when, where, callId } = extractFromRetell(body);
    if (qty == null || Number.isNaN(qty)) {
      res.status(400).json({
        error: "qty is required — pass the pizza count from the conversation",
      });
      return;
    }

    const result = await insertCateringOrder({
      qty,
      when,
      where,
      channel: "phone",
      caseId: callId ? `CALL-${callId}` : null,
      callerLabel: "retell_voice",
      note: `${qty} pies · ${when} · ${where}${callId ? ` · call ${callId}` : ""}`,
    });

    const snapshot = await fetchNetworkSnapshot();
    const escalateNote = result.largeCatering
      ? ` Large catering (qty > ${OWNER_CALL_QTY_THRESHOLD}) — owner alerted.`
      : result.outOfControl
        ? ` Out of control ≥${ALERT_Z}σ (${result.breachSummary}).`
        : ` Within ${ALERT_Z}σ and qty ≤ ${OWNER_CALL_QTY_THRESHOLD} — owner not called.`;

    res.status(200).json({
      ok: true,
      status: "entered",
      message: `Order entered: ${qty} pies ${when} to ${where}. Capacity util ${result.kpi.capacityUtil}%.${escalateNote}`,
      caseId: result.caseId,
      isMaterial: result.outOfControl,
      outOfControl: result.outOfControl,
      largeCatering: result.largeCatering,
      ownerCallQtyThreshold: OWNER_CALL_QTY_THRESHOLD,
      alertZ: ALERT_Z,
      breachSummary: result.breachSummary,
      ownerCall: result.ownerCall
        ? { dialed: result.ownerCall.dialed?.length || 0 }
        : null,
      kpi: {
        capacityUtil: result.kpi.capacityUtil,
        inventoryDays: result.kpi.inventoryDays,
        pizzasToday: result.kpi.pizzasToday,
      },
      snapshot,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Retell order insert failed" });
  }
}
