import { insertCateringOrder } from "../lib/orders.mjs";
import { fetchNetworkSnapshot } from "../lib/snapshot.mjs";

/**
 * Retell custom function + post-call webhook entry.
 *
 * Custom function args (preferred, mid-call):
 *   { qty, when, where, store_id? }
 *
 * Or call_analyzed payload — we scrape qty/where from analysis / transcript.
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

  const qty = Number(
    args.qty ?? args.quantity ?? analysis.qty ?? analysis.quantity ?? 300
  );
  const when = String(args.when ?? analysis.when ?? "ASAP");
  const where = String(
    args.where ?? args.location ?? analysis.where ?? "the dock, Wynwood"
  );
  const storeId = "miami-wynwood";
  const callId = body.call?.call_id || body.call_id || null;

  return { qty, when, where, storeId, callId };
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

    // Ignore non-order Retell lifecycle events if they hit this URL
    const event = body.event || body.name;
    if (event && !["call_analyzed", "call_ended"].includes(event) && !body.args && !body.qty) {
      // Still allow custom function calls that don't set event
      if (!body.call_analysis && !body.call?.call_analysis) {
        res.status(200).json({ ok: true, ignored: event });
        return;
      }
    }

    const { qty, when, where, storeId, callId } = extractFromRetell(body);
    const result = await insertCateringOrder({
      storeId,
      qty,
      when,
      where,
      channel: "phone",
      caseId: callId ? `CALL-${callId}` : "ORDER-300-HACKATHON",
      callerLabel: "retell_voice",
      note: `${qty} pies · ${when} · ${where}${callId ? ` · call ${callId}` : ""}`,
    });

    const snapshot = await fetchNetworkSnapshot();

    // Retell custom functions often expect a string/JSON result for the LLM
    res.status(200).json({
      ok: true,
      status: "entered",
      message: `Order entered: ${qty} pies ${when} to ${where}. KPIs recomputed — capacity util ${result.kpi.capacityUtil}%.`,
      caseId: result.caseId,
      isMaterial: result.isMaterial,
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
