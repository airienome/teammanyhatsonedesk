import { analyzeStores, formatKpi, KPI_DEFS } from "./stats.js";
import { createDemoController } from "./demo.js";
import {
  DEMO_ORDER,
  EVENT_ORGANIZER,
  CASHIER_AGENT_PROMPT,
} from "../data/stores.js";

const state = {
  selectedId: null,
  stores: [],
  analysis: null,
  feed: { events: [], calls: [], clocks: [] },
  asOf: null,
  live: false,
  error: null,
};

const el = {
  asOf: document.querySelector("[data-as-of]"),
  groupStrip: document.querySelector("[data-group-strip]"),
  storeGrid: document.querySelector("[data-store-grid]"),
  attention: document.querySelector("[data-attention]"),
  detail: document.querySelector("[data-store-detail]"),
  demo: document.querySelector("[data-demo]"),
  liveFeed: document.querySelector("[data-live-feed]"),
};

function apiUrl(path) {
  return new URL(path, window.location.origin).toString();
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
    state.stores = snapshot.stores.map((s) => ({
      ...s,
      capacityPizzas: s.capacityPizzas,
      vanAvailable: s.vanAvailable,
      activeCase: s.id === "miami-wynwood" && s.kpis?.capacityUtil >= 90
        ? { ...DEMO_ORDER, status: "accepted" }
        : s.activeCase,
    }));
    state.asOf = snapshot.asOf;
    state.analysis = analyzeStores(state.stores);
    state.live = true;
    state.error = null;
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

async function fireDemoOrder() {
  const res = await fetch(apiUrl("/api/demo-order"), { method: "POST" });
  if (!res.ok) throw new Error("demo-order failed");
  const data = await res.json();
  state.stores = data.snapshot.stores.map((s) => ({
    ...s,
    activeCase:
      s.id === "miami-wynwood"
        ? { ...DEMO_ORDER, status: "accepted" }
        : undefined,
  }));
  state.asOf = data.snapshot.asOf;
  state.analysis = analyzeStores(state.stores);
  state.selectedId = "miami-wynwood";
}

const demo = createDemoController({
  getStores: () => state.stores,
  setStores: (stores) => {
    state.stores = stores;
    state.analysis = analyzeStores(stores);
  },
  onStage: () => {},
  render: () => render(),
  fireDemoOrder,
});

function statusLabel(status) {
  if (status === "alert") return "Needs attention";
  if (status === "watch") return "Watch";
  return "In compliance";
}

function effectiveStatus(analysis) {
  const material =
    analysis.store.id === "miami-wynwood" &&
    analysis.store.activeCase &&
    ["entered", "owner_call", "enrich", "found"].includes(demo.stage);
  return material ? "alert" : analysis.status;
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
      const status = effectiveStatus(analysis);
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
      render();
    });
  });
}

function renderAttention() {
  if (!state.analysis) return;
  const materialCase =
    demo.stage !== "idle" &&
    demo.stage !== "call" &&
    state.stores.find((s) => s.id === "miami-wynwood")?.activeCase;

  let suggestions = state.analysis.suggestions;
  if (state.selectedId) {
    suggestions = suggestions.filter((s) => s.storeId === state.selectedId);
  }

  const materialHtml = materialCase
    ? `
    <li class="suggestion severity-alert material-case">
      <div class="suggestion-top">
        <strong>Miami Wynwood · material order</strong>
        <span class="z-badge">LIVE</span>
      </div>
      <p class="suggestion-kpi">${DEMO_ORDER.caseId} · written to Neon</p>
      <p>${DEMO_ORDER.qty} ${DEMO_ORDER.item} · ${DEMO_ORDER.when} · ${DEMO_ORDER.where}. POS + inventory + utilities updated in Postgres.</p>
    </li>`
    : "";

  if (!suggestions.length && !materialHtml) {
    el.attention.innerHTML = `
      <div class="empty-attention">
        <h3>Owner attention</h3>
        <p>Live DB quiet${state.selectedId ? " for this store" : ""}. Simulator keeps writing ops to Neon.</p>
      </div>
    `;
    return;
  }

  el.attention.innerHTML = `
    <div class="attention-head">
      <h3>Owner attention</h3>
      <p>${suggestions.length + (materialHtml ? 1 : 0)} signal${suggestions.length + (materialHtml ? 1 : 0) === 1 ? "" : "s"} · Neon-backed</p>
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
  const status = effectiveStatus(analysis);
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

function renderLiveFeed() {
  if (!el.liveFeed) return;
  const events = state.feed.events || [];
  const clocks = state.feed.clocks || [];
  const calls = state.feed.calls || [];
  el.liveFeed.innerHTML = `
    <div class="panel-head">
      <h2>Live ops feed</h2>
      <p>Postgres event stream · ${state.live ? "connected" : state.error || "connecting"}</p>
    </div>
    <div class="feed-grid">
      <div class="demo-card">
        <h3>Store pulses</h3>
        <ul class="ops-list compact">
          ${events
            .slice(0, 8)
            .map(
              (e) =>
                `<li><span>${e.store_id}</span><strong>${e.body || e.title}</strong></li>`
            )
            .join("") || "<li>Waiting for simulator…</li>"}
        </ul>
      </div>
      <div class="demo-card">
        <h3>Clock + calls</h3>
        <ul class="ops-list compact">
          ${clocks
            .slice(0, 4)
            .map(
              (c) =>
                `<li><span>${c.display_name}</span><strong>${c.event_type}</strong></li>`
            )
            .join("")}
          ${calls
            .slice(0, 4)
            .map(
              (c) =>
                `<li><span>${c.store_id}</span><strong>${c.direction} · ${c.outcome}</strong></li>`
            )
            .join("") || ""}
        </ul>
      </div>
    </div>
  `;
}

function renderDemo() {
  const stage = demo.stage;
  const lines = demo.transcript();
  const ownerLines = demo.ownerTranscript();

  const stageNote = {
    idle: "Live Neon DB is writing Joe's ops now. Run the 300-pie path when ready.",
    call: "Cashier intake (also Retell-ready).",
    entered: "Order persisted to Postgres — Miami Wynwood turned red.",
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
    demo.reset();
    loadSnapshot(true).then(render);
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
  renderStores();
  renderAttention();
  renderDetail();
  renderLiveFeed();
}

async function boot() {
  render();
  await loadSnapshot(false);
  await loadFeed();
  render();
  // Generate fresh fake ops on an interval and refresh UI
  setInterval(async () => {
    await loadSnapshot(true);
    await loadFeed();
    render();
  }, 5000);
}

boot();
