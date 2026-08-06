import { analyzeStores } from "./stats.js";
import { createDemoController } from "./demo.js";
import {
  loadTilePrefs,
  saveTilePrefs,
  setTileExpanded,
  bindTileControls,
} from "./ui/tiles.js";
import {
  openDrawer,
  closeDrawer,
  bindDrawerChrome,
} from "./ui/drawer.js";
import {
  renderCommandStatus,
  renderExecutiveKpis,
  renderAttentionTile,
  renderOrdersTile,
  renderLocationsTile,
  renderInventoryTile,
  renderLaborTile,
  renderPhoneTile,
  renderDiscountsTile,
  renderDeliveryTile,
  renderUtilitiesTile,
  orderDrawerHtml,
  locationDrawerHtml,
  metricDrawerHtml,
  alertDrawerHtml,
} from "./ui/sections.js";

const state = {
  selectedId: null,
  selectedOrderId: null,
  orderFilter: "all",
  orderStoreFilter: null,
  orderSearch: "",
  ordersPaused: false,
  followLive: true,
  locationView: "cards",
  locationStatusFilter: "all",
  locationCityFilter: null,
  locationSort: "risk",
  locationSearch: "",
  commandQuery: "",
  dismissedAlerts: new Set(),
  tilePrefs: loadTilePrefs(),
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
      chain: { pending: 0, anchored: 0, failed: 0 },
    },
    rows: [],
  },
  verifyResult: null,
  asOf: null,
  sim: null,
  live: false,
  error: null,
  lastOrderKpi: null,
  simPaused: false,
  lastAlertAnnounce: null,
};

const el = {
  asOf: document.querySelector("[data-as-of]"),
  status: document.querySelector("[data-network-status]"),
  kpis: document.querySelector("[data-executive-kpis]"),
  tileStack: document.querySelector("[data-tile-stack]"),
  attention: document.querySelector("[data-tile-attention]"),
  orders: document.querySelector("[data-tile-orders]"),
  locations: document.querySelector("[data-tile-locations]"),
  inventory: document.querySelector("[data-tile-inventory]"),
  labor: document.querySelector("[data-tile-labor]"),
  phone: document.querySelector("[data-tile-phone]"),
  discounts: document.querySelector("[data-tile-discounts]"),
  delivery: document.querySelector("[data-tile-delivery]"),
  utilities: document.querySelector("[data-tile-utilities]"),
  moreOps: document.querySelector("[data-more-ops]"),
  commandInput: document.querySelector("[data-command-input]"),
  srLive: document.querySelector("[data-sr-live]"),
  drawer: {
    root: document.querySelector("[data-drawer-root]"),
    backdrop: document.querySelector("[data-drawer-backdrop]"),
    panel: document.querySelector("[data-drawer-panel]"),
    title: document.querySelector("[data-drawer-title]"),
    body: document.querySelector("[data-drawer-body]"),
    close: document.querySelector("[data-drawer-close]"),
  },
};

let tileCleanup = null;
let searchTimer = null;
let pollTimer = null;

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

  const alerts = state.analysis.group.openRisks;
  if (alerts > 0 && state.lastAlertAnnounce !== alerts) {
    state.lastAlertAnnounce = alerts;
    if (el.srLive) {
      el.srLive.textContent = `${alerts} location${alerts === 1 ? "" : "s"} need owner attention.`;
    }
  }
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
  state.tilePrefs = setTileExpanded(state.tilePrefs, "attention", true);
  saveTilePrefs(state.tilePrefs);
  demo.markEntered?.(miami.activeCase);
}

async function loadSnapshot(fromTick = false) {
  try {
    const endpoint = fromTick ? "/api/tick" : "/api/stores";
    const res = await fetch(apiUrl(endpoint), {
      method: fromTick ? "POST" : "GET",
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    const snapshot = data.snapshot || data;
    applySnapshot(snapshot);
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
  if (state.ordersPaused) return;
  try {
    const params = new URLSearchParams({ limit: "100" });
    const storeFilter = state.orderStoreFilter || state.selectedId;
    if (storeFilter) params.set("storeId", storeFilter);
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
    if (state.followLive && rows.length && !state.selectedOrderId) {
      state.selectedOrderId = rows[0].id;
    }
  } catch {
    /* keep prior orders */
  }
}

const demo = createDemoController({
  onStage: () => {},
  render: () => render(),
});

function updateTilePrefs(next) {
  state.tilePrefs = next;
  saveTilePrefs(next);
  render();
}

function openOrderDrawer(orderId) {
  state.selectedOrderId = orderId;
  const order =
    state.orders.rows.find((o) => o.id === orderId) ||
    state.orders.rows[0];
  openDrawer(el.drawer, {
    type: "order",
    title: order?.caseId || `Order ${(orderId || "").slice(0, 8)}`,
    bodyHtml: orderDrawerHtml(order, state),
    meta: { orderId },
  });
  bindDrawerBodyActions();
}

function openLocationDrawer(storeId) {
  state.selectedId = storeId;
  const store = state.stores.find((s) => s.id === storeId);
  openDrawer(el.drawer, {
    type: "location",
    title: store?.name || "Location",
    bodyHtml: locationDrawerHtml(storeId, state),
    meta: { storeId },
  });
  bindDrawerBodyActions();
  loadOrders().then(render);
}

function openMetricDrawer(kpiId, storeId = null) {
  const titles = {
    revenue: "Revenue today",
    orders: "Orders today",
    avgTicket: "Average ticket",
    phone: "Phone calls",
    attention: "Locations needing attention",
    exposure: "Estimated operational exposure",
  };
  openDrawer(el.drawer, {
    type: "metric",
    title: titles[kpiId] || kpiId,
    bodyHtml: metricDrawerHtml(kpiId, state, storeId),
    meta: { kpiId, storeId },
  });
  bindDrawerBodyActions();
}

function openAlertDrawer(item) {
  openDrawer(el.drawer, {
    type: "alert",
    title: "Owner alert",
    bodyHtml: alertDrawerHtml(item, state),
    meta: { key: item.key },
  });
  bindDrawerBodyActions();
}

function bindDrawerBodyActions() {
  const body = el.drawer.body;
  if (!body) return;
  body.querySelector("[data-drawer-jump-store]")?.addEventListener("click", (e) => {
    openLocationDrawer(e.currentTarget.getAttribute("data-drawer-jump-store"));
  });
  body.querySelectorAll("[data-drawer-store]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openLocationDrawer(btn.getAttribute("data-drawer-store"));
    });
  });
  body.querySelectorAll("[data-drawer-order]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openOrderDrawer(btn.getAttribute("data-drawer-order"));
    });
  });
  body.querySelectorAll("[data-metric-kpi]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openMetricDrawer(
        btn.getAttribute("data-metric-kpi"),
        btn.getAttribute("data-metric-store")
      );
    });
  });
  body.querySelector("[data-verify-order]")?.addEventListener("click", () => {
    verifySelectedOrder(false);
  });
  body.querySelector("[data-tamper-order]")?.addEventListener("click", () => {
    verifySelectedOrder(true);
  });
}

async function verifySelectedOrder(tamper = false) {
  const id = state.selectedOrderId;
  if (!id) return;
  try {
    const params = new URLSearchParams({ orderId: id });
    if (tamper) params.set("tamper", "1");
    const res = await fetch(apiUrl(`/api/verify?${params}`));
    const data = await res.json();
    state.verifyResult = data;
    openOrderDrawer(id);
  } catch (err) {
    state.verifyResult = { ok: false, orderId: id, error: err.message };
    openOrderDrawer(id);
  }
}

function reviewAlerts() {
  state.tilePrefs = setTileExpanded(state.tilePrefs, "attention", true);
  saveTilePrefs(state.tilePrefs);
  render();
  requestAnimationFrame(() => {
    document.getElementById("tile-attention")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

function renderAsOf() {
  if (!el.asOf) return;
  if (state.error) {
    el.asOf.textContent = `Offline · ${state.error}`;
    return;
  }
  el.asOf.textContent = state.asOf
    ? `Updated ${new Date(state.asOf).toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })} ET`
    : "Connecting…";
}

function openMoreOps() {
  if (el.moreOps) el.moreOps.open = true;
}

function render() {
  renderAsOf();
  renderCommandStatus(el.status, state);
  renderExecutiveKpis(el.kpis, state, {
    onMetric: (id) => {
      if (id === "attention") {
        reviewAlerts();
        return;
      }
      openMetricDrawer(id);
    },
  });

  const storeHandlers = {
    onSelectStore: (id) => openLocationDrawer(id),
  };

  renderAttentionTile(el.attention, state, state.tilePrefs, {
    onDismiss: (key) => {
      state.dismissedAlerts.add(key);
      render();
    },
    onEvidence: (item) => {
      if (item.kind === "material" || item.storeId) {
        openAlertDrawer(item);
      }
    },
  });

  renderOrdersTile(el.orders, state, state.tilePrefs, {
    onFilter: (f) => {
      state.orderFilter = f;
      loadOrders().then(render);
    },
    onStoreFilter: (id) => {
      state.orderStoreFilter = id;
      loadOrders().then(render);
    },
    onSearch: (q) => {
      state.orderSearch = q;
      render();
    },
    onPauseToggle: () => {
      state.ordersPaused = !state.ordersPaused;
      render();
    },
    onFollowToggle: () => {
      state.followLive = !state.followLive;
      render();
    },
    onSelectOrder: (id) => openOrderDrawer(id),
  });

  renderLocationsTile(el.locations, state, state.tilePrefs, {
    ...storeHandlers,
    onView: (v) => {
      state.locationView = v;
      render();
    },
    onStatusFilter: (v) => {
      state.locationStatusFilter = v;
      render();
    },
    onCityFilter: (v) => {
      state.locationCityFilter = v;
      render();
    },
    onSort: (v) => {
      state.locationSort = v;
      render();
    },
    onSearch: (q) => {
      state.locationSearch = q;
      render();
    },
  });

  renderInventoryTile(el.inventory, state, state.tilePrefs, storeHandlers);
  renderLaborTile(el.labor, state, state.tilePrefs, storeHandlers);
  renderPhoneTile(el.phone, state, state.tilePrefs, storeHandlers);
  renderDiscountsTile(el.discounts, state, state.tilePrefs, storeHandlers);
  renderDeliveryTile(el.delivery, state, state.tilePrefs, storeHandlers);
  renderUtilitiesTile(el.utilities, state, state.tilePrefs, storeHandlers);

  if (tileCleanup) tileCleanup();
  tileCleanup = bindTileControls(el.tileStack, {
    prefs: state.tilePrefs,
    onChange: updateTilePrefs,
  });
}

function bindChrome() {
  bindDrawerChrome(el.drawer, { onClose: () => {} });

  el.commandInput?.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.commandQuery = e.target.value.trim();
      if (state.commandQuery) {
        state.tilePrefs = setTileExpanded(state.tilePrefs, "attention", true);
        state.tilePrefs = setTileExpanded(state.tilePrefs, "locations", true);
        saveTilePrefs(state.tilePrefs);
      }
      render();
    }, 200);
  });

  el.commandInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = (e.target.value || "").toLowerCase();
    if (q.includes("ann arbor")) {
      const store = state.stores.find((s) =>
        s.name.toLowerCase().includes("ann arbor")
      );
      if (store) openLocationDrawer(store.id);
    } else if (q.includes("over $200") || q.includes("over 200")) {
      state.orderFilter = "all";
      state.tilePrefs = setTileExpanded(state.tilePrefs, "orders", true);
      saveTilePrefs(state.tilePrefs);
      render();
      const big = state.orders.rows.find((o) => (o.ticketCents || 0) >= 20000);
      if (big) openOrderDrawer(big.id);
    } else if (q.includes("discount")) {
      openMoreOps();
      state.tilePrefs = setTileExpanded(state.tilePrefs, "discounts", true);
      state.tilePrefs = setTileExpanded(state.tilePrefs, "locations", true);
      saveTilePrefs(state.tilePrefs);
      render();
    } else if (q.includes("last hour") || q.includes("what changed")) {
      reviewAlerts();
      state.tilePrefs = setTileExpanded(state.tilePrefs, "orders", true);
      saveTilePrefs(state.tilePrefs);
      render();
    }
  });
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (state.simPaused) return;
    await loadSnapshot(true);
    await Promise.all([loadFeed(), loadOrders()]);
    maybeEscalateFromLiveOrder();
    render();
  }, 20000);
}

async function boot() {
  bindChrome();
  render();
  await loadSnapshot(false);
  await Promise.all([loadFeed(), loadOrders()]);

  // Auto-expand attention when there are risks on first load
  if (state.analysis?.group?.openRisks > 0) {
    state.tilePrefs = setTileExpanded(state.tilePrefs, "attention", true);
    saveTilePrefs(state.tilePrefs);
  }

  render();
  startPolling();
}

boot();
