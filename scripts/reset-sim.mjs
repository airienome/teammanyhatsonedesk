import "dotenv/config";
import ws from "ws";
import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import {
  FIRST_NAMES,
  INVENTORY_CATALOG,
  JOES_STORES,
  ROLE_POOL,
} from "../lib/joes.mjs";
import { tickStore } from "./simulate.mjs";
import { defaultSimStart, formatSimClock } from "../lib/sim-time.mjs";

neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = neon(process.env.DATABASE_URL);

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function q(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

console.log("Resetting portfolio sim to a clean dinner service…");

await q(`
  CREATE TABLE IF NOT EXISTS sim_state (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    started_at TIMESTAMPTZ NOT NULL,
    last_tick_at TIMESTAMPTZ,
    note TEXT
  )
`);

for (const table of [
  "store_events",
  "kpi_snapshots",
  "pos_orders",
  "phone_calls",
  "website_hits",
  "utility_readings",
  "inventory_ledger",
  "clock_events",
  "shifts",
  "employees",
  "inventory_items",
]) {
  await q(`TRUNCATE TABLE ${table} CASCADE`);
}

for (const store of JOES_STORES) {
  await q(
    `INSERT INTO stores (
      id, name, neighborhood, address, phone, city,
      capacity_pizzas, van_available, timezone
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      capacity_pizzas = EXCLUDED.capacity_pizzas,
      van_available = EXCLUDED.van_available`,
    [
      store.id,
      store.name,
      store.neighborhood,
      store.address,
      store.phone,
      store.city,
      store.capacity_pizzas,
      store.van_available,
      store.timezone,
    ]
  );
}

const startedAt = defaultSimStart();
const now = new Date();

await q(
  `INSERT INTO sim_state (id, started_at, last_tick_at, note)
   VALUES (1, $1, $1, $2)
   ON CONFLICT (id) DO UPDATE SET
     started_at = EXCLUDED.started_at,
     last_tick_at = EXCLUDED.last_tick_at,
     note = EXCLUDED.note`,
  [
    startedAt.toISOString(),
    "Hackathon dinner service — realistic ops from 7:00 PM ET",
  ]
);

const stores = await sql`SELECT * FROM stores ORDER BY name`;

for (const store of stores) {
  for (const item of INVENTORY_CATALOG) {
    const opening = Number((item.par * rand(0.95, 1.15)).toFixed(2));
    await sql`
      INSERT INTO inventory_items (store_id, sku, label, unit, par_level)
      VALUES (${store.id}, ${item.sku}, ${item.label}, ${item.unit}, ${item.par})
      ON CONFLICT (store_id, sku) DO UPDATE SET par_level = EXCLUDED.par_level
    `;
    await sql`
      INSERT INTO inventory_ledger (store_id, sku, delta, balance, reason, occurred_at)
      VALUES (
        ${store.id}, ${item.sku}, ${opening}, ${opening}, 'opening_balance',
        ${startedAt.toISOString()}
      )
    `;
  }

  const employeeIds = [];
  for (let i = 0; i < 7; i += 1) {
    const role = ROLE_POOL[i % ROLE_POOL.length];
    const name = `${pick(FIRST_NAMES)} ${store.name.split(" ")[0]}-${i + 1}`;
    const rows = await sql`
      INSERT INTO employees (store_id, display_name, role, hourly_rate)
      VALUES (${store.id}, ${name}, ${role}, ${Number(rand(17, 26).toFixed(2))})
      RETURNING id
    `;
    employeeIds.push({ id: rows[0].id, role, name });
  }

  for (let i = 0; i < employeeIds.length; i += 1) {
    const emp = employeeIds[i];
    const start = new Date(startedAt.getTime() - (3 - (i % 3)) * 3600_000);
    const end = new Date(start.getTime() + 8 * 3600_000);
    await sql`
      INSERT INTO shifts (store_id, employee_id, role, starts_at, ends_at)
      VALUES (${store.id}, ${emp.id}, ${emp.role}, ${start.toISOString()}, ${end.toISOString()})
    `;
    if (start <= now && end > now) {
      await sql`
        INSERT INTO clock_events (store_id, employee_id, event_type, occurred_at)
        VALUES (${store.id}, ${emp.id}, 'clock_in', ${start.toISOString()})
      `;
    }
  }

  console.log(`  staffed ${store.name}`);
}

const stepMs = 3 * 60_000;
let cursor = new Date(startedAt);
let steps = 0;
console.log(
  `Backfilling ${formatSimClock(startedAt)} → ${formatSimClock(now)}…`
);

while (cursor < now) {
  for (const store of stores) {
    await tickStore(store, cursor);
  }
  cursor = new Date(cursor.getTime() + stepMs);
  steps += 1;
  if (steps % 10 === 0) process.stdout.write(".");
}

await sql`
  UPDATE sim_state SET last_tick_at = ${now.toISOString()} WHERE id = 1
`;

await pool.end();
console.log(`\nDone. ${steps} pulses from ${formatSimClock(startedAt)}.`);
