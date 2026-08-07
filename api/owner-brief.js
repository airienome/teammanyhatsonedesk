import { getSql, fetchNetworkSnapshot } from "../lib/snapshot.mjs";
import { ALERT_Z, analyzeStores, summarizeBreach } from "../lib/spc.mjs";

function money(dollars) {
  const n = Number(dollars) || 0;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Voice-friendly OwnerRadar brief — same live numbers as the dashboard.
 * GET|POST /api/owner-brief
 * Optional storeId to focus one shop.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "GET or POST" });
    return;
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};
    const storeId =
      req.query?.storeId ||
      req.query?.store_id ||
      body.storeId ||
      body.store_id ||
      body.args?.storeId ||
      null;

    const sql = getSql();
    const snapshot = await fetchNetworkSnapshot(sql);
    const analysis = analyzeStores(snapshot.stores || []);
    const analyses = analysis.storeAnalyses || [];

    const stores = analyses
      .map((a) => a.store)
      .filter((s) => (storeId ? s.id === storeId : true))
      .map((s) => {
        const a = analyses.find((x) => x.store?.id === s.id);
        const flags = a?.alertFlags || a?.flags || [];
        const ooc = Boolean(a?.outOfControl);
        const k = s.kpis || {};
        // Dashboard "Sales today" uses kpis.revenue in dollars (not cents).
        const revenueDollars = Number(k.revenue ?? 0);
        return {
          id: s.id,
          name: s.name,
          city: s.city,
          neighborhood: s.neighborhood,
          capacityPizzas: s.capacityPizzas ?? s.capacity_pizzas,
          kpis: {
            // Match dashboard KPI card labels
            salesToday: revenueDollars,
            salesTodayFormatted: money(revenueDollars),
            revenue: revenueDollars,
            orders: Number(k.orders ?? 0),
            avgTicket: Number(k.avgTicket ?? 0),
            capacityUtil: Number(k.capacityUtil ?? 0),
            inventoryDays: Number(k.inventoryDays ?? 0),
            deliveryEta: Number(k.deliveryEta ?? 0),
            staffingFill: Number(k.staffingFill ?? 0),
            refundRate: Number(k.refundRate ?? 0),
            discountRate: Number(k.discountRate ?? 0),
            employeesOnClock: Number(k.employeesOnClock ?? 0),
            phoneCallsToday: Number(k.phoneCallsToday ?? 0),
          },
          outOfControl: ooc,
          breachSummary: ooc ? summarizeBreach(a) : null,
          alertFlags: flags.slice(0, 4).map((f) => ({
            kpi: f.kpi || f.label,
            z: f.z,
            plain: `${f.label || f.kpi} ${
              Number(f.z) >= 0 ? "higher" : "lower"
            } than ${f.sourceLabel || "baseline"}`,
          })),
        };
      });

    // Same formula as app/js/stats.js group.revenue / group.orders
    const salesToday = stores.reduce(
      (sum, s) => sum + (s.kpis.salesToday || 0),
      0
    );
    const ordersToday = stores.reduce((sum, s) => sum + (s.kpis.orders || 0), 0);
    const phoneCallsToday = stores.reduce(
      (sum, s) => sum + (s.kpis.phoneCallsToday || 0),
      0
    );

    // Ticket-sum from POS (orders panel "ticket revenue") — secondary figure
    const ticketRows = storeId
      ? await sql`
          SELECT
            COUNT(*)::int AS order_count,
            COALESCE(SUM(pizza_count), 0)::int AS pizza_count,
            COALESCE(SUM(ticket_cents), 0)::int AS revenue_cents
          FROM pos_orders
          WHERE store_id = ${storeId}
            AND occurred_at >= date_trunc('day', NOW() AT TIME ZONE 'America/New_York')
              AT TIME ZONE 'America/New_York'
        `
      : await sql`
          SELECT
            COUNT(*)::int AS order_count,
            COALESCE(SUM(pizza_count), 0)::int AS pizza_count,
            COALESCE(SUM(ticket_cents), 0)::int AS revenue_cents
          FROM pos_orders
          WHERE occurred_at >= date_trunc('day', NOW() AT TIME ZONE 'America/New_York')
            AT TIME ZONE 'America/New_York'
        `;
    const ticket = ticketRows[0] || {
      order_count: 0,
      pizza_count: 0,
      revenue_cents: 0,
    };
    const ticketRevenueDollars = (Number(ticket.revenue_cents) || 0) / 100;

    const recentOrders = await sql`
      SELECT o.id, o.store_id, s.name AS store_name, o.channel, o.pizza_count,
             o.ticket_cents, o.status, o.items_json, o.occurred_at
      FROM pos_orders o
      JOIN stores s ON s.id = o.store_id
      WHERE (${storeId}::text IS NULL OR o.store_id = ${storeId})
      ORDER BY o.occurred_at DESC
      LIMIT 25
    `;

    const catering = recentOrders
      .filter((o) => {
        const item = Array.isArray(o.items_json) ? o.items_json[0] : null;
        return item?.caseId || item?.when || item?.where;
      })
      .slice(0, 10)
      .map((o) => {
        const item = o.items_json[0] || {};
        return {
          id: o.id,
          storeId: o.store_id,
          storeName: o.store_name,
          qty: o.pizza_count,
          item: item.item,
          when: item.when,
          where: item.where,
          caseId: item.caseId,
          outOfControl: item.outOfControl === true,
          breachSummary: item.breachSummary || null,
          occurredAt: o.occurred_at,
        };
      });

    const events = await sql`
      SELECT store_id, event_type, severity, title, body, occurred_at
      FROM store_events
      WHERE event_type NOT IN ('sim_tick')
        AND (${storeId}::text IS NULL OR store_id = ${storeId})
      ORDER BY occurred_at DESC
      LIMIT 15
    `;

    const ooc = stores.filter((s) => s.outOfControl);
    const scope = storeId
      ? stores[0]?.name || storeId
      : "all Joe's shops";

    // Voice answer for "what are total sales?" — matches dashboard "Sales today"
    const salesLine = `Sales today across ${scope}: ${money(
      salesToday
    )} from ${ordersToday.toLocaleString("en-US")} orders.`;

    const alertLine = ooc.length
      ? ` Attention: ${ooc
          .map((s) => `${s.name} — ${s.breachSummary}`)
          .join(". ")}.`
      : ` All watched shops look normal versus peers and their usual week.`;

    const speakable = `${salesLine}${alertLine}`;

    res.status(200).json({
      ok: true,
      asOf: new Date().toISOString(),
      alertZ: ALERT_Z,
      /**
       * Dashboard parity — "Sales today" KPI card uses totals.salesToday.
       * Say totals.salesTodayFormatted when the owner asks for total sales.
       */
      totals: {
        salesToday,
        salesTodayFormatted: money(salesToday),
        ordersToday,
        phoneCallsToday,
        storeCount: stores.length,
        // Secondary (orders panel ticket sum) — different number; only if asked
        ticketRevenueToday: ticketRevenueDollars,
        ticketRevenueTodayFormatted: money(ticketRevenueDollars),
        ticketOrderCount: Number(ticket.order_count) || 0,
        pizzaCountToday: Number(ticket.pizza_count) || 0,
      },
      speakable,
      outOfControlCount: ooc.length,
      stores,
      recentCateringOrders: catering,
      recentEvents: events.map((e) => ({
        storeId: e.store_id,
        type: e.event_type,
        severity: e.severity,
        title: e.title,
        body: e.body,
        at: e.occurred_at,
      })),
      inventorySample: stores.flatMap((s) => {
        const inv =
          (snapshot.stores || []).find((x) => x.id === s.id)?.inventory || {};
        return Object.entries(inv)
          .slice(0, 6)
          .map(([sku, balance]) => ({
            storeId: s.id,
            sku,
            balance,
          }));
      }),
      onClock: stores.flatMap((s) => {
        const staff =
          (snapshot.stores || []).find((x) => x.id === s.id)?.onClock || [];
        return staff.slice(0, 6).map((e) => ({
          storeId: s.id,
          name: e.display_name,
          role: e.role,
        }));
      }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Owner brief failed" });
  }
}
