import { insertCateringOrder } from "../lib/orders.mjs";
import { fetchNetworkSnapshot } from "../lib/snapshot.mjs";
import { ALERT_Z } from "../lib/spc.mjs";

/** Local/test helper — escalates on SPC ≥2σ or qty > 100; qty must be provided. */
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
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (body.qty == null || Number.isNaN(Number(body.qty))) {
      res.status(400).json({ error: "qty is required" });
      return;
    }

    const result = await insertCateringOrder({
      qty: Number(body.qty),
      when: body.when || "ASAP",
      where: body.where || "the dock, Wynwood",
      item: body.item || "cheese pies",
      channel: body.channel || "phone",
      caseId: body.caseId || null,
      callerLabel: body.callerLabel || "hackathon_judge",
    });

    const snapshot = await fetchNetworkSnapshot();
    res.status(200).json({
      ok: true,
      caseId: result.caseId,
      isMaterial: result.outOfControl,
      outOfControl: result.outOfControl,
      alertZ: ALERT_Z,
      breachSummary: result.breachSummary,
      ownerCall: result.ownerCall
        ? { dialed: result.ownerCall.dialed?.length || 0 }
        : null,
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
