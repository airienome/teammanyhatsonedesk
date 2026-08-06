import { insertCateringOrder } from "../lib/orders.mjs";
import { fetchNetworkSnapshot } from "../lib/snapshot.mjs";

/**
 * ElevenLabs webhook tool endpoint for Mia (Joe's cashier).
 * Alias of demo-order with the same JSON body contract.
 *
 * Expected body (all optional — defaults are the hackathon path):
 * {
 *   "qty": 300,
 *   "when": "ASAP",
 *   "where": "the dock, Wynwood",
 *   "item": "cheese pies",
 *   "storeId": "miami-wynwood",
 *   "callerLabel": "phone_customer"
 * }
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

    const qty = Number(body.qty ?? body.quantity ?? body.pizza_count ?? 300);
    const when = String(body.when ?? body.needed_by ?? "ASAP");
    const where = String(body.where ?? body.delivery_location ?? "the dock, Wynwood");
    const item = String(body.item ?? body.pizza_type ?? "cheese pies");
    // Always Wynwood — Beach is enlisted automatically when capacity is exceeded
    const storeId = "miami-wynwood";

    const result = await insertCateringOrder({
      storeId,
      qty,
      when,
      where,
      item,
      channel: "phone",
      caseId: qty >= 75 ? "ORDER-300-HACKATHON" : `ORDER-${qty}-${Date.now()}`,
      callerLabel: body.callerLabel || "elevenlabs_mia",
      note: `${qty} ${item} · ${when} · ${where}`,
    });

    const snapshot = await fetchNetworkSnapshot();
    res.status(200).json({
      ok: true,
      message: result.fulfillment?.needsHelp
        ? `Order entered at Miami Wynwood: ${qty} ${item} ${when} to ${where}. Miami Beach helping with ${result.fulfillment.helpShare} pies.`
        : `Order entered at Miami Wynwood: ${qty} ${item} ${when} to ${where}.`,
      caseId: result.caseId,
      isMaterial: result.isMaterial,
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
