import { getSql } from "../lib/snapshot.mjs";
import { MATERIAL_PIZZA_THRESHOLD } from "../lib/orders.mjs";

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

function enrichOrder(row) {
  const items = parseItems(row.items_json);
  const primary = items[0] || {};
  const { when, where } = parseWhenWhere(primary);
  const pizzaCount = Number(row.pizza_count) || 0;
  const isMaterial = pizzaCount >= MATERIAL_PIZZA_THRESHOLD;
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
    itemLabel: primary.item || (pizzaCount ? `${pizzaCount} pies` : "Order"),
    whenNeeded: when,
    deliveryWhere: where,
    note: primary.note || null,
    isMaterial,
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
            s.address
          FROM pos_orders o
          JOIN stores s ON s.id = o.store_id
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
                s.address
              FROM pos_orders o
              JOIN stores s ON s.id = o.store_id
              WHERE o.store_id = ${storeId}
                AND o.pizza_count >= ${MATERIAL_PIZZA_THRESHOLD}
              ORDER BY o.occurred_at DESC
              LIMIT ${limit}
            `
          : await sql`
              SELECT
                o.*,
                s.name AS store_name,
                s.neighborhood,
                s.city,
                s.address
              FROM pos_orders o
              JOIN stores s ON s.id = o.store_id
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
                s.address
              FROM pos_orders o
              JOIN stores s ON s.id = o.store_id
              WHERE o.pizza_count >= ${MATERIAL_PIZZA_THRESHOLD}
              ORDER BY o.occurred_at DESC
              LIMIT ${limit}
            `
          : await sql`
              SELECT
                o.*,
                s.name AS store_name,
                s.neighborhood,
                s.city,
                s.address
              FROM pos_orders o
              JOIN stores s ON s.id = o.store_id
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
              SUM(CASE WHEN pizza_count >= ${MATERIAL_PIZZA_THRESHOLD} THEN 1 ELSE 0 END),
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
              SUM(CASE WHEN pizza_count >= ${MATERIAL_PIZZA_THRESHOLD} THEN 1 ELSE 0 END),
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

    const summary = summaryRows[0] || {
      order_count: 0,
      pizza_count: 0,
      revenue_cents: 0,
      material_count: 0,
    };

    res.status(200).json({
      ok: true,
      asOf: new Date().toISOString(),
      materialThreshold: MATERIAL_PIZZA_THRESHOLD,
      summary: {
        orderCount: Number(summary.order_count) || 0,
        pizzaCount: Number(summary.pizza_count) || 0,
        revenueCents: Number(summary.revenue_cents) || 0,
        materialCount: Number(summary.material_count) || 0,
        byChannel: byChannel.map((r) => ({
          channel: r.channel,
          count: Number(r.count) || 0,
        })),
      },
      orders: orders.map(enrichOrder),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to load orders" });
  }
}
