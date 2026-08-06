import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import {
  FIRST_NAMES,
  INVENTORY_CATALOG,
  JOES_STORES,
  ROLE_POOL,
} from "../lib/joes.mjs";

const sql = neon(process.env.DATABASE_URL);

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function hoursFromNow(h) {
  return new Date(Date.now() + h * 3600_000);
}

console.log("Seeding Joe's Pizza stores…");

for (const store of JOES_STORES) {
  await sql`
    INSERT INTO stores (
      id, name, neighborhood, address, phone, city,
      capacity_pizzas, van_available, timezone
    ) VALUES (
      ${store.id}, ${store.name}, ${store.neighborhood}, ${store.address},
      ${store.phone}, ${store.city}, ${store.capacity_pizzas},
      ${store.van_available}, ${store.timezone}
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      neighborhood = EXCLUDED.neighborhood,
      address = EXCLUDED.address,
      phone = EXCLUDED.phone,
      capacity_pizzas = EXCLUDED.capacity_pizzas,
      van_available = EXCLUDED.van_available
  `;

  for (const item of INVENTORY_CATALOG) {
    const opening = Number((item.par * rand(0.85, 1.25)).toFixed(2));
    await sql`
      INSERT INTO inventory_items (store_id, sku, label, unit, par_level)
      VALUES (${store.id}, ${item.sku}, ${item.label}, ${item.unit}, ${item.par})
      ON CONFLICT (store_id, sku) DO UPDATE SET
        label = EXCLUDED.label,
        unit = EXCLUDED.unit,
        par_level = EXCLUDED.par_level
    `;
    await sql`
      INSERT INTO inventory_ledger (store_id, sku, delta, balance, reason)
      VALUES (${store.id}, ${item.sku}, ${opening}, ${opening}, 'opening_balance')
    `;
  }

  const employeeIds = [];
  for (let i = 0; i < 8; i += 1) {
    const role = ROLE_POOL[i % ROLE_POOL.length];
    const name = `${pick(FIRST_NAMES)} ${store.name.split(" ")[0]}-${i + 1}`;
    const rows = await sql`
      INSERT INTO employees (store_id, display_name, role, hourly_rate)
      VALUES (${store.id}, ${name}, ${role}, ${Number(rand(16, 28).toFixed(2))})
      RETURNING id
    `;
    employeeIds.push({ id: rows[0].id, role, name });
  }

  // Today's schedule — staggered shifts
  const dayStart = new Date();
  dayStart.setHours(10, 0, 0, 0);
  for (let i = 0; i < employeeIds.length; i += 1) {
    const emp = employeeIds[i];
    const start = new Date(dayStart.getTime() + (i % 4) * 2 * 3600_000);
    const end = new Date(start.getTime() + 8 * 3600_000);
    await sql`
      INSERT INTO shifts (store_id, employee_id, role, starts_at, ends_at)
      VALUES (${store.id}, ${emp.id}, ${emp.role}, ${start.toISOString()}, ${end.toISOString()})
    `;

    // Already clocked in if shift started
    if (start <= new Date() && end > new Date()) {
      await sql`
        INSERT INTO clock_events (store_id, employee_id, event_type, occurred_at)
        VALUES (${store.id}, ${emp.id}, 'clock_in', ${start.toISOString()})
      `;
    }
  }

  // Warm history: last few hours of ops
  for (let h = 6; h >= 0; h -= 1) {
    const at = hoursFromNow(-h);
    const water = Number(rand(8, 22).toFixed(2));
    const dough = Number(rand(12, 35).toFixed(2));
    await sql`
      INSERT INTO utility_readings (
        store_id, water_gallons, gas_therms, electric_kwh, dough_lbs_produced, occurred_at
      ) VALUES (
        ${store.id}, ${water}, ${Number(rand(1, 4).toFixed(2))},
        ${Number(rand(18, 45).toFixed(2))}, ${dough}, ${at.toISOString()}
      )
    `;
    await sql`
      INSERT INTO website_hits (
        store_id, sessions, pageviews, orders_started, orders_completed, occurred_at
      ) VALUES (
        ${store.id},
        ${Math.floor(rand(8, 40))},
        ${Math.floor(rand(20, 120))},
        ${Math.floor(rand(2, 12))},
        ${Math.floor(rand(1, 9))},
        ${at.toISOString()}
      )
    `;
    const callCount = Math.floor(rand(2, 9));
    for (let c = 0; c < callCount; c += 1) {
      await sql`
        INSERT INTO phone_calls (
          store_id, direction, duration_sec, outcome, caller_label, occurred_at
        ) VALUES (
          ${store.id},
          ${Math.random() > 0.15 ? "inbound" : "outbound"},
          ${Math.floor(rand(25, 280))},
          ${pick(["order_taken", "menu_question", "hangup", "catering_inquiry", "complaint"])},
          ${pick(["local", "tourist", "delivery_app", "corporate", "unknown"])},
          ${new Date(at.getTime() + c * 60_000).toISOString()}
        )
      `;
    }
    const orderCount = Math.floor(rand(6, 18));
    for (let o = 0; o < orderCount; o += 1) {
      const pizzas = Math.max(1, Math.floor(rand(1, 4)));
      const ticket = Math.floor(pizzas * rand(1400, 2200));
      await sql`
        INSERT INTO pos_orders (
          store_id, channel, items_json, pizza_count, ticket_cents, status, occurred_at
        ) VALUES (
          ${store.id},
          ${pick(["pos", "web", "phone", "uber_eats", "door_dash"])},
          ${JSON.stringify([{ item: "cheese_pie", qty: pizzas }])},
          ${pizzas},
          ${ticket},
          ${pick(["paid", "paid", "paid", "refunded"])},
          ${new Date(at.getTime() + o * 90_000).toISOString()}
        )
      `;
    }
  }

  console.log(`  seeded ${store.name}`);
}

console.log("Seed complete.");
