import { verifyOrderReceipt, serializeReceipt, receiptByOrderId } from "../lib/chain.mjs";
import { flushPendingAnchors } from "../lib/chain.mjs";
import { solanaConfigured, getCluster, getRpcUrl } from "../lib/solana.mjs";

/**
 * GET  /api/verify?orderId=…           — recompute hash vs on-chain receipt
 * GET  /api/verify?orderId=…&tamper=1  — demo AC-10 mismatch
 * POST /api/verify { orderId, tamper?, flush? }
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    if (req.method === "POST") {
      const body =
        typeof req.body === "string"
          ? JSON.parse(req.body || "{}")
          : req.body || {};

      if (body.flush) {
        const chain = await flushPendingAnchors({
          limit: Number(body.limit) || 25,
        });
        res.status(200).json({
          ok: true,
          action: "flush",
          configured: solanaConfigured(),
          cluster: getCluster(),
          rpcUrl: getRpcUrl(),
          chain,
        });
        return;
      }

      const orderId = body.orderId || body.id;
      if (!orderId) {
        res.status(400).json({ error: "orderId required" });
        return;
      }
      const result = await verifyOrderReceipt(orderId, {
        tamper: Boolean(body.tamper),
      });
      res.status(result.ok ? 200 : 404).json(result);
      return;
    }

    if (req.method !== "GET") {
      res.status(405).json({ error: "GET or POST only" });
      return;
    }

    const orderId = req.query?.orderId || req.query?.id || null;
    const tamper =
      req.query?.tamper === "1" || req.query?.tamper === "true";

    if (!orderId) {
      // Status endpoint — chain config + optional receipt lookup helper
      res.status(200).json({
        ok: true,
        configured: solanaConfigured(),
        cluster: getCluster(),
        rpcUrl: getRpcUrl(),
        hint: "Pass ?orderId=<uuid> to verify a receipt",
      });
      return;
    }

    if (req.query?.receipt === "1") {
      const row = await receiptByOrderId(orderId);
      res.status(row ? 200 : 404).json({
        ok: Boolean(row),
        receipt: serializeReceipt(row),
      });
      return;
    }

    const result = await verifyOrderReceipt(orderId, { tamper });
    res.status(result.ok ? 200 : 404).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Verify failed" });
  }
}
