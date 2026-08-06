/**
 * Recompute a store's KPI snapshot from live POS / inventory / clocks.
 * Same path for simulator ticks and phone-inserted catering orders.
 */

export async function latestBalance(sql, storeId, sku) {
  const rows = await sql`
    SELECT balance FROM inventory_ledger
    WHERE store_id = ${storeId} AND sku = ${sku}
    ORDER BY occurred_at DESC
    LIMIT 1
  `;
  return rows[0] ? Number(rows[0].balance) : 0;
}

export async function onClockCount(sql, storeId) {
  const rows = await sql`
    WITH latest AS (
      SELECT DISTINCT ON (employee_id)
        employee_id, event_type
      FROM clock_events
      WHERE store_id = ${storeId}
      ORDER BY employee_id, occurred_at DESC
    )
    SELECT COUNT(*)::int AS count FROM latest WHERE event_type = 'clock_in'
  `;
  return rows[0]?.count ?? 0;
}

function startOfDayIso() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/**
 * @param {object} store — row with id + capacity_pizzas
 * @param {{ discountRate?: number, deliveryEta?: number }} [opts]
 */
export async function recomputeStoreKpi(sql, store, opts = {}) {
  const isoDay = startOfDayIso();

  const orderAgg = await sql`
    SELECT
      COALESCE(SUM(ticket_cents), 0)::int AS revenue_cents,
      COUNT(*)::int AS orders,
      COALESCE(AVG(ticket_cents), 0)::int AS avg_ticket_cents,
      COALESCE(SUM(pizza_count), 0)::int AS pizzas,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END), 0)::int AS refunds
    FROM pos_orders
    WHERE store_id = ${store.id} AND occurred_at >= ${isoDay}
  `;
  const callAgg = await sql`
    SELECT COUNT(*)::int AS calls FROM phone_calls
    WHERE store_id = ${store.id} AND occurred_at >= ${isoDay}
  `;
  const webAgg = await sql`
    SELECT COALESCE(SUM(sessions), 0)::int AS sessions FROM website_hits
    WHERE store_id = ${store.id} AND occurred_at >= ${isoDay}
  `;
  const utilAgg = await sql`
    SELECT
      COALESCE(SUM(water_gallons), 0)::float AS water,
      COALESCE(SUM(dough_lbs_produced), 0)::float AS dough
    FROM utility_readings
    WHERE store_id = ${store.id} AND occurred_at >= ${isoDay}
  `;

  const o = orderAgg[0];
  const onClock = await onClockCount(sql, store.id);
  const doughBal = await latestBalance(sql, store.id, "dough");
  const capacity = Math.max(Number(store.capacity_pizzas) || 1, 1);
  // Allow >100 so a 300-pie order is visibly out of band vs peers (~50%)
  const capacityUtil = Number(((Number(o.pizzas) / capacity) * 100).toFixed(1));
  const refundRate = o.orders
    ? Number(((o.refunds / o.orders) * 100).toFixed(2))
    : 0;
  const staffingFill = Number(((onClock / 5) * 100).toFixed(1));
  const inventoryDays = Number(
    (doughBal / Math.max(Number(utilAgg[0].dough) / 8, 8)).toFixed(2)
  );

  const discountRate =
    opts.discountRate ?? Number((1.2 + Math.random() * 1.6).toFixed(2));
  const deliveryEta =
    opts.deliveryEta ??
    (capacityUtil >= 90
      ? Number((45 + Math.random() * 20).toFixed(1))
      : Number((18 + Math.random() * 18).toFixed(1)));

  const rows = await sql`
    INSERT INTO kpi_snapshots (
      store_id, revenue_cents, orders, avg_ticket_cents, capacity_util,
      refund_rate, discount_rate, delivery_eta_min, staffing_fill, inventory_days,
      water_gallons_today, dough_lbs_today, phone_calls_today, web_sessions_today,
      employees_on_clock
    ) VALUES (
      ${store.id},
      ${o.revenue_cents},
      ${o.orders},
      ${o.avg_ticket_cents},
      ${capacityUtil},
      ${refundRate},
      ${discountRate},
      ${deliveryEta},
      ${Math.min(100, staffingFill)},
      ${Math.max(0.05, inventoryDays)},
      ${Number(utilAgg[0].water)},
      ${Number(utilAgg[0].dough)},
      ${callAgg[0].calls},
      ${webAgg[0].sessions},
      ${onClock}
    )
    RETURNING *
  `;

  return {
    snapshot: rows[0],
    pizzasToday: Number(o.pizzas),
    revenueCents: Number(o.revenue_cents),
    capacityUtil,
    inventoryDays: Math.max(0.05, inventoryDays),
  };
}
