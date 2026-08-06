import { analyzeStores, formatKpi, KPI_DEFS, ALERT_Z } from "./stats.js";
import { createDemoController } from "./demo.js";
import {
  DEMO_ORDER,
  EVENT_ORGANIZER,
  CASHIER_AGENT_PROMPT,
  OWNER_RADAR_AGENT_PROMPT,
} from "../data/stores.js";

const state = {
  selectedId: null,
  selectedOrderId: null,
  orderFilter: "all", // all | material | phone | pos
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
  live: false,
  error: null,
  lastOrderKpi: null,
};

const el = {
  asOf: document.querySelector("[data-as-of]"),
  groupStrip: document.querySelector("[data-group-strip]"),
  storeGrid: document.querySelector("[data-store-grid]"),
  attention: document.querySelector("[data-attention]"),
  detail: document.querySelector("[data-store-detail]"),
  demo: document.querySelector("[data-demo]"),
  ordersPanel: document.querySelector("[data-orders-panel]"),
};

function apiUrl(path) {
  return new URL(path, window.location.origin).toString();
}

function applySnapshot(snapshot, meta = {}) {
  state.stores = (snapshot.stores || []).map((s) => ({ ...s }));
  state.asOf = snapshot.asOf;
  state.analysis = analyzeStores(state.stores);
  state.live = true;
  state.error = null;
  if (meta.kpi) state.lastOrderKpi = meta.kpi;
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
  // Only auto-escalate for a fresh phone/webhook insert
  if (ageMs >= 10 * 60_000) return;

  state.selectedId = "miami-wynwood";
  state.orderFilter = "material";
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
    if (!state.selectedOrderId && rows.length) {
      state.selectedOrderId = rows[0].id;
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

async function fireDemoOrder() {
  /* Live path uses voice webhook only — kept for optional local testing. */
  const res = await fetch(apiUrl("/api/demo-order"), { method: "POST" });
  if (!res.ok) throw new Error("demo-order failed");
  const data = await res.json();
  applySnapshot(data.snapshot, { kpi: data.kpi });
  state.selectedId = "miami-wynwood";
  state.selectedOrderId = null;
  state.orderFilter = "material";
  await loadOrders();
  maybeEscalateFromLiveOrder();
}

const demo = createDemoController({
  onStage: () => {},
  render: () => render(),
});

function statusLabel(status) {
  if (status === "alert") return "Needs attention";
  if (status === "watch") return "Watch";
  return "In compliance";
}

/** Red only when stats say ≥2σ adverse (or watch at 1.5σ). No hardcoded override. */
function storeStatus(analysis) {
  return analysis.status;
}

function renderGroupStrip() {
  if (!state.analysis) {
    el.groupStrip.innerHTML = `<div class="metric"><span class="metric-label">Loading Neon…</span></div>`;
    return;
  }
  const { group } = state.analysis;
  const water = state.stores.reduce(
    (sum, s) => sum + (s.kpis.waterGallonsToday || 0),
    0
  );
  const calls = state.stores.reduce(
    (sum, s) => sum + (s.kpis.phoneCallsToday || 0),
    0
  );
  el.groupStrip.innerHTML = `
    <div class="metric">
      <span class="metric-label">Network revenue</span>
      <strong class="metric-value">${formatKpi(group.revenue, "currency")}</strong>
    </div>
    <div class="metric">
      <span class="metric-label">Orders today</span>
      <strong class="metric-value">${formatKpi(group.orders, "number")}</strong>
    </div>
    <div class="metric">
      <span class="metric-label">Water used today</span>
      <strong class="metric-value">${water.toFixed(0)} gal</strong>
    </div>
    <div class="metric">
      <span class="metric-label">Phone calls</span>
      <strong class="metric-value">${calls}</strong>
      <span class="metric-note">${group.compliantCount}/${group.storeCount} stores in compliance · ${group.openRisks} alerts</span>
    </div>
  `;
}

function chipHtml(store, keys) {
  return keys
    .map((key) => {
      const def = KPI_DEFS.find((d) => d.key === key);
      if (def) {
        return `<span class="chip"><em>${def.label}</em> ${formatKpi(store.kpis[key], def.format)}</span>`;
      }
      if (key === "water") {
        return `<span class="chip"><em>Water</em> ${(store.kpis.waterGallonsToday || 0).toFixed(0)} gal</span>`;
      }
      if (key === "dough") {
        return `<span class="chip"><em>Dough inv</em> ${(store.inventory?.dough || 0).toFixed(0)} lbs</span>`;
      }
      if (key === "calls") {
        return `<span class="chip"><em>Calls</em> ${store.kpis.phoneCallsToday || 0}</span>`;
      }
      if (key === "web") {
        return `<span class="chip"><em>Web</em> ${store.kpis.webSessionsToday || 0}</span>`;
      }
      if (key === "clock") {
        return `<span class="chip"><em>On clock</em> ${store.kpis.employeesOnClock || 0}</span>`;
      }
      return "";
    })
    .join("");
}

function renderStores() {
  if (!state.analysis) {
    el.storeGrid.innerHTML = `<p class="detail-placeholder">Connecting to Neon…</p>`;
    return;
  }
  el.storeGrid.innerHTML = state.analysis.storeAnalyses
    .map((analysis) => {
      const { store, flags } = analysis;
      const status = storeStatus(analysis);
      const selected = state.selectedId === store.id ? "is-selected" : "";
      const pulse =
        store.id === "miami-wynwood" && status === "alert" && store.activeCase
          ? "is-pulsing"
          : "";
      return `
        <button
          type="button"
          class="store-card status-${status} ${selected} ${pulse}"
          data-store-id="${store.id}"
          aria-pressed="${state.selectedId === store.id}"
        >
          <div class="store-card-top">
            <div>
              <h3>${store.name}</h3>
              <p>${store.city || store.neighborhood}</p>
            </div>
            <span class="status-pill">${statusLabel(status)}</span>
          </div>
          <div class="chips">
            ${chipHtml(store, ["revenue", "capacityUtil", "water", "dough", "calls", "clock"])}
          </div>
          <p class="store-meta">
            Cap ${store.capacityPizzas} · web ${store.kpis.webSessionsToday || 0} · ${flags.length} flag${flags.length === 1 ? "" : "s"}
            ${store.activeCase ? ` · <strong>${store.activeCase.qty} pies live</strong>` : ""}
          </p>
        </button>
      `;
    })
    .join("");

  el.storeGrid.querySelectorAll("[data-store-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-store-id");
      state.selectedId = state.selectedId === id ? null : id;
      state.selectedOrderId = null;
      loadOrders().then(render);
    });
  });
}

function renderAttention() {
  if (!state.analysis) return;
  const miami = state.stores.find((s) => s.id === "miami-wynwood");
  const miamiAnalysis = state.analysis.storeAnalyses.find(
    (a) => a.store.id === "miami-wynwood"
  );
  const materialCase =
    miami?.activeCase && miamiAnalysis?.status === "alert"
      ? miami.activeCase
      : null;

  let suggestions = state.analysis.suggestions;
  if (state.selectedId) {
    suggestions = suggestions.filter((s) => s.storeId === state.selectedId);
  }

  const topFlags = (miamiAnalysis?.flags || [])
    .filter((f) => Math.abs(f.z) >= ALERT_Z)
    .slice(0, 3)
    .map((f) => `${f.label} ${f.z >= 0 ? "+" : ""}${f.z.toFixed(1)}σ vs ${f.sourceLabel}`)
    .join(" · ");

  const materialHtml = materialCase
    ? `
    <li class="suggestion severity-alert material-case">
      <div class="suggestion-top">
        <strong>Miami Wynwood · out of compliance</strong>
        <span class="z-badge">≥${ALERT_Z}σ</span>
      </div>
      <p class="suggestion-kpi">${materialCase.caseId || DEMO_ORDER.caseId} · phone order in POS</p>
      <p>${materialCase.qty || DEMO_ORDER.qty} pies · ${materialCase.when || "ASAP"} · ${materialCase.where || "dock Wynwood"}. Inserted into the live order stream — capacity/ticket/inventory broke peer and self-history bands${topFlags ? ` (${topFlags})` : ""}.</p>
    </li>`
    : "";

  if (!suggestions.length && !materialHtml) {
    el.attention.innerHTML = `
      <div class="empty-attention">
        <h3>Owner attention</h3>
        <p>Live DB quiet${state.selectedId ? " for this store" : ""}. Routine simulated orders stay within ${ALERT_Z}σ.</p>
      </div>
    `;
    return;
  }

  el.attention.innerHTML = `
    <div class="attention-head">
      <h3>Owner attention</h3>
      <p>${suggestions.length + (materialHtml ? 1 : 0)} signal${suggestions.length + (materialHtml ? 1 : 0) === 1 ? "" : "s"} · alert at ≥${ALERT_Z}σ</p>
    </div>
    <ul class="suggestion-list">
      ${materialHtml}
      ${suggestions
        .map(
          (s) => `
        <li class="suggestion severity-${s.severity}">
          <div class="suggestion-top">
            <strong>${s.storeName}</strong>
            <span class="z-badge">${s.z >= 0 ? "+" : ""}${s.z.toFixed(1)}σ</span>
          </div>
          <p class="suggestion-kpi">${s.label} · ${s.sourceLabel}</p>
          <p>${s.copy}</p>
        </li>
      `
        )
        .join("")}
    </ul>
  `;
}

function renderDetail() {
  if (!state.selectedId || !state.analysis) {
    el.detail.innerHTML = `
      <p class="detail-placeholder">Select a Joe's location to inspect live Neon KPIs, inventory, and who's on the clock.</p>
    `;
    return;
  }

  const analysis = state.analysis.storeAnalyses.find(
    (a) => a.store.id === state.selectedId
  );
  const { store, flags } = analysis;
  const status = storeStatus(analysis);
  const peer = state.analysis.peerStats;
  const inv = store.inventory || {};

  el.detail.innerHTML = `
    <div class="detail-head">
      <div>
        <h3>${store.name}</h3>
        <p>${store.manager || ""}${store.phone ? ` · ${store.phone}` : ""}</p>
        <p class="metric-note">${store.address || store.neighborhood}</p>
      </div>
      <span class="status-pill status-${status}">${statusLabel(status)}</span>
    </div>
    <div class="detail-kpi-grid">
      ${KPI_DEFS.map((def) => {
        const value = store.kpis[def.key];
        const p = peer[def.key];
        const flag = flags
          .filter((f) => f.kpi === def.key)
          .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
        const peerNote = p
          ? `Peer ${formatKpi(p.mean, def.format)} · σ ${p.stddev.toFixed(2)}`
          : "";
        return `
          <div class="detail-kpi ${flag ? `severity-${flag.severity}` : ""}">
            <span class="metric-label">${def.label}</span>
            <strong>${formatKpi(value || 0, def.format)}</strong>
            <span class="metric-note">${peerNote}${flag ? ` · ${flag.z >= 0 ? "+" : ""}${flag.z.toFixed(1)}σ` : ""}</span>
          </div>
        `;
      }).join("")}
      <div class="detail-kpi">
        <span class="metric-label">Water today</span>
        <strong>${(store.kpis.waterGallonsToday || 0).toFixed(1)} gal</strong>
      </div>
      <div class="detail-kpi">
        <span class="metric-label">Dough produced</span>
        <strong>${(store.kpis.doughLbsToday || 0).toFixed(1)} lbs</strong>
      </div>
      <div class="detail-kpi">
        <span class="metric-label">Web sessions</span>
        <strong>${store.kpis.webSessionsToday || 0}</strong>
      </div>
    </div>
    <div class="ops-grid">
      <div>
        <h4>Inventory</h4>
        <ul class="ops-list">
          ${Object.entries(inv)
            .map(([sku, bal]) => `<li><span>${sku}</span><strong>${Number(bal).toFixed(1)}</strong></li>`)
            .join("") || "<li>No ledger yet</li>"}
        </ul>
      </div>
      <div>
        <h4>On the clock</h4>
        <ul class="ops-list">
          ${(store.onClock || [])
            .map((p) => `<li><span>${p.display_name}</span><strong>${p.role}</strong></li>`)
            .join("") || "<li>None clocked in</li>"}
        </ul>
      </div>
    </div>
  `;
}

function renderOrders() {
  if (!el.ordersPanel) return;
  const { summary, rows } = state.orders;
  const selected =
    rows.find((o) => o.id === state.selectedOrderId) || rows[0] || null;
  const storeFilter = state.selectedId
    ? state.stores.find((s) => s.id === state.selectedId)?.name ||
      state.selectedId
    : "All locations";

  const filters = [
    { id: "all", label: "All" },
    { id: "material", label: "Material" },
    { id: "phone", label: "Phone" },
    { id: "pos", label: "Counter / other" },
  ];

  el.ordersPanel.innerHTML = `
    <div class="panel-head orders-head">
      <div>
        <h2>Orders</h2>
        <p>${storeFilter} · live POS stream · click a row for full detail</p>
      </div>
      <div class="order-filters" role="tablist" aria-label="Order filters">
        ${filters
          .map(
            (f) => `
          <button
            type="button"
            class="order-filter ${state.orderFilter === f.id ? "is-active" : ""}"
            data-order-filter="${f.id}"
            role="tab"
            aria-selected="${state.orderFilter === f.id}"
          >${f.label}</button>`
          )
          .join("")}
      </div>
    </div>

    <div class="order-summary">
      <div class="metric compact">
        <span class="metric-label">Orders today</span>
        <strong class="metric-value">${formatKpi(summary.orderCount, "number")}</strong>
      </div>
      <div class="metric compact">
        <span class="metric-label">Pizzas today</span>
        <strong class="metric-value">${formatKpi(summary.pizzaCount, "number")}</strong>
      </div>
      <div class="metric compact">
        <span class="metric-label">Ticket revenue</span>
        <strong class="metric-value">${money(summary.revenueCents)}</strong>
      </div>
      <div class="metric compact">
        <span class="metric-label">Material cases</span>
        <strong class="metric-value ${summary.materialCount ? "is-alert" : ""}">${formatKpi(summary.materialCount, "number")}</strong>
        <span class="metric-note">${(summary.byChannel || [])
          .map((c) => `${channelLabel(c.channel)} ${c.count}`)
          .join(" · ") || "No tickets yet"}</span>
      </div>
    </div>

    <div class="orders-workspace">
      <div class="order-list" role="listbox" aria-label="Order records">
        ${
          rows.length
            ? rows
                .map((o) => {
                  const active = selected?.id === o.id ? "is-selected" : "";
                  return `
                  <button
                    type="button"
                    class="order-row ${active} ${o.isMaterial ? "is-material" : ""}"
                    data-order-id="${o.id}"
                    role="option"
                    aria-selected="${selected?.id === o.id}"
                  >
                    <div class="order-row-main">
                      <strong>${o.storeName}</strong>
                      <span class="order-row-meta">${o.pizzaCount} × ${itemDisplay(o)}</span>
                    </div>
                    <div class="order-row-side">
                      <span class="order-amount">${money(o.ticketCents)}</span>
                      <span class="order-row-meta">${timeLabel(o.occurredAt)}</span>
                      ${
                        o.isMaterial
                          ? `<span class="order-tag alert">Material</span>`
                          : `<span class="order-tag">${channelLabel(o.channel)}</span>`
                      }
                    </div>
                  </button>`;
                })
                .join("")
            : `<p class="detail-placeholder">No orders match this filter${state.selectedId ? " for the selected store" : ""}.</p>`
        }
      </div>

      <aside class="order-detail" aria-live="polite">
        ${
          selected
            ? `
          <div class="detail-head">
            <div>
              <h3>${selected.caseId || `Ticket ${selected.id.slice(0, 8)}`}</h3>
              <p>${selected.storeName} · ${selected.city || selected.neighborhood || ""}</p>
              <p class="metric-note">${selected.address || ""}</p>
            </div>
            <span class="status-pill ${selected.isMaterial ? "status-alert" : "status-ok"}">
              ${selected.isMaterial ? "Material case" : "Routine"}
            </span>
          </div>

          <div class="order-detail-stats">
            <div class="detail-kpi ${selected.isMaterial ? "severity-alert" : ""}">
              <span class="metric-label">Pizzas</span>
              <strong>${formatKpi(selected.pizzaCount, "number")}</strong>
            </div>
            <div class="detail-kpi">
              <span class="metric-label">Ticket</span>
              <strong>${money(selected.ticketCents)}</strong>
            </div>
            <div class="detail-kpi">
              <span class="metric-label">Channel</span>
              <strong>${channelLabel(selected.channel)}</strong>
              <span class="metric-note">${selected.status}</span>
            </div>
          </div>

          <dl class="order-facts">
            <div>
              <dt>Item</dt>
              <dd>${itemDisplay(selected)}</dd>
            </div>
            <div>
              <dt>When needed</dt>
              <dd>${selected.whenNeeded || "—"}</dd>
            </div>
            <div>
              <dt>Delivery / pickup</dt>
              <dd>${selected.deliveryWhere || "—"}</dd>
            </div>
            <div>
              <dt>Accepted</dt>
              <dd>${timeLabel(selected.occurredAt)}</dd>
            </div>
            ${
              selected.caseId
                ? `<div>
              <dt>Case ID</dt>
              <dd class="mono">${selected.caseId}</dd>
            </div>`
                : ""
            }
            ${
              selected.note
                ? `<div class="full">
              <dt>Note</dt>
              <dd>${selected.note}</dd>
            </div>`
                : ""
            }
          </dl>

          <div class="order-line-items">
            <h4>Line items</h4>
            <ul class="ops-list">
              ${(selected.items || [])
                .map(
                  (line) =>
                    `<li><span>${
                      (line.item || "Item") === "mixed_pies"
                        ? "mixed pies"
                        : line.item || "Item"
                    }${line.qty ? ` × ${line.qty}` : ""}</span><strong>${
                      line.qty && selected.pizzaCount
                        ? money(
                            Math.round(
                              (selected.ticketCents / selected.pizzaCount) *
                                (line.qty || 0)
                            )
                          )
                        : money(selected.ticketCents)
                    }</strong></li>`
                )
                .join("") || "<li><span>No line items</span><strong>—</strong></li>"}
            </ul>
          </div>

          <div class="order-detail-actions">
            <button type="button" class="btn btn-ghost" data-jump-store="${selected.storeId}">
              Open ${selected.storeName}
            </button>
          </div>
        `
            : `<p class="detail-placeholder">Select an order to inspect pizzas, ticket, delivery window, and case ID.</p>`
        }
      </aside>
    </div>
  `;

  el.ordersPanel.querySelectorAll("[data-order-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.orderFilter = btn.getAttribute("data-order-filter");
      loadOrders().then(render);
    });
  });

  el.ordersPanel.querySelectorAll("[data-order-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedOrderId = btn.getAttribute("data-order-id");
      render();
    });
  });

  el.ordersPanel.querySelector("[data-jump-store]")?.addEventListener("click", (e) => {
    const id = e.currentTarget.getAttribute("data-jump-store");
    state.selectedId = id;
    loadOrders().then(render);
  });
}

function renderDemo() {
  const stage = demo.stage;
  const lines = demo.transcript();
  const ownerLines = demo.ownerTranscript();

  const stageNote = {
    idle: "Live Neon DB is writing Joe's ops now. Run the 300-pie path when ready.",
    call: "Cashier intake (also Retell-ready).",
    entered: "Order in POS — KPIs recomputed; Wynwood is red at ≥2σ.",
    owner_call: "OwnerRadar is calling the owner (your partner).",
    enrich: "Looking up who's running the Wynwood dock event…",
    found: "Found them — LinkedIn + public info texted to the owner.",
  }[stage];

  el.demo.innerHTML = `
    <div class="demo-head">
      <div>
        <h2>Hackathon live path</h2>
        <p>${stageNote}</p>
      </div>
      <div class="demo-actions">
        <button type="button" class="btn btn-primary" data-demo-run ${stage === "call" ? "disabled" : ""}>
          ${stage === "idle" ? "Run 300-pizza demo" : "Replay demo"}
        </button>
        <button type="button" class="btn btn-ghost" data-demo-reset>Reset view</button>
      </div>
    </div>
    <div class="demo-grid">
      <section class="demo-card">
        <h3>1 · Call Joe's cashier</h3>
        <ol class="transcript">
          ${
            lines.length
              ? lines
                  .map(
                    (l) =>
                      `<li><span class="who">${l.who}</span><span class="said">${l.text}</span></li>`
                  )
                  .join("")
              : `<li class="muted">Waiting to dial Mia at Joe's Miami Wynwood…</li>`
          }
        </ol>
      </section>
      <section class="demo-card">
        <h3>2 · Owner call</h3>
        <ol class="transcript">
          ${
            ownerLines.length
              ? ownerLines
                  .map(
                    (l) =>
                      `<li><span class="who">${l.who}</span><span class="said">${l.text}</span></li>`
                  )
                  .join("")
              : `<li class="muted">Owner stays quiet until the order is material.</li>`
          }
        </ol>
        ${
          stage === "owner_call"
            ? `<button type="button" class="btn btn-primary" data-demo-yes>Owner: Yes — find who's in charge</button>`
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
      <summary>Cashier agent prompt (paste into Retell / voice agent)</summary>
      <pre>${CASHIER_AGENT_PROMPT.replace(/</g, "&lt;")}</pre>
    </details>
  `;

  el.demo.querySelector("[data-demo-run]")?.addEventListener("click", () => {
    demo.playCall();
  });
  el.demo.querySelector("[data-demo-reset]")?.addEventListener("click", () => {
    state.selectedId = null;
    state.selectedOrderId = null;
    state.orderFilter = "all";
    demo.reset();
    Promise.all([loadSnapshot(true), loadOrders()]).then(render);
  });
  el.demo.querySelector("[data-demo-yes]")?.addEventListener("click", () => {
    demo.approveEnrichment();
  });
}

function render() {
  el.asOf.textContent = state.asOf
    ? `Neon live · ${new Date(state.asOf).toLocaleTimeString()}`
    : "Connecting to Neon…";
  if (state.error) {
    el.asOf.textContent = `DB error: ${state.error}`;
  }
  renderDemo();
  renderGroupStrip();
  renderOrders();
  renderStores();
  renderAttention();
  renderDetail();
}

async function boot() {
  render();
  await loadSnapshot(false);
  await Promise.all([loadFeed(), loadOrders()]);
  render();
  setInterval(async () => {
    await loadSnapshot(true);
    await Promise.all([loadFeed(), loadOrders()]);
    maybeEscalateFromLiveOrder();
    render();
  }, 5000);
}

boot();
