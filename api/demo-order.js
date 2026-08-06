import { insertCateringOrder } from "../lib/orders.mjs";
import { fetchNetworkSnapshot } from "../lib/snapshot.mjs";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
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
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const result = await insertCateringOrder({
      storeId: "miami-wynwood",
      qty: body.qty || 300,
      when: body.when || "ASAP",
      where: body.where || "the dock, Wynwood",
      channel: body.channel || "phone",
      caseId: body.caseId || "ORDER-300-HACKATHON",
      callerLabel: body.callerLabel || "hackathon_judge",
    });

    const snapshot = await fetchNetworkSnapshot();
    res.status(200).json({
      ok: true,
      caseId: result.caseId,
      isMaterial: result.isMaterial,
      storeId: result.storeId,
      helpStoreId: result.helpStoreId,
      fulfillment: result.fulfillment,
      kpi: {
        capacityUtil: result.kpi.capacityUtil,
        inventoryDays: result.kpi.inventoryDays,
        pizzasToday: result.kpi.pizzasToday,
        revenueCents: result.kpi.revenueCents,
      },
      snapshot,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Demo order failed" });
  }
}
