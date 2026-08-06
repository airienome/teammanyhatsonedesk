import { fetchNetworkSnapshot } from "../lib/snapshot.mjs";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    const snapshot = await fetchNetworkSnapshot();
    res.status(200).json(snapshot);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to load stores" });
  }
}
