import { simulateTick } from "../scripts/simulate.mjs";
import { fetchNetworkSnapshot } from "../lib/snapshot.mjs";

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
    const snapshot = wantSnapshot ? await fetchNetworkSnapshot() : null;
    res.status(200).json({
      ok: true,
      summary,
      chain: result?.chain || null,
      snapshot,
      tickedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Tick failed" });
  }
}
