import { simulateTick } from "../scripts/simulate.mjs";
import { fetchNetworkSnapshot } from "../lib/snapshot.mjs";
import { dialOwnerForOutOfControl } from "../lib/call-owner.mjs";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const result = await simulateTick();
    const summary = result?.stores || result;
    // Cron hits this every minute — skip heavy snapshot unless client asks
    const wantSnapshot =
      req.method === "POST" ||
      req.query?.snapshot === "1" ||
      req.query?.snapshot === "true";
    const snapshot = await fetchNetworkSnapshot();

    // Proactive OwnerRadar dial when any shop goes ≥2σ (cooldown per store).
    let ownerCall = null;
    try {
      ownerCall = await dialOwnerForOutOfControl({
        snapshot,
        reason: "spc_tick_watch",
      });
    } catch (err) {
      console.warn("[tick] owner dial failed:", err?.message || err);
      ownerCall = { ok: false, error: err.message, code: err.code };
    }

    res.status(200).json({
      ok: true,
      summary,
      chain: result?.chain || null,
      snapshot: wantSnapshot ? snapshot : null,
      ownerCall: {
        dialed: ownerCall?.dialed?.length || 0,
        skipped: ownerCall?.skipped?.length || 0,
        stores: (ownerCall?.dialed || []).map((d) => ({
          storeId: d.storeId,
          storeName: d.storeName,
          callId: d.callId,
          breachSummary: d.breachSummary,
        })),
        error: ownerCall?.error || null,
      },
      tickedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Tick failed" });
  }
}
