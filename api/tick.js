import { simulateTick } from "../scripts/simulate.mjs";
import { fetchNetworkSnapshot } from "../lib/snapshot.mjs";

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
    const chain = result?.chain || null;
    const snapshot = await fetchNetworkSnapshot();
    res.status(200).json({ ok: true, summary, chain, snapshot });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Tick failed" });
  }
}
