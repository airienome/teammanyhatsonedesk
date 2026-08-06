import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function chance(p) {
  return Math.random() < p;
}

async function latestBalance(storeId, sku) {
  const rows = await sql`
    SELECT balance FROM inventory_ledger
    WHERE store_id = ${storeId} AND sku = ${sku}
    ORDER BY occurred_at DESC
    LIMIT 1
  `;
  return rows[0] ? Number(rows[0].balance) : 0;
}

async function onClockCount(storeId) {
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

async function tickStore(store) {
  const now = new Date();
  const events = [];

  // Website traffic pulse
  const sessions = Math.floor(rand(1, 8));
  const pageviews = sessions + Math.floor(rand(2, 18));
  const started = Math.floor(rand(0, 3));
  const completed = Math.min(started, Math.floor(rand(0, 3)));
  await sql`
    INSERT INTO website_hits (
      store_id, sessions, pageviews, orders_started, orders_completed
    ) VALUES (
      ${store.id}, ${sessions}, ${pageviews}, ${started}, ${completed}
    )
  `;
  events.push(`web +${sessions} sess`);

  // Phone calls
  if (chance(0.55)) {
    const outcome = pick([
      "order_taken",
      "menu_question",
      "catering_inquiry",
      "hangup",
      "reservation",
    ]);
    await sql`
      INSERT INTO phone_calls (
        store_id, direction, duration_sec, outcome, caller_label
      ) VALUES (
        ${store.id},
        ${chance(0.85) ? "inbound" : "outbound"},
        ${Math.floor(rand(20, 240))},
        ${outcome},
        ${pick(["local", "tourist", "delivery_app", "corporate", "unknown"])}
      )
    `;
    events.push(`call ${outcome}`);
  }

  // POS orders + dough/water drawdown
  if (chance(0.7)) {
    const pizzas = Math.max(1, Math.floor(rand(1, 5)));
    const ticket = Math.floor(pizzas * rand(1500, 2400));
    await sql`
      INSERT INTO pos_orders (
        store_id, channel, items_json, pizza_count, ticket_cents, status
      ) VALUES (
        ${store.id},
        ${pick(["pos", "web", "phone", "uber_eats", "door_dash"])},
        ${JSON.stringify([{ item: "mixed_pies", qty: pizzas }])},
        ${pizzas},
        ${ticket},
        'paid'
      )
    `;

    const doughUse = Number((pizzas * rand(0.9, 1.2)).toFixed(2));
    const waterUse = Number((pizzas * rand(0.15, 0.35)).toFixed(2));
    const cheeseUse = Number((pizzas * rand(0.4, 0.7)).toFixed(2));

    for (const [sku, delta] of [
      ["dough", -doughUse],
      ["water", -waterUse],
      ["cheese", -cheeseUse],
      ["boxes", -pizzas],
      ["sauce", -Number((pizzas * 0.12).toFixed(2))],
    ]) {
      const bal = await latestBalance(store.id, sku);
      const next = Number((bal + delta).toFixed(3));
      await sql`
        INSERT INTO inventory_ledger (store_id, sku, delta, balance, reason)
        VALUES (${store.id}, ${sku}, ${delta}, ${next}, 'production_use')
      `;
    }

    await sql`
      INSERT INTO utility_readings (
        store_id, water_gallons, gas_therms, electric_kwh, dough_lbs_produced
      ) VALUES (
        ${store.id},
        ${waterUse},
        ${Number(rand(0.1, 0.6).toFixed(2))},
        ${Number(rand(0.8, 2.5).toFixed(2))},
        ${doughUse}
      )
    `;
    events.push(`pos ${pizzas} pies`);
  }

  // Occasional dough remake / water refill / delivery restock
  if (chance(0.12)) {
    const add = Number(rand(8, 25).toFixed(2));
    const bal = await latestBalance(store.id, "dough");
    await sql`
      INSERT INTO inventory_ledger (store_id, sku, delta, balance, reason)
      VALUES (${store.id}, 'dough', ${add}, ${Number((bal + add).toFixed(3))}, 'dough_batch')
    `;
    events.push("dough batch");
  }
  if (chance(0.1)) {
    const add = Number(rand(5, 15).toFixed(2));
    const bal = await latestBalance(store.id, "water");
    await sql`
      INSERT INTO inventory_ledger (store_id, sku, delta, balance, reason)
      VALUES (${store.id}, 'water', ${add}, ${Number((bal + add).toFixed(3))}, 'water_refill')
    `;
    events.push("water refill");
  }

  // Clock in/out based on schedule windows
  const due = await sql`
    SELECT s.employee_id, s.role, s.starts_at, s.ends_at, e.display_name
    FROM shifts s
    JOIN employees e ON e.id = s.employee_id
    WHERE s.store_id = ${store.id}
      AND s.starts_at <= ${now.toISOString()}
      AND s.ends_at >= ${new Date(now.getTime() - 15 * 60_000).toISOString()}
  `;

  for (const shift of due) {
    const latest = await sql`
      SELECT event_type FROM clock_events
      WHERE employee_id = ${shift.employee_id}
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    const last = latest[0]?.event_type;
    const started = new Date(shift.starts_at) <= now;
    const ended = new Date(shift.ends_at) <= now;

    if (started && !ended && last !== "clock_in" && chance(0.35)) {
      await sql`
        INSERT INTO clock_events (store_id, employee_id, event_type)
        VALUES (${store.id}, ${shift.employee_id}, 'clock_in')
      `;
      events.push(`in ${shift.display_name}`);
    }
    if (ended && last === "clock_in" && chance(0.5)) {
      await sql`
        INSERT INTO clock_events (store_id, employee_id, event_type)
        VALUES (${store.id}, ${shift.employee_id}, 'clock_out')
      `;
      events.push(`out ${shift.display_name}`);
    }
  }

  // Roll KPI snapshot from today's activity
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const isoDay = startOfDay.toISOString();

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
  const onClock = await onClockCount(store.id);
  const doughBal = await latestBalance(store.id, "dough");
  const capacityUtil = Math.min(
    99,
    Number(((Number(o.pizzas) / Math.max(store.capacity_pizzas, 1)) * 100).toFixed(1))
  );
  const refundRate = o.orders
    ? Number(((o.refunds / o.orders) * 100).toFixed(2))
    : 0;
  const staffingFill = Number(((onClock / 5) * 100).toFixed(1));
  const inventoryDays = Number((doughBal / Math.max(Number(utilAgg[0].dough) / 8, 8)).toFixed(2));

  await sql`
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
      ${Number(rand(1.2, 2.8).toFixed(2))},
      ${Number(rand(18, 36).toFixed(1))},
      ${Math.min(100, staffingFill)},
      ${Math.max(0.3, inventoryDays)},
      ${Number(utilAgg[0].water)},
      ${Number(utilAgg[0].dough)},
      ${callAgg[0].calls},
      ${webAgg[0].sessions},
      ${onClock}
    )
  `;

  await sql`
    INSERT INTO store_events (store_id, event_type, severity, title, body, payload)
    VALUES (
      ${store.id},
      'sim_tick',
      'info',
      ${`${store.name} pulse`},
      ${events.join(" · ") || "quiet tick"},
      ${JSON.stringify({ events, onClock })}
    )
  `;

  return events;
}

export async function simulateTick() {
  const stores = await sql`SELECT * FROM stores ORDER BY name`;
  const summary = [];
  for (const store of stores) {
    const events = await tickStore(store);
    summary.push({ store: store.id, events });
  }
  return summary;
}

const isMain = process.argv[1] && process.argv[1].endsWith("simulate.mjs");

if (isMain) {
  const intervalMs = Number(process.env.SIM_INTERVAL_MS || 4000);
  console.log(`Simulating Joe's Pizza ops every ${intervalMs}ms…`);
  const run = async () => {
    try {
      const summary = await simulateTick();
      const stamp = new Date().toLocaleTimeString();
      console.log(
        `[${stamp}]`,
        summary.map((s) => `${s.store}:{${s.events.join(",")}}`).join(" | ")
      );
    } catch (err) {
      console.error(err);
    }
  };
  await run();
  setInterval(run, intervalMs);
}
