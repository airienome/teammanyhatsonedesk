import { neon } from "@neondatabase/serverless";

export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

export async function fetchNetworkSnapshot(sql = getSql()) {
  const stores = await sql`
    SELECT s.*,
      k.revenue_cents, k.orders, k.avg_ticket_cents, k.capacity_util,
      k.refund_rate, k.discount_rate, k.delivery_eta_min, k.staffing_fill,
      k.inventory_days, k.water_gallons_today, k.dough_lbs_today,
      k.phone_calls_today, k.web_sessions_today, k.employees_on_clock,
      k.occurred_at AS kpi_at
    FROM stores s
    LEFT JOIN LATERAL (
      SELECT * FROM kpi_snapshots ks
      WHERE ks.store_id = s.id
      ORDER BY ks.occurred_at DESC
      LIMIT 1
    ) k ON TRUE
    ORDER BY s.name
  `;

  const inventory = await sql`
    SELECT DISTINCT ON (store_id, sku)
      store_id, sku, balance, occurred_at
    FROM inventory_ledger
    ORDER BY store_id, sku, occurred_at DESC
  `;

  const onClock = await sql`
    WITH latest AS (
      SELECT DISTINCT ON (store_id, employee_id)
        store_id, employee_id, event_type, occurred_at
      FROM clock_events
      ORDER BY store_id, employee_id, occurred_at DESC
    )
    SELECT
      l.store_id,
      e.display_name,
      e.role,
      l.occurred_at
    FROM latest l
    JOIN employees e ON e.id = l.employee_id
    WHERE l.event_type = 'clock_in'
    ORDER BY l.store_id, e.display_name
  `;

  const recentEvents = await sql`
    SELECT * FROM store_events
    ORDER BY occurred_at DESC
    LIMIT 40
  `;

  const recentCalls = await sql`
    SELECT * FROM phone_calls
    ORDER BY occurred_at DESC
    LIMIT 20
  `;

  const openCases = await sql`
    SELECT *
    FROM store_events
    WHERE event_type IN ('material_order', 'owner_sms', 'owner_sms_reply', 'coordination')
      AND occurred_at >= NOW() - INTERVAL '2 hours'
    ORDER BY occurred_at DESC
  `;

  const historyRows = await sql`
    SELECT * FROM (
      SELECT
        ks.*,
        ROW_NUMBER() OVER (PARTITION BY store_id ORDER BY occurred_at DESC) AS rn
      FROM kpi_snapshots ks
    ) ranked
    WHERE rn <= 12
    ORDER BY store_id, occurred_at ASC
  `;

  const byStoreInv = {};
  for (const row of inventory) {
    byStoreInv[row.store_id] ??= {};
    byStoreInv[row.store_id][row.sku] = Number(row.balance);
  }

  const byStoreStaff = {};
  for (const row of onClock) {
    byStoreStaff[row.store_id] ??= [];
    byStoreStaff[row.store_id].push(row);
  }

  const byStoreHistory = {};
  for (const row of historyRows) {
    byStoreHistory[row.store_id] ??= {
      revenue: [],
      orders: [],
      avgTicket: [],
      capacityUtil: [],
      refundRate: [],
      discountRate: [],
      deliveryEta: [],
      staffingFill: [],
      inventoryDays: [],
    };
    const h = byStoreHistory[row.store_id];
    h.revenue.push(Number(row.revenue_cents) / 100);
    h.orders.push(Number(row.orders));
    h.avgTicket.push(Number(row.avg_ticket_cents) / 100);
    h.capacityUtil.push(Number(row.capacity_util));
    h.refundRate.push(Number(row.refund_rate));
    h.discountRate.push(Number(row.discount_rate));
    h.deliveryEta.push(Number(row.delivery_eta_min));
    h.staffingFill.push(Number(row.staffing_fill));
    h.inventoryDays.push(Number(row.inventory_days));
  }

  const byStoreCase = {};
  for (const row of openCases) {
    const payload =
      typeof row.payload === "string"
        ? JSON.parse(row.payload || "{}")
        : row.payload || {};
    const storeId = row.store_id;
    const existing = byStoreCase[storeId];

    if (row.event_type === "material_order" && !existing) {
      byStoreCase[storeId] = {
        caseId: payload.caseId || row.id,
        qty: payload.qty || 0,
        when: payload.when || "ASAP",
        where: payload.where || "",
        item: payload.item || "cheese pies",
        value: payload.ticketCents ? payload.ticketCents / 100 : 0,
        status: "awaiting_approval",
        channel: "order",
        eventAt: row.occurred_at,
        breachSummary: payload.breachSummary || null,
      };
      continue;
    }

    if (!byStoreCase[storeId] && payload.caseId) {
      byStoreCase[storeId] = {
        caseId: payload.caseId,
        qty: payload.order?.qty || payload.qty || 0,
        when: payload.order?.when || "ASAP",
        where: payload.order?.where || "",
        item: payload.order?.item || "cheese pies",
        value: payload.order?.ticketCents
          ? payload.order.ticketCents / 100
          : 0,
        status: payload.status || "awaiting_approval",
        channel: payload.channel || row.event_type,
        eventAt: row.occurred_at,
        breachSummary: payload.breachSummary || null,
      };
    }

    const cas = byStoreCase[storeId];
    if (!cas) continue;

    if (row.event_type === "owner_sms") {
      cas.status = payload.status || "awaiting_approval";
      cas.smsSid = payload.sid || null;
      cas.smsAt = row.occurred_at;
      cas.breachSummary = payload.breachSummary || cas.breachSummary;
    }
    if (row.event_type === "owner_sms_reply") {
      cas.status = payload.status || cas.status;
      cas.lastCommand = payload.command || null;
      cas.replyAt = row.occurred_at;
    }
    if (row.event_type === "coordination") {
      cas.status = "coordinating";
      cas.plan = payload.plan || null;
      cas.coordinatedAt = row.occurred_at;
    }
  }

  let sim = null;
  try {
    const simRows = await sql`SELECT * FROM sim_state WHERE id = 1`;
    if (simRows[0]) {
      sim = {
        startedAt: simRows[0].started_at,
        lastTickAt: simRows[0].last_tick_at,
        note: simRows[0].note,
      };
    }
  } catch {
    sim = null;
  }

  return {
    asOf: new Date().toISOString(),
    sim,
    stores: stores.map((s) => ({
      id: s.id,
      name: s.name,
      neighborhood: `${s.neighborhood} · ${s.address}`,
      address: s.address,
      phone: s.phone,
      city: s.city,
      manager: (byStoreStaff[s.id] || [])[0]
        ? `${byStoreStaff[s.id][0].display_name} (${byStoreStaff[s.id][0].role})`
        : "Shift coverage loading",
      capacityPizzas: s.capacity_pizzas,
      vanAvailable: s.van_available,
      inventory: byStoreInv[s.id] || {},
      onClock: byStoreStaff[s.id] || [],
      activeCase: byStoreCase[s.id] || null,
      history: byStoreHistory[s.id] || {
        revenue: [0],
        orders: [0],
        avgTicket: [0],
        capacityUtil: [0],
        refundRate: [0],
        discountRate: [0],
        deliveryEta: [0],
        staffingFill: [0],
        inventoryDays: [0],
      },
      kpis: {
        revenue: (s.revenue_cents || 0) / 100,
        orders: s.orders || 0,
        avgTicket: (s.avg_ticket_cents || 0) / 100,
        capacityUtil: Number(s.capacity_util || 0),
        refundRate: Number(s.refund_rate || 0),
        discountRate: Number(s.discount_rate || 0),
        deliveryEta: Number(s.delivery_eta_min || 0),
        staffingFill: Number(s.staffing_fill || 0),
        inventoryDays: Number(s.inventory_days || 0),
        waterGallonsToday: Number(s.water_gallons_today || 0),
        doughLbsToday: Number(s.dough_lbs_today || 0),
        phoneCallsToday: s.phone_calls_today || 0,
        webSessionsToday: s.web_sessions_today || 0,
        employeesOnClock: s.employees_on_clock || 0,
      },
      kpiAt: s.kpi_at,
    })),
    recentEvents,
    recentCalls,
  };
}

export async function fetchStoreHistory(storeId, sql = getSql()) {
  const history = await sql`
    SELECT *
    FROM kpi_snapshots
    WHERE store_id = ${storeId}
    ORDER BY occurred_at DESC
    LIMIT 48
  `;
  return history.reverse();
}
