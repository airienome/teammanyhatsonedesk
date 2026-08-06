import { getSql } from "../lib/snapshot.mjs";
import { fetchNetworkSnapshot } from "../lib/snapshot.mjs";

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
    const sql = getSql();
    const storeId = "miami-wynwood";
    const qty = 300;
    const ticket = 4650_00;

    await sql`
      INSERT INTO pos_orders (
        store_id, channel, items_json, pizza_count, ticket_cents, status
      ) VALUES (
        ${storeId},
        'phone',
        ${JSON.stringify([{ item: "cheese_pie", qty, note: "hackathon dock wynwood ASAP" }])},
        ${qty},
        ${ticket},
        'paid'
      )
    `;

    for (const [sku, delta] of [
      ["dough", -qty * 1.05],
      ["water", -qty * 0.22],
      ["cheese", -qty * 0.55],
      ["sauce", -qty * 0.12],
      ["boxes", -qty],
    ]) {
      const balRows = await sql`
        SELECT balance FROM inventory_ledger
        WHERE store_id = ${storeId} AND sku = ${sku}
        ORDER BY occurred_at DESC LIMIT 1
      `;
      const bal = balRows[0] ? Number(balRows[0].balance) : 0;
      await sql`
        INSERT INTO inventory_ledger (store_id, sku, delta, balance, reason)
        VALUES (
          ${storeId}, ${sku}, ${delta}, ${Number((bal + delta).toFixed(3))},
          'ORDER-300-HACKATHON'
        )
      `;
    }

    await sql`
      INSERT INTO utility_readings (
        store_id, water_gallons, gas_therms, electric_kwh, dough_lbs_produced
      ) VALUES (
        ${storeId}, ${qty * 0.22}, 4.5, 28, ${qty * 1.05}
      )
    `;

    await sql`
      INSERT INTO phone_calls (
        store_id, direction, duration_sec, outcome, caller_label
      ) VALUES (
        ${storeId}, 'inbound', 96, 'order_taken', 'hackathon_judge'
      )
    `;

    await sql`
      INSERT INTO store_events (
        store_id, event_type, severity, title, body, payload
      ) VALUES (
        ${storeId},
        'material_order',
        'alert',
        '300-pizza order accepted',
        'Cashier accepted 300 pies ASAP to the dock, Wynwood. Capacity and inventory breached.',
        ${JSON.stringify({ caseId: "ORDER-300-HACKATHON", qty, where: "dock Wynwood" })}
      )
    `;

    // Force a hot KPI snapshot so the store turns red immediately
    await sql`
      INSERT INTO kpi_snapshots (
        store_id, revenue_cents, orders, avg_ticket_cents, capacity_util,
        refund_rate, discount_rate, delivery_eta_min, staffing_fill, inventory_days,
        water_gallons_today, dough_lbs_today, phone_calls_today, web_sessions_today,
        employees_on_clock
      )
      SELECT
        ${storeId},
        COALESCE(SUM(ticket_cents), 0)::int,
        COUNT(*)::int,
        COALESCE(AVG(ticket_cents), 0)::int,
        97,
        1.1,
        1.6,
        55,
        94,
        0.4,
        80,
        320,
        40,
        120,
        5
      FROM pos_orders
      WHERE store_id = ${storeId}
        AND occurred_at >= date_trunc('day', NOW())
    `;

    const snapshot = await fetchNetworkSnapshot();
    res.status(200).json({ ok: true, caseId: "ORDER-300-HACKATHON", snapshot });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Demo order failed" });
  }
}
