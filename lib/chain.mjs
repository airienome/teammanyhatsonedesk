import { createHash } from "node:crypto";
import { getSql } from "./snapshot.mjs";
import {
  explorerTxUrl,
  getCluster,
  getWalletBalanceLamports,
  sendMemo,
  solanaConfigured,
} from "./solana.mjs";

/**
 * Stable canonical payload for an order — any field change breaks the hash.
 */
export function canonicalOrderPayload(order) {
  const items =
    typeof order.items_json === "string"
      ? order.items_json
      : JSON.stringify(order.items_json ?? []);

  return {
    v: 1,
    app: "ownerradar",
    id: order.id,
    store_id: order.store_id,
    channel: order.channel,
    pizza_count: Number(order.pizza_count) || 0,
    ticket_cents: Number(order.ticket_cents) || 0,
    status: order.status,
    occurred_at: new Date(order.occurred_at).toISOString(),
    items_json: items,
  };
}

export function hashOrder(order) {
  const canonical = canonicalOrderPayload(order);
  const body = JSON.stringify(canonical);
  const hash = createHash("sha256").update(body).digest("hex");
  return { hash, canonical, body };
}

function memoForReceipt({ orderId, hash }) {
  return JSON.stringify({
    v: 1,
    app: "ownerradar",
    kind: "pos_order",
    orderId,
    hash,
  });
}

/**
 * Insert a pending chain receipt for an order (idempotent on order_id).
 */
export async function queueOrderAnchor(order) {
  if (!order?.id) return null;
  const sql = getSql();
  const { hash, body } = hashOrder(order);

  const rows = await sql`
    INSERT INTO chain_receipts (
      order_id, payload_hash, payload_json, status, cluster
    ) VALUES (
      ${order.id},
      ${hash},
      ${body}::jsonb,
      'pending',
      ${getCluster()}
    )
    ON CONFLICT (order_id) DO NOTHING
    RETURNING *
  `;

  return rows[0] || null;
}

/**
 * Flush pending receipts onto Solana (memo txs). Safe to call every tick.
 */
export async function flushPendingAnchors({ limit = 20 } = {}) {
  const sql = getSql();
  const pending = await sql`
    SELECT * FROM chain_receipts
    WHERE status IN ('pending', 'failed')
    ORDER BY
      CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
      created_at ASC
    LIMIT ${Math.min(50, Math.max(1, limit))}
  `;

  if (!pending.length) {
    return { attempted: 0, anchored: 0, failed: 0, skipped: 0, results: [] };
  }

  if (!solanaConfigured()) {
    console.warn(
      `[chain] ${pending.length} pending receipt(s) — set SOLANA_SECRET_KEY to anchor on Solana`
    );
    return {
      attempted: 0,
      anchored: 0,
      failed: 0,
      skipped: pending.length,
      results: [],
      reason: "SOLANA_SECRET_KEY not configured",
    };
  }

  const balance = await getWalletBalanceLamports();
  if (balance < 50_000) {
    console.warn(
      `[chain] wallet underfunded (${balance} lamports) — queueing ${pending.length} receipt(s). Fund via https://faucet.solana.com`
    );
    // Keep receipts retryable; don't leave funding misses as hard failures
    for (const row of pending) {
      if (row.status === "failed") {
        await sql`
          UPDATE chain_receipts SET
            status = 'pending',
            error = 'waiting_for_sol'
          WHERE id = ${row.id}
        `;
      }
    }
    return {
      attempted: 0,
      anchored: 0,
      failed: 0,
      skipped: pending.length,
      results: [],
      reason: "wallet_underfunded",
      balance,
    };
  }

  const results = [];
  let anchored = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      const memo = memoForReceipt({
        orderId: row.order_id,
        hash: row.payload_hash,
      });
      const tx = await sendMemo(memo);

      await sql`
        UPDATE chain_receipts SET
          status = 'anchored',
          signature = ${tx.signature},
          slot = ${tx.slot},
          explorer_url = ${tx.explorerUrl},
          cluster = ${tx.cluster},
          error = NULL,
          anchored_at = NOW()
        WHERE id = ${row.id}
      `;

      anchored += 1;
      results.push({
        orderId: row.order_id,
        hash: row.payload_hash,
        signature: tx.signature,
        explorerUrl: tx.explorerUrl,
        status: "anchored",
      });
    } catch (err) {
      failed += 1;
      const message = err?.message || String(err);
      console.error(`[chain] anchor failed for ${row.order_id}:`, message);
      await sql`
        UPDATE chain_receipts SET
          status = 'failed',
          error = ${message.slice(0, 500)}
        WHERE id = ${row.id}
      `;
      results.push({
        orderId: row.order_id,
        hash: row.payload_hash,
        status: "failed",
        error: message,
      });
    }
  }

  return {
    attempted: pending.length,
    anchored,
    failed,
    skipped: 0,
    results,
  };
}

/**
 * Queue + immediately flush a single order (voice / material path).
 */
export async function anchorOrderNow(order) {
  await queueOrderAnchor(order);
  const sql = getSql();
  // Only flush this order's pending row
  const pending = await sql`
    SELECT * FROM chain_receipts
    WHERE order_id = ${order.id} AND status = 'pending'
    LIMIT 1
  `;
  if (!pending[0]) {
    const existing = await sql`
      SELECT * FROM chain_receipts WHERE order_id = ${order.id} LIMIT 1
    `;
    return existing[0] || null;
  }

  if (!solanaConfigured()) {
    return pending[0];
  }

  try {
    const row = pending[0];
    const tx = await sendMemo(
      memoForReceipt({ orderId: row.order_id, hash: row.payload_hash })
    );
    const updated = await sql`
      UPDATE chain_receipts SET
        status = 'anchored',
        signature = ${tx.signature},
        slot = ${tx.slot},
        explorer_url = ${tx.explorerUrl},
        cluster = ${tx.cluster},
        error = NULL,
        anchored_at = NOW()
      WHERE id = ${row.id}
      RETURNING *
    `;
    return updated[0];
  } catch (err) {
    const message = err?.message || String(err);
    const updated = await sql`
      UPDATE chain_receipts SET
        status = 'failed',
        error = ${message.slice(0, 500)}
      WHERE order_id = ${order.id}
      RETURNING *
    `;
    return updated[0];
  }
}

/**
 * Recompute hash from live POS row and compare to stored receipt.
 * Optional `tamper` flips pizza_count to demonstrate mismatch (AC-10).
 */
export async function verifyOrderReceipt(orderId, { tamper = false } = {}) {
  const sql = getSql();
  const orders = await sql`SELECT * FROM pos_orders WHERE id = ${orderId} LIMIT 1`;
  const order = orders[0];
  if (!order) {
    return { ok: false, error: "Order not found" };
  }

  const receipts = await sql`
    SELECT * FROM chain_receipts WHERE order_id = ${orderId} LIMIT 1
  `;
  const receipt = receipts[0];
  if (!receipt) {
    return { ok: false, error: "No chain receipt for this order", orderId };
  }

  const working = { ...order };
  if (tamper) {
    working.pizza_count = Number(working.pizza_count) + 1;
    working.ticket_cents = Number(working.ticket_cents) + 100;
  }

  const { hash, canonical } = hashOrder(working);
  const matches = hash === receipt.payload_hash;

  return {
    ok: true,
    orderId,
    tampered: Boolean(tamper),
    matches,
    verdict: matches
      ? "valid"
      : tamper
        ? "tamper_detected"
        : "hash_mismatch",
    computedHash: hash,
    anchoredHash: receipt.payload_hash,
    receipt: {
      status: receipt.status,
      signature: receipt.signature,
      slot: receipt.slot,
      cluster: receipt.cluster,
      explorerUrl:
        receipt.explorer_url ||
        (receipt.signature
          ? explorerTxUrl(receipt.signature, receipt.cluster || getCluster())
          : null),
      anchoredAt: receipt.anchored_at,
      error: receipt.error,
    },
    canonical,
  };
}

export async function receiptByOrderId(orderId) {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM chain_receipts WHERE order_id = ${orderId} LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Queue receipts for existing POS orders that have none yet.
 */
export async function backfillOrderAnchors({ limit = 200 } = {}) {
  const sql = getSql();
  const missing = await sql`
    SELECT o.*
    FROM pos_orders o
    LEFT JOIN chain_receipts c ON c.order_id = o.id
    WHERE c.id IS NULL
    ORDER BY o.occurred_at DESC
    LIMIT ${Math.min(500, Math.max(1, limit))}
  `;

  let queued = 0;
  for (const order of missing) {
    const row = await queueOrderAnchor(order);
    if (row) queued += 1;
  }
  return { scanned: missing.length, queued };
}

export function serializeReceipt(row) {
  if (!row) return null;
  return {
    orderId: row.order_id,
    hash: row.payload_hash,
    status: row.status,
    signature: row.signature,
    slot: row.slot != null ? Number(row.slot) : null,
    cluster: row.cluster,
    explorerUrl:
      row.explorer_url ||
      (row.signature
        ? explorerTxUrl(row.signature, row.cluster || getCluster())
        : null),
    error: row.error,
    anchoredAt: row.anchored_at,
    createdAt: row.created_at,
  };
}
