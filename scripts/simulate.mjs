import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { latestBalance, recomputeStoreKpi } from "../lib/kpi.mjs";
import { demandMultiplier } from "../lib/sim-time.mjs";
import { flushPendingAnchors, queueOrderAnchor } from "../lib/chain.mjs";

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

async function ensureStock(storeId, sku, minLevel, restockTo) {
  const bal = await latestBalance(sql, storeId, sku);
  if (bal >= minLevel) return bal;
  const add = Number((restockTo - bal).toFixed(2));
  const next = Number((bal + add).toFixed(3));
  await sql`
    INSERT INTO inventory_ledger (store_id, sku, delta, balance, reason, occurred_at)
    VALUES (${storeId}, ${sku}, ${add}, ${next}, 'auto_restock', NOW())
  `;
  return next;
}

/**
 * One realistic pulse for a store at time `at` (defaults to now).
 * Scaled by dinner-rush demand curve — not a firehose every few seconds.
 */
export async function tickStore(store, at = new Date()) {
  const demand = demandMultiplier(at);
  const atIso = at.toISOString();
  const events = [];

  // Light web traffic every tick
  if (chance(0.55 + demand * 0.35)) {
    const sessions = Math.max(1, Math.floor(rand(1, 2 + demand * 5)));
    await sql`
      INSERT INTO website_hits (
        store_id, sessions, pageviews, orders_started, orders_completed, occurred_at
      ) VALUES (
        ${store.id},
        ${sessions},
        ${sessions + Math.floor(rand(1, 8))},
        ${chance(0.35 * demand) ? 1 : 0},
        ${chance(0.22 * demand) ? 1 : 0},
        ${atIso}
      )
    `;
    events.push(`web +${sessions}`);
  }

  // Phone — denser at peak, sparse otherwise
  if (chance(0.12 + demand * 0.28)) {
    const outcome = pick([
      "order_taken",
      "menu_question",
      "menu_question",
      "hangup",
      "catering_inquiry",
      "reservation",
    ]);
    await sql`
      INSERT INTO phone_calls (
        store_id, direction, duration_sec, outcome, caller_label, occurred_at
      ) VALUES (
        ${store.id},
        'inbound',
        ${Math.floor(rand(25, 160))},
        ${outcome},
        ${pick(["local", "tourist", "delivery_app", "unknown"])},
        ${atIso}
      )
    `;
    events.push(`call ${outcome}`);
  }

  // Routine POS: 1–3 pies, never catering-scale
  if (chance(0.18 + demand * 0.45)) {
    const pizzas = chance(0.15 * demand) ? 3 : chance(0.4) ? 2 : 1;
    const ticket = Math.floor(pizzas * rand(1450, 2100));
    const refunded = chance(0.015); // ~1.5% refunds — realistic

    const orderRows = await sql`
      INSERT INTO pos_orders (
        store_id, channel, items_json, pizza_count, ticket_cents, status, occurred_at
      ) VALUES (
        ${store.id},
        ${pick(["pos", "pos", "web", "phone", "uber_eats", "door_dash"])},
        ${JSON.stringify([{ item: "slice_or_pie", qty: pizzas }])},
        ${pizzas},
        ${ticket},
        ${refunded ? "refunded" : "paid"},
        ${atIso}
      )
      RETURNING *
    `;
    try {
      await queueOrderAnchor(orderRows[0]);
    } catch (err) {
      console.warn("[chain] queue failed:", err?.message || err);
    }

    for (const [sku, min, par] of [
      ["dough", 20, 90],
      ["water", 8, 45],
      ["cheese", 12, 55],
      ["sauce", 4, 20],
      ["boxes", 40, 400],
    ]) {
      await ensureStock(store.id, sku, min, par);
    }

    const doughUse = Number((pizzas * rand(0.85, 1.1)).toFixed(2));
    const waterUse = Number((pizzas * rand(0.12, 0.28)).toFixed(2));

    for (const [sku, delta] of [
      ["dough", -doughUse],
      ["water", -waterUse],
      ["cheese", -Number((pizzas * rand(0.35, 0.55)).toFixed(2))],
      ["boxes", -pizzas],
      ["sauce", -Number((pizzas * 0.1).toFixed(2))],
    ]) {
      const bal = await latestBalance(sql, store.id, sku);
      const next = Number(Math.max(0, bal + delta).toFixed(3));
      await sql`
        INSERT INTO inventory_ledger (store_id, sku, delta, balance, reason, occurred_at)
        VALUES (${store.id}, ${sku}, ${delta}, ${next}, 'production_use', ${atIso})
      `;
    }

    await sql`
      INSERT INTO utility_readings (
        store_id, water_gallons, gas_therms, electric_kwh, dough_lbs_produced, occurred_at
      ) VALUES (
        ${store.id},
        ${waterUse},
        ${Number(rand(0.08, 0.35).toFixed(2))},
        ${Number(rand(0.5, 1.8).toFixed(2))},
        ${doughUse},
        ${atIso}
      )
    `;
    events.push(`pos ${pizzas} pie${pizzas > 1 ? "s" : ""}`);
  }

  // Occasional dough batch during service
  if (chance(0.04 + demand * 0.04)) {
    const add = Number(rand(10, 22).toFixed(2));
    const bal = await latestBalance(sql, store.id, "dough");
    await sql`
      INSERT INTO inventory_ledger (store_id, sku, delta, balance, reason, occurred_at)
      VALUES (${store.id}, 'dough', ${add}, ${Number((bal + add).toFixed(3))}, 'dough_batch', ${atIso})
    `;
    events.push("dough batch");
  }

  // Soft clock alignment with shifts
  const due = await sql`
    SELECT s.employee_id, s.starts_at, s.ends_at, e.display_name
    FROM shifts s
    JOIN employees e ON e.id = s.employee_id
    WHERE s.store_id = ${store.id}
      AND s.starts_at <= ${atIso}
      AND s.ends_at >= ${new Date(at.getTime() - 20 * 60_000).toISOString()}
  `;
  for (const shift of due) {
    const latest = await sql`
      SELECT event_type FROM clock_events
      WHERE employee_id = ${shift.employee_id}
      ORDER BY occurred_at DESC LIMIT 1
    `;
    const last = latest[0]?.event_type;
    const started = new Date(shift.starts_at) <= at;
    const ended = new Date(shift.ends_at) <= at;
    if (started && !ended && last !== "clock_in" && chance(0.25)) {
      await sql`
        INSERT INTO clock_events (store_id, employee_id, event_type, occurred_at)
        VALUES (${store.id}, ${shift.employee_id}, 'clock_in', ${atIso})
      `;
      events.push(`in ${shift.display_name.split(" ")[0]}`);
    }
    if (ended && last === "clock_in" && chance(0.4)) {
      await sql`
        INSERT INTO clock_events (store_id, employee_id, event_type, occurred_at)
        VALUES (${store.id}, ${shift.employee_id}, 'clock_out', ${atIso})
      `;
      events.push(`out ${shift.display_name.split(" ")[0]}`);
    }
  }

  await recomputeStoreKpi(sql, store, { at });

  if (events.length) {
    await sql`
      INSERT INTO store_events (store_id, event_type, severity, title, body, payload, occurred_at)
      VALUES (
        ${store.id},
        'sim_tick',
        'info',
        ${`${store.name} pulse`},
        ${events.join(" · ")},
        ${JSON.stringify({ events, demand })},
        ${atIso}
      )
    `;
  }

  return events;
}

export async function simulateTick(at = new Date()) {
  const stores = await sql`SELECT * FROM stores ORDER BY name`;
  const summary = [];
  for (const store of stores) {
    const events = await tickStore(store, at);
    summary.push({ store: store.id, events });
  }
  await sql`
    UPDATE sim_state SET last_tick_at = ${at.toISOString()} WHERE id = 1
  `.catch(() => null);

  // Push queued order hashes onto Solana (memo txs) after the ops pulse
  let chain = { attempted: 0, anchored: 0, failed: 0, skipped: 0 };
  try {
    chain = await flushPendingAnchors({ limit: 25 });
  } catch (err) {
    console.warn("[chain] flush failed:", err?.message || err);
    chain = { ...chain, error: err?.message || String(err) };
  }

  return { stores: summary, chain };
}

const isMain = process.argv[1] && process.argv[1].endsWith("simulate.mjs");

if (isMain) {
  const intervalMs = Number(process.env.SIM_INTERVAL_MS || 20000);
  console.log(`Realistic Joe's sim every ${intervalMs}ms…`);
  const run = async () => {
    try {
      const { stores: summary, chain } = await simulateTick();
      const stamp = new Date().toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
      });
      console.log(
        `[${stamp}]`,
        summary
          .filter((s) => s.events.length)
          .map((s) => `${s.store}:{${s.events.join(",")}}`)
          .join(" | ") || "quiet",
        chain?.anchored || chain?.skipped || chain?.failed
          ? `| chain a=${chain.anchored || 0} f=${chain.failed || 0} s=${chain.skipped || 0}`
          : ""
      );
    } catch (err) {
      console.error(err);
    }
  };
  await run();
  setInterval(run, intervalMs);
}
