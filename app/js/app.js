import { analyzeStores, formatKpi, KPI_DEFS, ALERT_Z } from "./stats.js";
import { createDemoController } from "./demo.js";
import {
  DEMO_ORDER,
  EVENT_ORGANIZER,
  CASHIER_AGENT_PROMPT,
  OWNER_RADAR_AGENT_PROMPT,
} from "../data/stores.js";
import {
  loadTilePrefs,
  saveTilePrefs,
  collapseAllPrefs,
  expandPinnedPrefs,
  toTileStatus,
  statusBadgeLabel,
  tileShell,
} from "./tiles.js";

const state = {
  selectedId: null,
  selectedOrderId: null,
  orderFilter: "all", // all | material | phone | pos
  locationFilter: "all", // all | attention | watch | normal
  locationView: "cards", // cards | table
  locationSearch: "",
  ordersPaused: false,
  followLive: true,
  orderSearch: "",
  paused: false,
  drawer: null, // { type: 'order'|'location'|'metric'|'alert', payload }
  tilePrefs: loadTilePrefs(),
  commandQuery: "",
  stores: [],
  analysis: null,
  feed: { events: [], calls: [], clocks: [] },
  orders: {
    asOf: null,
    summary: {
      orderCount: 0,
      pizzaCount: 0,
      revenueCents: 0,
      materialCount: 0,
      byChannel: [],
    },
    rows: [],
  },
  asOf: null,
  sim: null,
  live: false,
  error: null,
  lastOrderKpi: null,
  prevAlertCount: 0,
};

const el = {
  asOf: document.querySelector("[data-as-of]"),
  networkChip: document.querySelector("[data-network-chip]"),
  networkChipLabel: document.querySelector("[data-network-chip-label]"),
  networkHealth: document.querySelector("[data-network-health]"),
  execKpis: document.querySelector("[data-exec-kpis]"),
  hosts: {
    attention: document.querySelector('[data-tile-host="attention"]'),
    orders: document.querySelector('[data-tile-host="orders"]'),
    locations: document.querySelector('[data-tile-host="locations"]'),
    inventory: document.querySelector('[data-tile-host="inventory"]'),
    labor: document.querySelector('[data-tile-host="labor"]'),
    phone: document.querySelector('[data-tile-host="phone"]'),
    discounts: document.querySelector('[data-tile-host="discounts"]'),
    delivery: document.querySelector('[data-tile-host="delivery"]'),
    utilities: document.querySelector('[data-tile-host="utilities"]'),
    demo: document.querySelector('[data-tile-host="demo"]'),
  },
  drawer: document.querySelector("[data-detail-drawer]"),
  drawerTitle: document.querySelector("[data-drawer-title]"),
  drawerBody: document.querySelector("[data-drawer-body]"),
  drawerBackdrop: document.querySelector("[data-drawer-backdrop]"),
  srLive: document.querySelector("[data-sr-live]"),
  commandInput: document.querySelector("[data-command-input]"),
  pauseBtn: document.querySelector("[data-pause-sim]"),
  replayBtn: document.querySelector("[data-demo-replay]"),
  collapseAll: document.querySelector("[data-collapse-all]"),
  expandPinned: document.querySelector("[data-expand-pinned]"),
};

function apiUrl(path) {
  return new URL(path, window.location.origin).toString();
}

function applySnapshot(snapshot) {
  state.stores = (snapshot.stores || []).map((s) => ({ ...s }));
  state.asOf = snapshot.asOf;
  state.sim = snapshot.sim || null;
  state.analysis = analyzeStores(state.stores);
  state.live = true;
  state.error = null;
}

function maybeEscalateFromLiveOrder() {
  const miami = state.stores.find((s) => s.id === "miami-wynwood");
  const miamiAnalysis = state.analysis?.storeAnalyses.find(
    (a) => a.store.id === "miami-wynwood"
  );
  if (!miami?.activeCase || miamiAnalysis?.status !== "alert") return;

  const ageMs = miami.activeCase.eventAt
    ? Date.now() - new Date(miami.activeCase.eventAt).getTime()
    : Infinity;
  if (ageMs >= 10 * 60_000) return;

  state.selectedId = "miami-wynwood";
  state.orderFilter = "material";
  expandTile("attention", true);
  expandTile("orders", true);
  demo.markEntered?.(miami.activeCase);
  announceCritical(
    `Material order at Miami Wynwood: ${miami.activeCase.qty || DEMO_ORDER.qty} pizzas. Owner attention required.`
  );
}

async function loadSnapshot(fromTick = false) {
  try {
    if (fromTick) {
      const tickRes = await fetch(apiUrl("/api/tick"), { method: "POST" });
      if (tickRes.ok) {
        const tickData = await tickRes.json();
        if (tickData.snapshot) {
          applySnapshot(tickData.snapshot);
          maybeEscalateFromLiveOrder();
          return;
        }
      }
    }
    const res = await fetch(apiUrl("/api/stores"));
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    applySnapshot(data.snapshot || data);
    maybeEscalateFromLiveOrder();
  } catch (err) {
    state.error = err.message;
    state.live = false;
  }
}

async function loadFeed() {
  try {
    const res = await fetch(apiUrl("/api/feed"));
    if (!res.ok) return;
    state.feed = await res.json();
  } catch {
    /* ignore */
  }
}

async function loadOrders() {
  try {
    const params = new URLSearchParams({ limit: "100" });
    if (state.selectedId) params.set("storeId", state.selectedId);
    if (state.orderFilter === "material") params.set("material", "1");
    const res = await fetch(apiUrl(`/api/orders?${params}`));
    if (!res.ok) throw new Error(`orders ${res.status}`);
    const data = await res.json();
    let rows = data.orders || [];
    if (state.orderFilter === "phone") {
      rows = rows.filter((o) => o.channel === "phone");
    } else if (state.orderFilter === "pos") {
      rows = rows.filter((o) => o.channel !== "phone");
    }
    if (state.orderSearch.trim()) {
      const q = state.orderSearch.trim().toLowerCase();
      rows = rows.filter(
        (o) =>
          o.storeName?.toLowerCase().includes(q) ||
          o.caseId?.toLowerCase().includes(q) ||
          o.id?.toLowerCase().includes(q) ||
          String(o.ticketCents / 100).includes(q)
      );
    }
    state.orders = {
      asOf: data.asOf,
      summary: data.summary || state.orders.summary,
      rows,
    };
    if (
      state.selectedOrderId &&
      !rows.some((o) => o.id === state.selectedOrderId)
    ) {
      state.selectedOrderId = rows[0]?.id || null;
    }
  } catch {
    /* keep prior orders */
  }
}

function money(cents) {
  return formatKpi((Number(cents) || 0) / 100, "currency");
}

function timeLabel(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function relativeTime(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return timeLabel(iso);
}

function channelLabel(channel) {
  const map = {
    phone: "Phone",
    web: "Web",
    pos: "Counter",
    counter: "Counter",
    uber_eats: "Uber Eats",
    door_dash: "DoorDash",
  };
  return map[channel] || channel || "POS";
}

function itemDisplay(order) {
  const raw = order.itemLabel || "Order";
  if (raw === "mixed_pies") return "mixed pies";
  return raw;
}

const demo = createDemoController({
  onStage: () => {},
  render: () => render(),
});

function statusLabel(status) {
  if (status === "alert") return "Needs attention";
  if (status === "watch") return "Watch";
  return "Normal";
}

function storeStatus(analysis) {
  return analysis.status;
}

function expandTile(id, expanded = true) {
  state.tilePrefs = {
    ...state.tilePrefs,
    [id]: { ...state.tilePrefs[id], expanded },
  };
  saveTilePrefs(state.tilePrefs);
}

function announceCritical(msg) {
  if (el.srLive) el.srLive.textContent = msg;
}

function networkCounts() {
  if (!state.analysis) {
    return { normal: 0, watch: 0, attention: 0, total: 0 };
  }
  const analyses = state.analysis.storeAnalyses;
  return {
    normal: analyses.filter((a) => a.status === "ok").length,
    watch: analyses.filter((a) => a.status === "watch").length,
    attention: analyses.filter((a) => a.status === "alert").length,
    total: analyses.length,
  };
}

function estimateExposure() {
  if (!state.analysis) return 0;
  let exposure = 0;
  for (const s of state.analysis.suggestions) {
    if (s.severity === "alert") {
      if (s.kpi === "discountRate" || s.kpi === "refundRate") {
        exposure += (s.store?.kpis?.revenue || 0) * 0.02;
      } else if (s.kpi === "inventoryDays") {
        exposure += 800;
      } else {
        exposure += 400;
      }
    }
  }
  const miami = state.stores.find((s) => s.id === "miami-wynwood");
  if (miami?.activeCase) {
    exposure += Number(miami.activeCase.value) || DEMO_ORDER.value;
  }
  return Math.round(exposure);
}

function plainLanguageFlag(flag) {
  const dir =
    flag.z > 0
      ? flag.label.toLowerCase().includes("inventory") ||
        flag.label.toLowerCase().includes("staffing") ||
        flag.label.toLowerCase().includes("revenue") ||
        flag.label.toLowerCase().includes("orders") ||
        flag.label.toLowerCase().includes("ticket")
        ? "higher"
        : "elevated"
      : "lower";
  return `${flag.label} is ${dir} than ${flag.sourceLabel}`;
}

function locationDiagnostic(analysis) {
  const { store, flags, status } = analysis;
  if (store.activeCase && status === "alert") {
    return `Material catering order of ${store.activeCase.qty} pizzas is stressing capacity and inventory.`;
  }
  if (!flags.length) {
    return "Operating within expected ranges versus peers and recent history.";
  }
  const top = flags.slice().sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
  return `${plainLanguageFlag(top)}. ${top.copy.split(". ").slice(1).join(". ") || ""}`.trim();
}

function orderEventTag(order) {
  if (order.isMaterial) return { label: "Large order", tone: "attention" };
  if (order.channel === "phone" && (order.pizzaCount || 0) >= 20) {
    return { label: "Capacity risk", tone: "watch" };
  }
  if ((order.ticketCents || 0) >= 20000) {
    return { label: "Large order", tone: "watch" };
  }
  return { label: "Routine", tone: "normal" };
}

function recentOrdersWindow(minutes = 5) {
  const cutoff = Date.now() - minutes * 60_000;
  return state.orders.rows.filter((o) => {
    const t = o.occurredAt ? new Date(o.occurredAt).getTime() : 0;
    return t >= cutoff;
  });
}

/* ───────── Drawer ───────── */

function openDrawer(type, payload) {
  state.drawer = { type, payload };
  renderDrawer();
}

function closeDrawer() {
  state.drawer = null;
  if (el.drawer) el.drawer.hidden = true;
  if (el.drawerBackdrop) el.drawerBackdrop.hidden = true;
  document.body.classList.remove("drawer-open");
}

function renderDrawer() {
  if (!state.drawer || !el.drawer) {
    closeDrawer();
    return;
  }
  const { type, payload } = state.drawer;
  el.drawer.hidden = false;
  el.drawerBackdrop.hidden = false;
  document.body.classList.add("drawer-open");

  if (type === "order") {
    el.drawerTitle.textContent = "Order detail";
    el.drawerBody.innerHTML = orderDetailHtml(payload);
  } else if (type === "location") {
    el.drawerTitle.textContent = payload.store?.name || "Location";
    el.drawerBody.innerHTML = locationDetailHtml(payload);
  } else if (type === "metric") {
    el.drawerTitle.textContent = payload.label || "Metric";
    el.drawerBody.innerHTML = metricDetailHtml(payload);
  } else if (type === "alert") {
    el.drawerTitle.textContent = "Alert evidence";
    el.drawerBody.innerHTML = alertDetailHtml(payload);
  }

  el.drawerBody.querySelectorAll("[data-jump-store]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-jump-store");
      state.selectedId = id;
      const analysis = state.analysis?.storeAnalyses.find(
        (a) => a.store.id === id
      );
      if (analysis) openDrawer("location", analysis);
      else loadOrders().then(render);
    });
  });

  el.drawerBody.querySelectorAll("[data-metric-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-metric-key");
      const storeId = btn.getAttribute("data-store-id");
      openMetricDrawer(key, storeId);
    });
  });

  el.drawerBody.querySelectorAll("[data-loc-section]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.getAttribute("data-loc-section");
      el.drawerBody
        .querySelectorAll("[data-loc-panel]")
        .forEach((p) => p.classList.toggle("is-active", p.getAttribute("data-loc-panel") === section));
      el.drawerBody
        .querySelectorAll("[data-loc-section]")
        .forEach((b) =>
          b.classList.toggle("is-active", b.getAttribute("data-loc-section") === section)
        );
    });
  });
}

function orderDetailHtml(order) {
  if (!order) return `<p class="empty-copy">Order not found.</p>`;
  const tag = orderEventTag(order);
  const store = state.stores.find((s) => s.id === order.storeId);
  const relatedCall = (state.feed.calls || []).find(
    (c) => c.store_id === order.storeId
  );
  return `
    <div class="drawer-status-row">
      <span class="status-badge status-${tag.tone}">${tag.label}</span>
      <span class="muted">${timeLabel(order.occurredAt)}</span>
    </div>
    <p class="drawer-lead">${order.storeName} · ${order.pizzaCount} × ${itemDisplay(order)} · ${money(order.ticketCents)}</p>

    <div class="metric-mini-grid">
      <div class="metric-mini"><span>Channel</span><strong>${channelLabel(order.channel)}</strong></div>
      <div class="metric-mini"><span>Payment</span><strong>${order.status || "Accepted"}</strong></div>
      <div class="metric-mini"><span>When needed</span><strong>${order.whenNeeded || "—"}</strong></div>
      <div class="metric-mini"><span>Delivery / pickup</span><strong>${order.deliveryWhere || "—"}</strong></div>
    </div>

    <h3 class="drawer-h">Line items</h3>
    <ul class="ops-list">
      ${(order.items || [])
        .map(
          (line) =>
            `<li><span>${
              (line.item || "Item") === "mixed_pies" ? "mixed pies" : line.item || "Item"
            }${line.qty ? ` × ${line.qty}` : ""}</span><strong>${
              line.qty && order.pizzaCount
                ? money(Math.round((order.ticketCents / order.pizzaCount) * (line.qty || 0)))
                : money(order.ticketCents)
            }</strong></li>`
        )
        .join("") || "<li><span>No line items</span><strong>—</strong></li>"}
    </ul>

    ${
      order.caseId
        ? `<h3 class="drawer-h">Technical details</h3>
           <dl class="fact-list">
             <div><dt>Case ID</dt><dd class="mono">${order.caseId}</dd></div>
             <div><dt>Order ID</dt><dd class="mono">${order.id}</dd></div>
             ${order.note ? `<div><dt>Note</dt><dd>${order.note}</dd></div>` : ""}
           </dl>`
        : ""
    }

    <h3 class="drawer-h">AI analysis</h3>
    <p class="insight-copy">
      ${
        order.isMaterial
          ? `This order is ${Math.round(((order.pizzaCount || 0) / (store?.capacityPizzas || 100)) * 100)}% of typical daily capacity at ${order.storeName}. Inventory draw and staffing should be confirmed before evening peak.`
          : `Within normal ticket and volume patterns for ${order.storeName}. No owner action required.`
      }
    </p>
    ${
      order.isMaterial
        ? `<p class="action-rec"><strong>Recommended:</strong> confirm dough/cheese cover, stage overflow to a sister location if needed, and notify the GM.</p>`
        : ""
    }

    ${
      relatedCall
        ? `<h3 class="drawer-h">Related phone activity</h3>
           <p class="muted">${relatedCall.direction || "call"} · ${timeLabel(relatedCall.started_at || relatedCall.occurred_at)}</p>`
        : ""
    }

    <div class="drawer-actions">
      <button type="button" class="btn btn-primary" data-jump-store="${order.storeId}">Open ${order.storeName}</button>
    </div>
  `;
}

function locationDetailHtml(analysis) {
  if (!analysis) return `<p class="empty-copy">Location not found.</p>`;
  const { store, flags } = analysis;
  const status = storeStatus(analysis);
  const inv = store.inventory || {};
  const narrative = locationDiagnostic(analysis);
  const topAlert = flags.slice().sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];

  const sections = [
    { id: "overview", label: "Overview" },
    { id: "orders", label: "Live Orders" },
    { id: "revenue", label: "Revenue" },
    { id: "inventory", label: "Inventory" },
    { id: "staffing", label: "Staffing" },
    { id: "calls", label: "Calls" },
    { id: "discounts", label: "Discounts" },
    { id: "delivery", label: "Delivery" },
    { id: "utilities", label: "Utilities" },
    { id: "ai", label: "AI Findings" },
  ];

  return `
    <div class="drawer-status-row">
      <span class="status-badge status-${toTileStatus(status)}">${statusLabel(status)}</span>
      <span class="muted">${store.city || store.neighborhood || ""}</span>
    </div>
    <p class="drawer-lead">${narrative}</p>
    ${
      topAlert
        ? `<p class="action-rec"><strong>Primary alert:</strong> ${plainLanguageFlag(topAlert)}</p>`
        : ""
    }

    <div class="metric-mini-grid">
      <button type="button" class="metric-mini is-clickable" data-metric-key="revenue" data-store-id="${store.id}">
        <span>Revenue</span><strong>${formatKpi(store.kpis.revenue, "currency")}</strong>
      </button>
      <button type="button" class="metric-mini is-clickable" data-metric-key="orders" data-store-id="${store.id}">
        <span>Orders</span><strong>${formatKpi(store.kpis.orders, "number")}</strong>
      </button>
      <button type="button" class="metric-mini is-clickable" data-metric-key="avgTicket" data-store-id="${store.id}">
        <span>Avg ticket</span><strong>${formatKpi(store.kpis.avgTicket, "currency")}</strong>
      </button>
      <div class="metric-mini"><span>On clock</span><strong>${store.kpis.employeesOnClock || 0}</strong></div>
      <button type="button" class="metric-mini is-clickable" data-metric-key="capacityUtil" data-store-id="${store.id}">
        <span>Capacity</span><strong>${formatKpi(store.kpis.capacityUtil, "percent")}</strong>
      </button>
      <div class="metric-mini"><span>Calls</span><strong>${store.kpis.phoneCallsToday || 0}</strong></div>
    </div>

    <div class="loc-tabs" role="tablist">
      ${sections
        .map(
          (s, i) =>
            `<button type="button" class="loc-tab ${i === 0 ? "is-active" : ""}" data-loc-section="${s.id}" role="tab">${s.label}</button>`
        )
        .join("")}
    </div>

    <div class="loc-panels">
      <div data-loc-panel="overview" class="loc-panel is-active">
        <p class="muted">${store.manager || ""}${store.phone ? ` · ${store.phone}` : ""}</p>
        <p class="muted">${store.address || store.neighborhood || ""}</p>
        ${
          store.activeCase
            ? `<div class="insight-box attention">
                <strong>Active material case</strong>
                <p>${store.activeCase.qty} pies · ${store.activeCase.when || "ASAP"} · ${store.activeCase.where || ""}</p>
              </div>`
            : ""
        }
      </div>
      <div data-loc-panel="orders" class="loc-panel">
        <p class="muted">Filter live orders to this location from the Live Orders tile, or open recent tickets below.</p>
        <ul class="ops-list">
          ${state.orders.rows
            .filter((o) => o.storeId === store.id)
            .slice(0, 8)
            .map(
              (o) =>
                `<li><span>${timeLabel(o.occurredAt)} · ${o.pizzaCount} × ${itemDisplay(o)}</span><strong>${money(o.ticketCents)}</strong></li>`
            )
            .join("") || "<li><span>No recent orders loaded</span><strong>—</strong></li>"}
        </ul>
      </div>
      <div data-loc-panel="revenue" class="loc-panel">
        ${KPI_DEFS.filter((d) => ["revenue", "orders", "avgTicket"].includes(d.key))
          .map((def) => kpiRowHtml(store, def, flags))
          .join("")}
      </div>
      <div data-loc-panel="inventory" class="loc-panel">
        ${kpiRowHtml(store, KPI_DEFS.find((d) => d.key === "inventoryDays"), flags)}
        <ul class="ops-list">
          ${Object.entries(inv)
            .map(([sku, bal]) => `<li><span>${sku}</span><strong>${Number(bal).toFixed(1)}</strong></li>`)
            .join("") || "<li>No ledger yet</li>"}
        </ul>
      </div>
      <div data-loc-panel="staffing" class="loc-panel">
        ${kpiRowHtml(store, KPI_DEFS.find((d) => d.key === "staffingFill"), flags)}
        <h4 class="drawer-h">On the clock</h4>
        <ul class="ops-list">
          ${(store.onClock || [])
            .map((p) => `<li><span>${p.display_name}</span><strong>${p.role}</strong></li>`)
            .join("") || "<li>None clocked in</li>"}
        </ul>
      </div>
      <div data-loc-panel="calls" class="loc-panel">
        <div class="metric-mini"><span>Phone calls today</span><strong>${store.kpis.phoneCallsToday || 0}</strong></div>
        <ul class="ops-list">
          ${(state.feed.calls || [])
            .filter((c) => c.store_id === store.id)
            .slice(0, 6)
            .map(
              (c) =>
                `<li><span>${c.direction || "call"} · ${timeLabel(c.started_at || c.occurred_at)}</span><strong>${c.duration_sec ? `${c.duration_sec}s` : "—"}</strong></li>`
            )
            .join("") || "<li><span>No call events in feed</span><strong>—</strong></li>"}
        </ul>
      </div>
      <div data-loc-panel="discounts" class="loc-panel">
        ${kpiRowHtml(store, KPI_DEFS.find((d) => d.key === "discountRate"), flags)}
        ${kpiRowHtml(store, KPI_DEFS.find((d) => d.key === "refundRate"), flags)}
      </div>
      <div data-loc-panel="delivery" class="loc-panel">
        ${kpiRowHtml(store, KPI_DEFS.find((d) => d.key === "deliveryEta"), flags)}
      </div>
      <div data-loc-panel="utilities" class="loc-panel">
        <div class="metric-mini-grid">
          <div class="metric-mini"><span>Water today</span><strong>${(store.kpis.waterGallonsToday || 0).toFixed(1)} gal</strong></div>
          <div class="metric-mini"><span>Dough produced</span><strong>${(store.kpis.doughLbsToday || 0).toFixed(1)} lbs</strong></div>
        </div>
      </div>
      <div data-loc-panel="ai" class="loc-panel">
        <p class="insight-copy">${narrative}</p>
        ${
          flags.length
            ? `<ul class="evidence-list">${flags
                .map(
                  (f) =>
                    `<li>
                      <strong>${f.label}</strong>
                      <p>${f.copy}</p>
                      <details class="analysis-details"><summary>Analysis details</summary>
                        <p>${f.z >= 0 ? "+" : ""}${f.z.toFixed(2)}σ vs ${f.sourceLabel} · value ${formatKpi(f.value, f.format)} vs baseline ${formatKpi(f.baseline, f.format)}</p>
                      </details>
                    </li>`
                )
                .join("")}</ul>`
            : `<p class="muted">No adverse statistical flags.</p>`
        }
      </div>
    </div>
  `;
}

function kpiRowHtml(store, def, flags) {
  if (!def) return "";
  const flag = flags
    ?.filter((f) => f.kpi === def.key)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
  return `
    <button type="button" class="kpi-row ${flag ? `severity-${flag.severity}` : ""}" data-metric-key="${def.key}" data-store-id="${store.id}">
      <span>${def.label}</span>
      <strong>${formatKpi(store.kpis[def.key] || 0, def.format)}</strong>
      <span class="muted">${flag ? plainLanguageFlag(flag) : "Within expected range"}</span>
    </button>
  `;
}

function openMetricDrawer(key, storeId) {
  const def = KPI_DEFS.find((d) => d.key === key);
  if (!def) return;
  const analysis = state.analysis?.storeAnalyses.find((a) => a.store.id === storeId);
  if (!analysis) return;
  const peer = state.analysis.peerStats[key];
  const flags = analysis.flags.filter((f) => f.kpi === key);
  openDrawer("metric", {
    key,
    label: def.label,
    def,
    store: analysis.store,
    peer,
    flags,
  });
}

function metricDetailHtml({ def, store, peer, flags }) {
  const value = store.kpis[def.key] || 0;
  const history = store.history?.[def.key] || [];
  const spark = sparklineSvg(history);
  const top = flags[0];
  return `
    <div class="drawer-status-row">
      <span class="status-badge status-${top ? toTileStatus(top.severity === "alert" ? "alert" : "watch") : "normal"}">
        ${top ? statusBadgeLabel(toTileStatus(top.severity === "alert" ? "alert" : "watch")) : "Normal"}
      </span>
      <span class="muted">${store.name}</span>
    </div>
    <p class="metric-hero">${formatKpi(value, def.format)}</p>
    <p class="muted">
      Expected near peer mean ${peer ? formatKpi(peer.mean, def.format) : "—"}
      ${top ? ` · ${plainLanguageFlag(top)}` : " · within expected range"}
    </p>
    <div class="spark-wrap">${spark}</div>
    <h3 class="drawer-h">Why this matters</h3>
    <p class="insight-copy">${def.suggestion}</p>
    ${
      top
        ? `<p class="action-rec"><strong>Suggested action:</strong> ${def.suggestion}</p>`
        : ""
    }
    <details class="analysis-details">
      <summary>Analysis details</summary>
      <ul class="ops-list">
        <li><span>Current value</span><strong>${formatKpi(value, def.format)}</strong></li>
        <li><span>Peer mean</span><strong>${peer ? formatKpi(peer.mean, def.format) : "—"}</strong></li>
        <li><span>Peer σ</span><strong>${peer ? peer.stddev.toFixed(2) : "—"}</strong></li>
        ${flags
          .map(
            (f) =>
              `<li><span>${f.sourceLabel} z</span><strong>${f.z >= 0 ? "+" : ""}${f.z.toFixed(2)}σ</strong></li>`
          )
          .join("")}
        <li><span>Data source</span><strong>kpi_snapshots · Neon</strong></li>
        <li><span>Last updated</span><strong>${relativeTime(state.asOf)}</strong></li>
      </ul>
    </details>
    <div class="drawer-actions">
      <button type="button" class="btn btn-ghost" data-jump-store="${store.id}">Back to ${store.name}</button>
    </div>
  `;
}

function alertDetailHtml(suggestion) {
  return `
    <p class="drawer-lead">${suggestion.title || suggestion.storeName}</p>
    <p class="insight-copy">${suggestion.body || suggestion.copy}</p>
    ${
      suggestion.action
        ? `<p class="action-rec"><strong>Recommended:</strong> ${suggestion.action}</p>`
        : ""
    }
    <details class="analysis-details">
      <summary>Technical details</summary>
      <p class="mono muted">${suggestion.tech || suggestion.kpi || ""} · ${suggestion.z != null ? `${suggestion.z.toFixed(2)}σ` : ""}</p>
    </details>
    ${
      suggestion.storeId
        ? `<div class="drawer-actions"><button type="button" class="btn btn-primary" data-jump-store="${suggestion.storeId}">Open location</button></div>`
        : ""
    }
  `;
}

function sparklineSvg(values = []) {
  if (!values.length) return `<span class="muted">No history</span>`;
  const w = 220;
  const h = 48;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" width="100%" height="48" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="2" points="${pts}" /></svg>`;
}

/* ───────── Header / Network / KPIs ───────── */

function renderHeaderMeta() {
  const simStart = state.sim?.startedAt
    ? new Date(state.sim.startedAt).toLocaleString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "7:00 PM";
  if (el.asOf) {
    el.asOf.textContent = state.error
      ? `DB error: ${state.error}`
      : state.asOf
        ? `Sim ${simStart} ET · ${new Date(state.asOf).toLocaleTimeString("en-US", { timeZone: "America/New_York" })}`
        : "Connecting…";
  }

  const counts = networkCounts();
  const chipStatus =
    counts.attention > 0 ? "attention" : counts.watch > 0 ? "watch" : "normal";
  if (el.networkChip) {
    el.networkChip.className = `network-status-chip status-${chipStatus}`;
    el.networkChipLabel.textContent =
      counts.attention > 0
        ? `${counts.attention} need attention`
        : counts.watch > 0
          ? `${counts.watch} on watch`
          : state.live
            ? "Network normal"
            : "Connecting…";
  }

  if (el.pauseBtn) {
    el.pauseBtn.textContent = state.paused ? "Resume" : "Pause";
    el.pauseBtn.setAttribute("aria-pressed", String(state.paused));
  }
}

function renderNetworkHealth() {
  if (!el.networkHealth) return;
  if (!state.analysis) {
    el.networkHealth.innerHTML = `<div class="health-banner is-loading"><p>Loading network snapshot…</p></div>`;
    return;
  }
  const counts = networkCounts();
  const bannerStatus =
    counts.attention > 0 ? "attention" : counts.watch > 0 ? "watch" : "normal";

  const reasons = [];
  const miami = state.stores.find((s) => s.id === "miami-wynwood");
  const miamiAnalysis = state.analysis.storeAnalyses.find(
    (a) => a.store.id === "miami-wynwood"
  );
  if (miami?.activeCase && miamiAnalysis?.status === "alert") {
    reasons.push("one material order anomaly");
  }
  const invFlags = state.analysis.suggestions.filter(
    (s) => s.kpi === "inventoryDays" && s.severity === "alert"
  );
  if (invFlags.length) reasons.push("one inventory risk");
  const discFlags = state.analysis.suggestions.filter(
    (s) => s.kpi === "discountRate" && s.severity !== "ok"
  );
  if (discFlags.length) reasons.push("unusual discount activity");
  if (!reasons.length && counts.attention) {
    reasons.push("statistical exceptions versus peers or history");
  }

  const headline =
    counts.attention > 0
      ? `${counts.attention} location${counts.attention === 1 ? "" : "s"} need attention`
      : counts.watch > 0
        ? `${counts.watch} location${counts.watch === 1 ? "" : "s"} on watch`
        : "Network operating normally";

  const summary =
    counts.attention > 0 || counts.watch > 0
      ? reasons.length
        ? reasons.join(", ").replace(/^./, (c) => c.toUpperCase()) + "."
        : "Review flagged locations for capacity, inventory, or discount exceptions."
      : "All locations are within expected operating bands.";

  el.networkHealth.innerHTML = `
    <div class="health-banner status-${bannerStatus}">
      <div class="health-main">
        <span class="status-badge status-${bannerStatus}">${statusBadgeLabel(bannerStatus)}</span>
        <div>
          <h2 class="health-title">${headline}</h2>
          <p class="health-summary">${summary}</p>
        </div>
      </div>
      <div class="health-counts">
        <div><strong>${counts.normal}</strong><span>Normal</span></div>
        <div><strong>${counts.watch}</strong><span>Watch</span></div>
        <div><strong>${counts.attention}</strong><span>Attention</span></div>
      </div>
      <div class="health-meta">
        <span class="muted">Last analysis ${relativeTime(state.asOf) || "—"}</span>
        <button type="button" class="btn btn-primary btn-sm" data-review-alerts>Review alerts</button>
      </div>
    </div>
  `;

  el.networkHealth.querySelector("[data-review-alerts]")?.addEventListener("click", () => {
    expandTile("attention", true);
    document.getElementById("tile-attention")?.scrollIntoView({ behavior: "smooth", block: "start" });
    render();
  });
}

function renderExecKpis() {
  if (!el.execKpis) return;
  if (!state.analysis) {
    el.execKpis.innerHTML = `<div class="exec-kpi skeleton">Loading…</div>`;
    return;
  }
  const { group } = state.analysis;
  const calls = state.stores.reduce(
    (sum, s) => sum + (s.kpis.phoneCallsToday || 0),
    0
  );
  const avgTicket =
    group.orders > 0 ? group.revenue / group.orders : 0;
  const counts = networkCounts();
  const exposure = estimateExposure();

  // Expected ranges: soft peer-aware narrative without σ
  const cards = [
    {
      id: "revenue",
      label: "Revenue today",
      value: formatKpi(group.revenue, "currency"),
      note: "Network total across all locations",
      tip: "Sum of ticket revenue recorded in today's KPI snapshots.",
    },
    {
      id: "orders",
      label: "Orders today",
      value: formatKpi(group.orders, "number"),
      note: `${state.orders.summary.orderCount || group.orders} in POS stream`,
      tip: "Count of completed orders across the Joe's network today.",
    },
    {
      id: "avgTicket",
      label: "Average ticket",
      value: formatKpi(avgTicket, "currency"),
      note: "Network blend",
      tip: "Revenue divided by order count across locations.",
    },
    {
      id: "calls",
      label: "Active phone calls",
      value: String(calls),
      note: "Inbound + outbound today",
      tip: "Phone call volume from store KPI counters.",
    },
    {
      id: "attention",
      label: "Locations needing attention",
      value: String(counts.attention),
      note: `${counts.watch} on watch · ${counts.normal} normal`,
      tip: "Locations with adverse metrics ≥2σ versus peers or history.",
      tone: counts.attention ? "attention" : "normal",
    },
    {
      id: "exposure",
      label: "Est. operational exposure",
      value: formatKpi(exposure, "currency"),
      note: "Material cases + elevated risks",
      tip: "Rough dollar exposure from material catering and high-severity exceptions.",
      tone: exposure > 1000 ? "watch" : "normal",
    },
  ];

  el.execKpis.innerHTML = cards
    .map(
      (c) => `
    <button type="button" class="exec-kpi ${c.tone ? `tone-${c.tone}` : ""}" data-exec-kpi="${c.id}" title="${c.tip}">
      <span class="exec-kpi-label">${c.label}</span>
      <strong class="exec-kpi-value tabular">${c.value}</strong>
      <span class="exec-kpi-note">${c.note}</span>
    </button>`
    )
    .join("");

  el.execKpis.querySelectorAll("[data-exec-kpi]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-exec-kpi");
      if (id === "attention" || id === "exposure") {
        expandTile("attention", true);
        document.getElementById("tile-attention")?.scrollIntoView({ behavior: "smooth" });
        render();
      } else if (id === "orders" || id === "avgTicket" || id === "revenue") {
        expandTile("orders", true);
        document.getElementById("tile-orders")?.scrollIntoView({ behavior: "smooth" });
        render();
      } else if (id === "calls") {
        expandTile("phone", true);
        document.getElementById("tile-phone")?.scrollIntoView({ behavior: "smooth" });
        render();
      }
    });
  });
}

/* ───────── Attention tile ───────── */

function buildAttentionItems() {
  const items = [];
  const miami = state.stores.find((s) => s.id === "miami-wynwood");
  const miamiAnalysis = state.analysis?.storeAnalyses.find(
    (a) => a.store.id === "miami-wynwood"
  );
  if (miami?.activeCase && miamiAnalysis?.status === "alert") {
    const c = miami.activeCase;
    const qty = c.qty || DEMO_ORDER.qty;
    const cap = miami.capacityPizzas || 120;
    const overPct = Math.round((qty / cap) * 100);
    items.push({
      urgency: "now",
      severity: "critical",
      storeId: "miami-wynwood",
      storeName: "Miami Wynwood",
      title: `Miami Wynwood accepted a ${qty}-pizza order`,
      why: `Capacity is projected to exceed the location's normal throughput (~${overPct}% of daily capacity). Dough and staffing may be insufficient by evening peak.`,
      impact: `Estimated ticket ~$${Number(c.value || DEMO_ORDER.value).toLocaleString()}`,
      time: c.eventAt || state.asOf,
      confidence: "High",
      action:
        "Confirm inventory, add two employees if needed, and route overflow pizzas to Miami Beach.",
      tech: `${c.caseId || DEMO_ORDER.caseId} · phone order in POS`,
    });
  }

  let suggestions = state.analysis?.suggestions || [];
  if (state.selectedId) {
    suggestions = suggestions.filter((s) => s.storeId === state.selectedId);
  }

  for (const s of suggestions) {
    const urgency =
      s.severity === "alert" ? "soon" : s.severity === "watch" ? "info" : "info";
    // Promote inventory / capacity alerts
    const isNow =
      s.severity === "alert" &&
      (s.kpi === "inventoryDays" || s.kpi === "capacityUtil");
    items.push({
      urgency: isNow ? "now" : urgency === "soon" ? "soon" : "info",
      severity: s.severity === "alert" ? "attention" : "watch",
      storeId: s.storeId,
      storeName: s.storeName,
      title: `${s.storeName}: ${plainLanguageFlag(s)}`,
      why: s.copy,
      impact: `${s.label} · ${formatKpi(s.value, s.format)}`,
      time: state.asOf,
      confidence: Math.abs(s.z) >= ALERT_Z ? "High" : "Medium",
      action: KPI_DEFS.find((d) => d.key === s.kpi)?.suggestion || "Review with GM.",
      tech: `${s.kpi} · ${s.z >= 0 ? "+" : ""}${s.z.toFixed(2)}σ vs ${s.sourceLabel}`,
      kpi: s.kpi,
      z: s.z,
      copy: s.copy,
    });
  }

  // Dedupe by title roughly
  const seen = new Set();
  return items.filter((i) => {
    const key = i.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderAttentionTile() {
  const host = el.hosts.attention;
  if (!host || !state.analysis) {
    if (host) host.innerHTML = "";
    return;
  }
  const prefs = state.tilePrefs.attention;
  const items = buildAttentionItems();
  const exposure = estimateExposure();
  const nowCount = items.filter((i) => i.urgency === "now").length;
  const status =
    nowCount > 0 ? "critical" : items.some((i) => i.severity === "attention") ? "attention" : items.length ? "watch" : "normal";

  if (items.length !== state.prevAlertCount && items.length > state.prevAlertCount) {
    const newest = items[0];
    if (newest?.urgency === "now") announceCritical(newest.title);
  }
  state.prevAlertCount = items.length;

  const groups = {
    now: items.filter((i) => i.urgency === "now"),
    soon: items.filter((i) => i.urgency === "soon"),
    info: items.filter((i) => i.urgency === "info"),
  };

  function alertCard(item) {
    return `
      <article class="alert-card severity-${item.severity}">
        <div class="alert-card-top">
          <strong>${item.title}</strong>
          <span class="status-badge status-${item.severity === "critical" ? "critical" : item.severity}">${item.confidence}</span>
        </div>
        <p class="alert-loc">${item.storeName} · ${relativeTime(item.time)}</p>
        <p>${item.why}</p>
        <p class="alert-impact"><em>Impact:</em> ${item.impact}</p>
        <p class="action-rec"><strong>Recommended:</strong> ${item.action}</p>
        <div class="alert-actions">
          <button type="button" class="btn btn-primary btn-sm" data-alert-open='${encodeURIComponent(JSON.stringify({ storeId: item.storeId, title: item.title, body: item.why, action: item.action, tech: item.tech }))}'>View evidence</button>
          <button type="button" class="btn btn-ghost btn-sm" data-jump-store="${item.storeId}">Open location</button>
          <button type="button" class="btn btn-ghost btn-sm" data-alert-dismiss>Dismiss</button>
        </div>
        <details class="analysis-details"><summary>Technical details</summary><p class="mono muted">${item.tech || ""}</p></details>
      </article>
    `;
  }

  const body =
    items.length === 0
      ? `<div class="empty-state"><p>No unresolved owner issues. Routine activity is within expected bands.</p></div>`
      : `
      ${
        groups.now.length
          ? `<h3 class="group-label">Act now</h3><div class="alert-stack">${groups.now.map(alertCard).join("")}</div>`
          : ""
      }
      ${
        groups.soon.length
          ? `<h3 class="group-label">Review soon</h3><div class="alert-stack">${groups.soon.map(alertCard).join("")}</div>`
          : ""
      }
      ${
        groups.info.length
          ? `<h3 class="group-label">Informational</h3><div class="alert-stack">${groups.info.map(alertCard).join("")}</div>`
          : ""
      }
    `;

  host.innerHTML = tileShell({
    id: "attention",
    title: "Owner Attention",
    icon: "!",
    status,
    headline: `${items.length} unresolved issue${items.length === 1 ? "" : "s"}`,
    secondaryMetric: `Est. exposure ${formatKpi(exposure, "currency")}`,
    summary:
      items.length === 0
        ? "Inbox clear — network is quiet."
        : nowCount
          ? `${nowCount} require immediate intervention.`
          : "Review exceptions before they become costly.",
    alertCount: items.length,
    lastUpdated: relativeTime(state.asOf),
    expanded: prefs.expanded,
    pinned: prefs.pinned,
    bodyHtml: body,
  });

  bindTileChrome(host);
  host.querySelectorAll("[data-alert-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      try {
        const payload = JSON.parse(decodeURIComponent(btn.getAttribute("data-alert-open")));
        openDrawer("alert", payload);
      } catch {
        /* ignore */
      }
    });
  });
  host.querySelectorAll("[data-jump-store]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-jump-store");
      state.selectedId = id;
      const analysis = state.analysis.storeAnalyses.find((a) => a.store.id === id);
      if (analysis) openDrawer("location", analysis);
    });
  });
  host.querySelectorAll("[data-alert-dismiss]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.currentTarget.closest(".alert-card")?.classList.add("is-dismissed");
    });
  });
}

/* ───────── Live Orders ───────── */

function renderOrdersTile() {
  const host = el.hosts.orders;
  if (!host) return;
  const prefs = state.tilePrefs.orders;
  const recent = recentOrdersWindow(5);
  const recentRev = recent.reduce((s, o) => s + (o.ticketCents || 0), 0);
  const unusual = recent.filter((o) => o.isMaterial || (o.ticketCents || 0) >= 20000).length;
  const latest = state.orders.rows[0];
  const status = unusual || state.orders.summary.materialCount ? "attention" : "normal";

  const filters = [
    { id: "all", label: "All" },
    { id: "material", label: "Out of control" },
    { id: "phone", label: "Phone" },
    { id: "pos", label: "Counter / other" },
  ];

  const rows = state.orders.rows;
  const feedHtml = rows.length
    ? rows
        .map((o) => {
          const tag = orderEventTag(o);
          const active = state.selectedOrderId === o.id ? "is-selected" : "";
          return `
          <button type="button" class="live-order-row ${active} ${o.isMaterial ? "is-material" : ""}" data-order-id="${o.id}">
            <span class="live-order-time">${timeLabel(o.occurredAt)}</span>
            <span class="live-order-store">${o.storeName}</span>
            <span class="live-order-id mono">${(o.caseId || o.id || "").slice(0, 12)}</span>
            <span class="live-order-channel">${channelLabel(o.channel)}</span>
            <span class="live-order-items">${o.pizzaCount} × ${itemDisplay(o)}</span>
            <span class="live-order-value tabular">${money(o.ticketCents)}</span>
            <span class="live-order-pay muted">${o.status || "ok"}</span>
            <span class="exception-tag tone-${tag.tone}">${tag.label}</span>
          </button>`;
        })
        .join("")
    : `<p class="empty-copy">No orders match this filter.</p>`;

  const body = `
    <div class="live-order-toolbar">
      <div class="filter-bar" role="tablist" aria-label="Order filters">
        ${filters
          .map(
            (f) => `
          <button type="button" class="filter-chip ${state.orderFilter === f.id ? "is-active" : ""}" data-order-filter="${f.id}" role="tab" aria-selected="${state.orderFilter === f.id}">${f.label}</button>`
          )
          .join("")}
      </div>
      <div class="live-order-controls">
        <label class="toggle-label">
          <input type="checkbox" data-follow-live ${state.followLive ? "checked" : ""} />
          Follow live
        </label>
        <label class="toggle-label">
          <input type="checkbox" data-orders-paused ${state.ordersPaused ? "checked" : ""} />
          Pause feed
        </label>
        <input type="search" class="inline-search" data-order-search placeholder="Search orders…" value="${state.orderSearch.replace(/"/g, "&quot;")}" />
      </div>
    </div>
    <div class="order-summary-row">
      <span><strong>${formatKpi(state.orders.summary.orderCount, "number")}</strong> today</span>
      <span><strong>${money(state.orders.summary.revenueCents)}</strong> ticket revenue</span>
      <span class="${state.orders.summary.materialCount ? "text-alert" : ""}"><strong>${state.orders.summary.materialCount}</strong> material</span>
      ${state.selectedId ? `<span class="muted">Filtered · ${state.stores.find((s) => s.id === state.selectedId)?.name || ""}</span> <button type="button" class="btn btn-ghost btn-sm" data-clear-store-filter>Clear location</button>` : ""}
    </div>
    <div class="live-order-feed" role="listbox" aria-label="Live orders">${feedHtml}</div>
  `;

  host.innerHTML = tileShell({
    id: "orders",
    title: "Live Orders",
    icon: "◉",
    status,
    headline: `${recent.length} received in the last 5 minutes`,
    secondaryMetric: `${money(recentRev)} · ${unusual} unusual`,
    summary: latest
      ? `Latest: ${latest.storeName} · ${money(latest.ticketCents)} · ${channelLabel(latest.channel)} · ${latest.pizzaCount} × ${itemDisplay(latest)}`
      : "Waiting for POS stream…",
    alertCount: state.orders.summary.materialCount || unusual,
    lastUpdated: state.followLive ? "Live" : "Paused",
    expanded: prefs.expanded,
    pinned: prefs.pinned,
    actionsHtml: `<span class="live-indicator ${state.followLive && !state.ordersPaused ? "is-live" : ""}" aria-hidden="true"></span>`,
    bodyHtml: body,
  });

  bindTileChrome(host);

  host.querySelectorAll("[data-order-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.orderFilter = btn.getAttribute("data-order-filter");
      loadOrders().then(render);
    });
  });
  host.querySelectorAll("[data-order-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-order-id");
      state.selectedOrderId = id;
      const order = state.orders.rows.find((o) => o.id === id);
      openDrawer("order", order);
      renderOrdersTile();
    });
  });
  host.querySelector("[data-follow-live]")?.addEventListener("change", (e) => {
    state.followLive = e.target.checked;
  });
  host.querySelector("[data-orders-paused]")?.addEventListener("change", (e) => {
    state.ordersPaused = e.target.checked;
  });
  host.querySelector("[data-order-search]")?.addEventListener("change", (e) => {
    state.orderSearch = e.target.value;
    loadOrders().then(render);
  });
  host.querySelector("[data-clear-store-filter]")?.addEventListener("click", () => {
    state.selectedId = null;
    loadOrders().then(render);
  });
}

/* ───────── Locations ───────── */

function filteredLocationAnalyses() {
  if (!state.analysis) return [];
  let list = [...state.analysis.storeAnalyses];
  // Sort: alert → watch → ok, then by worstAbs
  const rank = { alert: 0, watch: 1, ok: 2 };
  list.sort((a, b) => {
    const rd = rank[a.status] - rank[b.status];
    if (rd !== 0) return rd;
    return b.worstAbs - a.worstAbs;
  });

  if (state.locationFilter === "attention") list = list.filter((a) => a.status === "alert");
  else if (state.locationFilter === "watch") list = list.filter((a) => a.status === "watch");
  else if (state.locationFilter === "normal") list = list.filter((a) => a.status === "ok");

  if (state.locationSearch.trim()) {
    const q = state.locationSearch.trim().toLowerCase();
    list = list.filter(
      (a) =>
        a.store.name.toLowerCase().includes(q) ||
        (a.store.city || "").toLowerCase().includes(q) ||
        (a.store.neighborhood || "").toLowerCase().includes(q)
    );
  }

  if (state.commandQuery) {
    const q = state.commandQuery.toLowerCase();
    if (q.includes("discount")) {
      list = list.filter((a) => a.flags.some((f) => f.kpi === "discountRate"));
    }
    if (q.includes("ann arbor")) {
      list = list.filter((a) => a.store.name.toLowerCase().includes("ann arbor"));
    }
  }

  return list;
}

function renderLocationsTile() {
  const host = el.hosts.locations;
  if (!host || !state.analysis) return;
  const prefs = state.tilePrefs.locations;
  const counts = networkCounts();
  const status =
    counts.attention > 0 ? "attention" : counts.watch > 0 ? "watch" : "normal";
  const list = filteredLocationAnalyses();

  const filters = [
    { id: "all", label: "All" },
    { id: "attention", label: "Attention" },
    { id: "watch", label: "Watch" },
    { id: "normal", label: "Normal" },
  ];

  let content;
  if (state.locationView === "table") {
    content = `
      <div class="loc-table-wrap">
        <table class="loc-table">
          <thead>
            <tr>
              <th>Location</th>
              <th>Status</th>
              <th>Revenue</th>
              <th>Orders</th>
              <th>Capacity</th>
              <th>Alerts</th>
            </tr>
          </thead>
          <tbody>
            ${list
              .map((a) => {
                const st = storeStatus(a);
                return `<tr data-store-id="${a.store.id}" tabindex="0" class="${state.selectedId === a.store.id ? "is-selected" : ""}">
                  <td><strong>${a.store.name}</strong><br/><span class="muted">${a.store.city || a.store.neighborhood || ""}</span></td>
                  <td><span class="status-badge status-${toTileStatus(st)}">${statusLabel(st)}</span></td>
                  <td class="tabular">${formatKpi(a.store.kpis.revenue, "currency")}</td>
                  <td class="tabular">${formatKpi(a.store.kpis.orders, "number")}</td>
                  <td class="tabular">${formatKpi(a.store.kpis.capacityUtil, "percent")}</td>
                  <td class="tabular">${a.flags.length}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>`;
  } else {
    content = `
      <div class="loc-card-grid">
        ${list
          .map((a) => {
            const st = storeStatus(a);
            const pulse =
              a.store.id === "miami-wynwood" && st === "alert" && a.store.activeCase
                ? "is-pulsing"
                : "";
            return `
            <button type="button" class="loc-card status-${toTileStatus(st)} ${state.selectedId === a.store.id ? "is-selected" : ""} ${pulse}" data-store-id="${a.store.id}">
              <div class="loc-card-top">
                <div>
                  <h3>${a.store.name}</h3>
                  <p class="muted">${a.store.city || a.store.neighborhood || ""}</p>
                </div>
                <span class="status-badge status-${toTileStatus(st)}">${statusLabel(st)}</span>
              </div>
              <div class="loc-card-metrics">
                <span><em>Revenue</em><strong class="tabular">${formatKpi(a.store.kpis.revenue, "currency")}</strong></span>
                <span><em>Orders</em><strong class="tabular">${formatKpi(a.store.kpis.orders, "number")}</strong></span>
                <span><em>Capacity</em><strong class="tabular">${formatKpi(a.store.kpis.capacityUtil, "percent")}</strong></span>
                <span><em>Alerts</em><strong class="tabular">${a.flags.length}</strong></span>
              </div>
              <p class="loc-card-diag">${locationDiagnostic(a)}</p>
            </button>`;
          })
          .join("")}
      </div>`;
  }

  const body = `
    <div class="live-order-toolbar">
      <div class="filter-bar">
        ${filters
          .map(
            (f) =>
              `<button type="button" class="filter-chip ${state.locationFilter === f.id ? "is-active" : ""}" data-loc-filter="${f.id}">${f.label}</button>`
          )
          .join("")}
      </div>
      <div class="live-order-controls">
        <button type="button" class="filter-chip ${state.locationView === "cards" ? "is-active" : ""}" data-loc-view="cards">Cards</button>
        <button type="button" class="filter-chip ${state.locationView === "table" ? "is-active" : ""}" data-loc-view="table">Table</button>
        <input type="search" class="inline-search" data-loc-search placeholder="Search locations…" value="${state.locationSearch.replace(/"/g, "&quot;")}" />
      </div>
    </div>
    ${content}
  `;

  host.innerHTML = tileShell({
    id: "locations",
    title: "Locations",
    icon: "▣",
    status,
    headline: `${counts.normal} normal · ${counts.attention} need attention · ${counts.watch} on watch`,
    summary: "Sorted by urgency — critical locations first.",
    alertCount: counts.attention,
    lastUpdated: relativeTime(state.asOf),
    expanded: prefs.expanded,
    pinned: prefs.pinned,
    bodyHtml: body,
  });

  bindTileChrome(host);

  host.querySelectorAll("[data-loc-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.locationFilter = btn.getAttribute("data-loc-filter");
      render();
    });
  });
  host.querySelectorAll("[data-loc-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.locationView = btn.getAttribute("data-loc-view");
      render();
    });
  });
  host.querySelector("[data-loc-search]")?.addEventListener("change", (e) => {
    state.locationSearch = e.target.value;
    render();
  });

  const openLoc = (id) => {
    state.selectedId = id;
    const analysis = state.analysis.storeAnalyses.find((a) => a.store.id === id);
    if (analysis) openDrawer("location", analysis);
    loadOrders().then(() => {
      /* keep drawer */
      render();
      renderDrawer();
    });
  };

  host.querySelectorAll("[data-store-id]").forEach((node) => {
    node.addEventListener("click", () => openLoc(node.getAttribute("data-store-id")));
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openLoc(node.getAttribute("data-store-id"));
      }
    });
  });
}

/* ───────── Secondary operational tiles ───────── */

function renderInventoryTile() {
  const host = el.hosts.inventory;
  if (!host || !state.analysis) return;
  const prefs = state.tilePrefs.inventory;
  const flagged = state.analysis.storeAnalyses.filter((a) =>
    a.flags.some((f) => f.kpi === "inventoryDays")
  );
  const status = flagged.some((a) => a.status === "alert")
    ? "attention"
    : flagged.length
      ? "watch"
      : "normal";

  const rows = state.analysis.storeAnalyses
    .slice()
    .sort((a, b) => a.store.kpis.inventoryDays - b.store.kpis.inventoryDays)
    .slice(0, 6);

  const body = `
    <div class="secondary-grid">
      ${rows
        .map((a) => {
          const low = a.store.kpis.inventoryDays < 2;
          return `
          <button type="button" class="secondary-row ${low ? "is-warn" : ""}" data-store-id="${a.store.id}">
            <span>${a.store.name}</span>
            <strong class="tabular">${formatKpi(a.store.kpis.inventoryDays, "days")}</strong>
            <span class="muted">cover</span>
          </button>`;
        })
        .join("")}
    </div>
  `;

  host.innerHTML = tileShell({
    id: "inventory",
    title: "Inventory",
    icon: "▤",
    status,
    headline: flagged.length
      ? `${flagged.length} location${flagged.length === 1 ? "" : "s"} with cover risk`
      : "Cover levels within band",
    summary: "Lowest inventory cover shown first.",
    alertCount: flagged.length,
    expanded: prefs.expanded,
    pinned: prefs.pinned,
    bodyHtml: body,
  });
  bindTileChrome(host);
  bindStoreButtons(host);
}

function renderLaborTile() {
  const host = el.hosts.labor;
  if (!host || !state.analysis) return;
  const prefs = state.tilePrefs.labor;
  const flagged = state.analysis.storeAnalyses.filter((a) =>
    a.flags.some((f) => f.kpi === "staffingFill")
  );
  const onClock = state.stores.reduce(
    (s, st) => s + (st.kpis.employeesOnClock || 0),
    0
  );
  const status = flagged.some((a) => a.status === "alert")
    ? "attention"
    : flagged.length
      ? "watch"
      : "normal";

  const body = `
    <div class="secondary-grid">
      ${state.analysis.storeAnalyses
        .slice()
        .sort((a, b) => a.store.kpis.staffingFill - b.store.kpis.staffingFill)
        .slice(0, 6)
        .map(
          (a) => `
        <button type="button" class="secondary-row" data-store-id="${a.store.id}">
          <span>${a.store.name}</span>
          <strong class="tabular">${formatKpi(a.store.kpis.staffingFill, "percent")}</strong>
          <span class="muted">${a.store.kpis.employeesOnClock || 0} on clock</span>
        </button>`
        )
        .join("")}
    </div>
  `;

  host.innerHTML = tileShell({
    id: "labor",
    title: "Labor",
    icon: "◎",
    status,
    headline: `${onClock} employees on the clock`,
    secondaryMetric: flagged.length ? `${flagged.length} staffing flags` : "Fill rates OK",
    summary: "Staffing fill versus schedule.",
    alertCount: flagged.length,
    expanded: prefs.expanded,
    pinned: prefs.pinned,
    bodyHtml: body,
  });
  bindTileChrome(host);
  bindStoreButtons(host);
}

function renderPhoneTile() {
  const host = el.hosts.phone;
  if (!host || !state.analysis) return;
  const prefs = state.tilePrefs.phone;
  const calls = state.stores.reduce(
    (s, st) => s + (st.kpis.phoneCallsToday || 0),
    0
  );
  const feedCalls = state.feed.calls || [];

  const body = `
    <div class="secondary-grid">
      ${state.stores
        .slice()
        .sort((a, b) => (b.kpis.phoneCallsToday || 0) - (a.kpis.phoneCallsToday || 0))
        .slice(0, 6)
        .map(
          (s) => `
        <button type="button" class="secondary-row" data-store-id="${s.id}">
          <span>${s.name}</span>
          <strong class="tabular">${s.kpis.phoneCallsToday || 0}</strong>
          <span class="muted">calls</span>
        </button>`
        )
        .join("")}
    </div>
    ${
      feedCalls.length
        ? `<h4 class="drawer-h">Recent call events</h4>
           <ul class="ops-list">${feedCalls
             .slice(0, 5)
             .map(
               (c) =>
                 `<li><span>${c.store_id || "store"} · ${c.direction || "call"}</span><strong>${timeLabel(c.started_at || c.occurred_at)}</strong></li>`
             )
             .join("")}</ul>`
        : ""
    }
  `;

  host.innerHTML = tileShell({
    id: "phone",
    title: "Phone Activity",
    icon: "☎",
    status: "normal",
    headline: `${calls} calls today`,
    summary: "Inbound volume by location.",
    expanded: prefs.expanded,
    pinned: prefs.pinned,
    bodyHtml: body,
  });
  bindTileChrome(host);
  bindStoreButtons(host);
}

function renderDiscountsTile() {
  const host = el.hosts.discounts;
  if (!host || !state.analysis) return;
  const prefs = state.tilePrefs.discounts;
  const flagged = state.analysis.storeAnalyses.filter((a) =>
    a.flags.some((f) => f.kpi === "discountRate" || f.kpi === "refundRate")
  );
  const status = flagged.some((a) => a.status === "alert")
    ? "attention"
    : flagged.length
      ? "watch"
      : "normal";

  const body = `
    <div class="secondary-grid two-col">
      ${state.analysis.storeAnalyses
        .slice()
        .sort((a, b) => b.store.kpis.discountRate - a.store.kpis.discountRate)
        .map(
          (a) => `
        <button type="button" class="secondary-row" data-metric-key="discountRate" data-store-id="${a.store.id}">
          <span>${a.store.name}</span>
          <strong class="tabular">${formatKpi(a.store.kpis.discountRate, "percent")}</strong>
          <span class="muted">disc · refund ${formatKpi(a.store.kpis.refundRate, "percent")}</span>
        </button>`
        )
        .join("")}
    </div>
  `;

  host.innerHTML = tileShell({
    id: "discounts",
    title: "Discounts and Refunds",
    icon: "%",
    status,
    headline: flagged.length
      ? `${flagged.length} locations above expected discount/refund bands`
      : "Discount and refund rates within peers",
    summary: "Click a row to inspect authorizing patterns.",
    alertCount: flagged.length,
    expanded: prefs.expanded,
    pinned: prefs.pinned,
    bodyHtml: body,
  });
  bindTileChrome(host);
  host.querySelectorAll("[data-metric-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openMetricDrawer(
        btn.getAttribute("data-metric-key"),
        btn.getAttribute("data-store-id")
      );
    });
  });
}

function renderDeliveryTile() {
  const host = el.hosts.delivery;
  if (!host || !state.analysis) return;
  const prefs = state.tilePrefs.delivery;
  const flagged = state.analysis.storeAnalyses.filter((a) =>
    a.flags.some((f) => f.kpi === "deliveryEta")
  );
  const avgEta =
    state.stores.reduce((s, st) => s + (st.kpis.deliveryEta || 0), 0) /
    Math.max(state.stores.length, 1);

  const body = `
    <div class="secondary-grid">
      ${state.analysis.storeAnalyses
        .slice()
        .sort((a, b) => b.store.kpis.deliveryEta - a.store.kpis.deliveryEta)
        .slice(0, 6)
        .map(
          (a) => `
        <button type="button" class="secondary-row" data-metric-key="deliveryEta" data-store-id="${a.store.id}">
          <span>${a.store.name}</span>
          <strong class="tabular">${formatKpi(a.store.kpis.deliveryEta, "minutes")}</strong>
          <span class="muted">ETA</span>
        </button>`
        )
        .join("")}
    </div>
  `;

  host.innerHTML = tileShell({
    id: "delivery",
    title: "Delivery Performance",
    icon: "→",
    status: flagged.length ? "watch" : "normal",
    headline: `Network avg ETA ${formatKpi(avgEta, "minutes")}`,
    summary: flagged.length
      ? `${flagged.length} location${flagged.length === 1 ? "" : "s"} slower than expected`
      : "ETAs within expected range.",
    alertCount: flagged.length,
    expanded: prefs.expanded,
    pinned: prefs.pinned,
    bodyHtml: body,
  });
  bindTileChrome(host);
  host.querySelectorAll("[data-metric-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openMetricDrawer(
        btn.getAttribute("data-metric-key"),
        btn.getAttribute("data-store-id")
      );
    });
  });
}

function renderUtilitiesTile() {
  const host = el.hosts.utilities;
  if (!host || !state.analysis) return;
  const prefs = state.tilePrefs.utilities;
  const water = state.stores.reduce(
    (s, st) => s + (st.kpis.waterGallonsToday || 0),
    0
  );
  const dough = state.stores.reduce(
    (s, st) => s + (st.kpis.doughLbsToday || 0),
    0
  );

  const body = `
    <div class="metric-mini-grid">
      <div class="metric-mini"><span>Water today</span><strong class="tabular">${water.toFixed(0)} gal</strong></div>
      <div class="metric-mini"><span>Dough produced</span><strong class="tabular">${dough.toFixed(0)} lbs</strong></div>
    </div>
    <div class="secondary-grid">
      ${state.stores
        .slice()
        .sort(
          (a, b) =>
            (b.kpis.waterGallonsToday || 0) - (a.kpis.waterGallonsToday || 0)
        )
        .slice(0, 5)
        .map(
          (s) => `
        <button type="button" class="secondary-row" data-store-id="${s.id}">
          <span>${s.name}</span>
          <strong class="tabular">${(s.kpis.waterGallonsToday || 0).toFixed(0)} gal</strong>
          <span class="muted">${(s.kpis.doughLbsToday || 0).toFixed(0)} lbs dough</span>
        </button>`
        )
        .join("")}
    </div>
  `;

  host.innerHTML = tileShell({
    id: "utilities",
    title: "Water and Utility Usage",
    icon: "💧",
    status: "normal",
    headline: `${water.toFixed(0)} gal water · ${dough.toFixed(0)} lbs dough`,
    summary: "Utility readings tied to production load.",
    expanded: prefs.expanded,
    pinned: prefs.pinned,
    bodyHtml: body,
  });
  bindTileChrome(host);
  bindStoreButtons(host);
}

function renderDemoTile() {
  const host = el.hosts.demo;
  if (!host) return;
  const prefs = state.tilePrefs.demo;
  const stage = demo.stage;
  const lines = demo.transcript();
  const ownerLines = demo.ownerTranscript();
  const live = demo.liveCase;
  const miami = state.stores.find((s) => s.id === "miami-wynwood");
  const miamiAnalysis = state.analysis?.storeAnalyses.find(
    (a) => a.store.id === "miami-wynwood"
  );
  const isAlert =
    stage === "alert" ||
    stage === "owner_call" ||
    stage === "enrich" ||
    stage === "found" ||
    (miami?.activeCase && miamiAnalysis?.status === "alert");

  const stageNote = {
    listening:
      "Call Mia at Joe's Miami Wynwood. When she hits the Order tool, the webhook lands here live.",
    alert: "Material order in POS — Wynwood needs attention. Dialing your hackathon partner…",
    owner_call: "OwnerRadar is on the line with the owner (your hackathon partner).",
    enrich: "Looking up who's running the Wynwood dock event…",
    found: "Found them — LinkedIn + public info texted to your partner.",
  }[stage];

  const stageLabel = {
    listening: "Listening for webhook",
    alert: "Alert · Wynwood",
    owner_call: "Calling owner",
    enrich: "Enriching…",
    found: "Case closed loop",
  }[stage];

  const body = `
    <p class="demo-stage-note">${stageNote}</p>
    <div class="demo-grid">
      <section class="demo-card ${isAlert ? "is-hot" : ""}">
        <h3>1 · You call Joe's cashier</h3>
        ${
          stage === "listening"
            ? `<ol class="transcript">
                <li class="muted">Dial Mia · place the big catering order · she runs the Order tool.</li>
                <li class="muted">Waiting on <code>/api/order</code> or <code>/api/retell-order</code>…</li>
              </ol>`
            : `<ol class="transcript">
                ${lines
                  .map(
                    (l) =>
                      `<li><span class="who">${l.who}</span><span class="said">${l.text}</span></li>`
                  )
                  .join("")}
                ${
                  live || miami?.activeCase
                    ? `<li><span class="who">Status</span><span class="said">${(live || miami.activeCase).qty || DEMO_ORDER.qty} pies accepted · case ${(live || miami.activeCase).caseId || DEMO_ORDER.caseId}</span></li>`
                    : ""
                }
              </ol>`
        }
      </section>
      <section class="demo-card ${stage === "owner_call" || stage === "enrich" || stage === "found" ? "is-hot" : ""}">
        <h3>2 · OwnerRadar → owner (partner)</h3>
        <ol class="transcript">
          ${
            ownerLines.length
              ? ownerLines
                  .map(
                    (l) =>
                      `<li><span class="who">${l.who}</span><span class="said">${l.text}</span></li>`
                  )
                  .join("")
              : `<li class="muted">Quiet until a material webhook order turns Wynwood red.</li>`
          }
        </ol>
        ${
          stage === "owner_call"
            ? `<button type="button" class="btn btn-primary" data-demo-yes>Partner: Yes — find who's in charge</button>`
            : ""
        }
        ${stage === "enrich" ? `<p class="searching">Searching public event + people graph…</p>` : ""}
        ${
          stage === "found"
            ? `<div class="found-card">
                <p class="found-kicker">Found him</p>
                <h4>${EVENT_ORGANIZER.name}</h4>
                <p>${EVENT_ORGANIZER.role}</p>
                <p><a href="${EVENT_ORGANIZER.linkedin}" target="_blank" rel="noopener">LinkedIn profile</a></p>
                <ul>${EVENT_ORGANIZER.publicNotes.map((n) => `<li>${n}</li>`).join("")}</ul>
                <p class="sms-preview">${EVENT_ORGANIZER.smsPreview}</p>
              </div>`
            : ""
        }
      </section>
    </div>
    <details class="agent-prompt">
      <summary>Voice agent prompts (cashier + OwnerRadar)</summary>
      <div class="agent-prompt-grid">
        <div>
          <h4>Mia · cashier (inbound)</h4>
          <p class="agent-meta">Order tool → <code>/api/order</code> or <code>/api/retell-order</code></p>
          <pre>${CASHIER_AGENT_PROMPT.replace(/</g, "&lt;")}</pre>
        </div>
        <div>
          <h4>OwnerRadar → partner (outbound)</h4>
          <p class="agent-meta">Call Owner → <code>/api/call-owner</code> · only if ≥2σ out of control</p>
          <pre>${OWNER_RADAR_AGENT_PROMPT.replace(/</g, "&lt;")}</pre>
        </div>
      </div>
    </details>
  `;

  host.innerHTML = tileShell({
    id: "demo",
    title: "Demo Controls",
    icon: "▶",
    status: isAlert ? "attention" : "normal",
    headline: stageLabel,
    summary: "Live webhook path · call in · no scripted cashier demo",
    expanded: prefs.expanded || isAlert,
    pinned: prefs.pinned,
    bodyHtml: body,
  });

  bindTileChrome(host);
  host.querySelector("[data-demo-yes]")?.addEventListener("click", () => {
    demo.approveEnrichment();
  });
}

function bindStoreButtons(host) {
  host.querySelectorAll("[data-store-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-store-id");
      state.selectedId = id;
      const analysis = state.analysis?.storeAnalyses.find((a) => a.store.id === id);
      if (analysis) openDrawer("location", analysis);
    });
  });
}

function bindTileChrome(host) {
  host.querySelectorAll("[data-tile-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-tile-toggle");
      const cur = state.tilePrefs[id];
      state.tilePrefs = {
        ...state.tilePrefs,
        [id]: { ...cur, expanded: !cur.expanded },
      };
      saveTilePrefs(state.tilePrefs);
      render();
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        btn.click();
      }
    });
  });
  host.querySelectorAll("[data-tile-pin]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-tile-pin");
      const cur = state.tilePrefs[id];
      const pinned = !cur.pinned;
      state.tilePrefs = {
        ...state.tilePrefs,
        [id]: { ...cur, pinned, expanded: pinned ? true : cur.expanded },
      };
      saveTilePrefs(state.tilePrefs);
      render();
    });
  });
}

/* ───────── Command input ───────── */

function applyCommand(query) {
  const q = query.trim().toLowerCase();
  state.commandQuery = q;
  if (!q) {
    render();
    return;
  }
  if (q.includes("discount")) {
    state.locationFilter = "all";
    expandTile("discounts", true);
    expandTile("locations", true);
  }
  if (q.includes("ann arbor") || q.includes("why is")) {
    const match = state.stores.find((s) =>
      s.name.toLowerCase().includes("ann arbor")
    );
    if (match) {
      state.selectedId = match.id;
      const analysis = state.analysis?.storeAnalyses.find(
        (a) => a.store.id === match.id
      );
      if (analysis) openDrawer("location", analysis);
    }
    expandTile("attention", true);
  }
  if (q.includes("over $200") || q.includes("over 200")) {
    state.orderFilter = "all";
    state.orderSearch = "200";
    expandTile("orders", true);
    loadOrders().then(render);
    return;
  }
  if (q.includes("last hour") || q.includes("what changed")) {
    expandTile("attention", true);
    expandTile("orders", true);
  }
  if (q.includes("alert") || q.includes("attention")) {
    expandTile("attention", true);
  }
  render();
}

/* ───────── Render orchestration ───────── */

function render() {
  renderHeaderMeta();
  renderNetworkHealth();
  renderExecKpis();
  renderAttentionTile();
  renderOrdersTile();
  renderLocationsTile();
  renderInventoryTile();
  renderLaborTile();
  renderPhoneTile();
  renderDiscountsTile();
  renderDeliveryTile();
  renderUtilitiesTile();
  renderDemoTile();
  if (state.drawer) renderDrawer();
}

function wireGlobalControls() {
  el.drawerBackdrop?.addEventListener("click", closeDrawer);
  document.querySelector("[data-drawer-close]")?.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.drawer) closeDrawer();
  });

  el.pauseBtn?.addEventListener("click", () => {
    state.paused = !state.paused;
    renderHeaderMeta();
  });

  el.replayBtn?.addEventListener("click", () => {
    state.selectedId = null;
    state.selectedOrderId = null;
    state.orderFilter = "all";
    closeDrawer();
    demo.reset();
    expandTile("demo", true);
    Promise.all([loadSnapshot(true), loadOrders()]).then(render);
  });

  el.collapseAll?.addEventListener("click", () => {
    state.tilePrefs = collapseAllPrefs(state.tilePrefs);
    saveTilePrefs(state.tilePrefs);
    render();
  });

  el.expandPinned?.addEventListener("click", () => {
    state.tilePrefs = expandPinnedPrefs(state.tilePrefs);
    saveTilePrefs(state.tilePrefs);
    render();
  });

  el.commandInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      applyCommand(e.target.value);
    }
  });
}

async function boot() {
  wireGlobalControls();
  render();
  await loadSnapshot(false);
  await Promise.all([loadFeed(), loadOrders()]);
  render();
  setInterval(async () => {
    if (state.paused) return;
    // Alternate: write tick every other pass so cron + tab don't double-hammer Neon
    state._tickPass = (state._tickPass || 0) + 1;
    await loadSnapshot(state._tickPass % 2 === 0);
    if (!state.ordersPaused) {
      await Promise.all([loadFeed(), loadOrders()]);
    } else {
      await loadFeed();
    }
    maybeEscalateFromLiveOrder();
    render();
  }, 15000);
}

boot();
