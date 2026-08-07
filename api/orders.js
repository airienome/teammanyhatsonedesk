import { getSql } from "../lib/snapshot.mjs";
import { ALERT_Z } from "../lib/spc.mjs";
import { OWNER_CALL_QTY_THRESHOLD } from "../lib/orders.mjs";
import { serializeReceipt } from "../lib/chain.mjs";
import { explorerTxUrl, getCluster } from "../lib/solana.mjs";

function parseItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseWhenWhere(primary = {}) {
  if (primary.when || primary.where) {
    return { when: primary.when || null, where: primary.where || null };
  }
  const note = String(primary.note || "");
  const parts = note.split(" · ").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return { when: parts[parts.length - 2], where: parts[parts.length - 1] };
  }
  return { when: null, where: null };
}

function chainFromRow(row) {
  if (!row.chain_hash && !row.chain_status) return null;
  const cluster = row.chain_cluster || getCluster();
  const onChain =
    row.chain_status === "anchored" &&
    row.chain_signature &&
    cluster !== "signed";
  return serializeReceipt({
    order_id: row.id,
    payload_hash: row.chain_hash,
    status: row.chain_status,
    signature: row.chain_signature,
    slot: row.chain_slot,
    cluster,
    explorer_url:
      row.chain_explorer_url ||
      (onChain ? explorerTxUrl(row.chain_signature, cluster) : null),
    error: row.chain_error,
    anchored_at: row.chain_anchored_at,
    created_at: row.chain_created_at,
  });
}

function isOutOfControlItem(primary = {}, pizzaCount = 0) {
  return (
    primary.outOfControl === true ||
    primary.outOfControl === "true" ||
    primary.spc?.outOfControl === true ||
    primary.largeCatering === true ||
    pizzaCount > OWNER_CALL_QTY_THRESHOLD
  );
}

function enrichOrder(row) {
  const items = parseItems(row.items_json);
  const primary = items[0] || {};
  const { when, where } = parseWhenWhere(primary);
  const pizzaCount = Number(row.pizza_count) || 0;
  const outOfControl = isOutOfControlItem(primary, pizzaCount);
  return {
    id: row.id,
    storeId: row.store_id,
    storeName: row.store_name,
    neighborhood: row.neighborhood,
    city: row.city,
    address: row.address,
    channel: row.channel,
    status: row.status,
    pizzaCount,
    ticketCents: Number(row.ticket_cents) || 0,
    occurredAt: row.occurred_at,
    items,
    caseId: primary.caseId || null,
    itemLabel: primary.item || (pizzaCount ? `${pizzaCount} panels` : "Order"),
    whenNeeded: when,
    deliveryWhere: where,
    note: primary.note || null,
    isMaterial: outOfControl,
    outOfControl,
    breachSummary: primary.breachSummary || null,
    alertZ: primary.alertZ || ALERT_Z,
    chain: chainFromRow(row),
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }

  try {
    const sql = getSql();
    const storeId = req.query?.storeId || null;
    const orderId = req.query?.id || null;
    const materialOnly =
      req.query?.material === "1" || req.query?.material === "true";
    const limit = Math.min(
      200,
      Math.max(1, Number(req.query?.limit) || 80)
    );

    const orders = orderId
      ? await sql`
          SELECT
            o.*,
            s.name AS store_name,
            s.neighborhood,
            s.city,
            s.address,
            c.payload_hash AS chain_hash,
            c.status AS chain_status,
            c.signature AS chain_signature,
            c.slot AS chain_slot,
            c.explorer_url AS chain_explorer_url,
            c.cluster AS chain_cluster,
            c.error AS chain_error,
            c.anchored_at AS chain_anchored_at,
            c.created_at AS chain_created_at
          FROM pos_orders o
          JOIN stores s ON s.id = o.store_id
          LEFT JOIN chain_receipts c ON c.order_id = o.id
          WHERE o.id = ${orderId}
          LIMIT 1
        `
      : storeId
        ? materialOnly
          ? await sql`
              SELECT
                o.*,
                s.name AS store_name,
                s.neighborhood,
                s.city,
                s.address,
                c.payload_hash AS chain_hash,
                c.status AS chain_status,
                c.signature AS chain_signature,
                c.slot AS chain_slot,
                c.explorer_url AS chain_explorer_url,
                c.cluster AS chain_cluster,
                c.error AS chain_error,
                c.anchored_at AS chain_anchored_at,
                c.created_at AS chain_created_at
              FROM pos_orders o
              JOIN stores s ON s.id = o.store_id
              LEFT JOIN chain_receipts c ON c.order_id = o.id
              WHERE o.store_id = ${storeId}
                AND (
                  (o.items_json->0->>'outOfControl') = 'true'
                  OR o.pizza_count >= s.capacity_pizzas
                )
              ORDER BY o.occurred_at DESC
              LIMIT ${limit}
            `
          : await sql`
              SELECT
                o.*,
                s.name AS store_name,
                s.neighborhood,
                s.city,
                s.address,
                c.payload_hash AS chain_hash,
                c.status AS chain_status,
                c.signature AS chain_signature,
                c.slot AS chain_slot,
                c.explorer_url AS chain_explorer_url,
                c.cluster AS chain_cluster,
                c.error AS chain_error,
                c.anchored_at AS chain_anchored_at,
                c.created_at AS chain_created_at
              FROM pos_orders o
              JOIN stores s ON s.id = o.store_id
              LEFT JOIN chain_receipts c ON c.order_id = o.id
              WHERE o.store_id = ${storeId}
              ORDER BY o.occurred_at DESC
              LIMIT ${limit}
            `
        : materialOnly
          ? await sql`
              SELECT
                o.*,
                s.name AS store_name,
                s.neighborhood,
                s.city,
                s.address,
                c.payload_hash AS chain_hash,
                c.status AS chain_status,
                c.signature AS chain_signature,
                c.slot AS chain_slot,
                c.explorer_url AS chain_explorer_url,
                c.cluster AS chain_cluster,
                c.error AS chain_error,
                c.anchored_at AS chain_anchored_at,
                c.created_at AS chain_created_at
              FROM pos_orders o
              JOIN stores s ON s.id = o.store_id
              LEFT JOIN chain_receipts c ON c.order_id = o.id
              WHERE (
                  (o.items_json->0->>'outOfControl') = 'true'
                  OR o.pizza_count >= s.capacity_pizzas
                )
              ORDER BY o.occurred_at DESC
              LIMIT ${limit}
            `
          : await sql`
              SELECT
                o.*,
                s.name AS store_name,
                s.neighborhood,
                s.city,
                s.address,
                c.payload_hash AS chain_hash,
                c.status AS chain_status,
                c.signature AS chain_signature,
                c.slot AS chain_slot,
                c.explorer_url AS chain_explorer_url,
                c.cluster AS chain_cluster,
                c.error AS chain_error,
                c.anchored_at AS chain_anchored_at,
                c.created_at AS chain_created_at
              FROM pos_orders o
              JOIN stores s ON s.id = o.store_id
              LEFT JOIN chain_receipts c ON c.order_id = o.id
              ORDER BY o.occurred_at DESC
              LIMIT ${limit}
            `;

    const summaryRows = storeId
      ? await sql`
          SELECT
            COUNT(*)::int AS order_count,
            COALESCE(SUM(pizza_count), 0)::int AS pizza_count,
            COALESCE(SUM(ticket_cents), 0)::int AS revenue_cents,
            COALESCE(
              SUM(
                CASE
                  WHEN (items_json->0->>'outOfControl') = 'true' THEN 1
                  ELSE 0
                END
              ),
              0
            )::int AS material_count
          FROM pos_orders
          WHERE store_id = ${storeId}
            AND occurred_at >= date_trunc('day', NOW() AT TIME ZONE 'America/New_York')
              AT TIME ZONE 'America/New_York'
        `
      : await sql`
          SELECT
            COUNT(*)::int AS order_count,
            COALESCE(SUM(pizza_count), 0)::int AS pizza_count,
            COALESCE(SUM(ticket_cents), 0)::int AS revenue_cents,
            COALESCE(
              SUM(
                CASE
                  WHEN (items_json->0->>'outOfControl') = 'true' THEN 1
                  ELSE 0
                END
              ),
              0
            )::int AS material_count
          FROM pos_orders
          WHERE occurred_at >= date_trunc('day', NOW() AT TIME ZONE 'America/New_York')
            AT TIME ZONE 'America/New_York'
        `;

    const byChannel = storeId
      ? await sql`
          SELECT channel, COUNT(*)::int AS count
          FROM pos_orders
          WHERE store_id = ${storeId}
            AND occurred_at >= date_trunc('day', NOW() AT TIME ZONE 'America/New_York')
              AT TIME ZONE 'America/New_York'
          GROUP BY channel
          ORDER BY count DESC
        `
      : await sql`
          SELECT channel, COUNT(*)::int AS count
          FROM pos_orders
          WHERE occurred_at >= date_trunc('day', NOW() AT TIME ZONE 'America/New_York')
            AT TIME ZONE 'America/New_York'
          GROUP BY channel
          ORDER BY count DESC
        `;

    let chainSummary = { pending: 0, anchored: 0, signed: 0, failed: 0 };
    try {
      const chainRows = await sql`
        SELECT status, COUNT(*)::int AS count
        FROM chain_receipts
        GROUP BY status
      `;
      for (const r of chainRows) {
        if (r.status === "pending") chainSummary.pending = Number(r.count) || 0;
        if (r.status === "anchored") chainSummary.anchored = Number(r.count) || 0;
        if (r.status === "signed") chainSummary.signed = Number(r.count) || 0;
        if (r.status === "failed") chainSummary.failed = Number(r.count) || 0;
      }
    } catch {
      /* table may not exist yet on stale deploy */
    }

    const summary = summaryRows[0] || {
      order_count: 0,
      pizza_count: 0,
      revenue_cents: 0,
      material_count: 0,
    };

    res.status(200).json({
      ok: true,
      asOf: new Date().toISOString(),
      alertZ: ALERT_Z,
      summary: {
        orderCount: Number(summary.order_count) || 0,
        pizzaCount: Number(summary.pizza_count) || 0,
        revenueCents: Number(summary.revenue_cents) || 0,
        materialCount: Number(summary.material_count) || 0,
        byChannel: byChannel.map((r) => ({
          channel: r.channel,
          count: Number(r.count) || 0,
        })),
        chain: chainSummary,
      },
      orders: orders.map(enrichOrder),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to load orders" });
  }
}
