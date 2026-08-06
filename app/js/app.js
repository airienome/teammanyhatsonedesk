import {
  ORG,
  STORES,
  cloneStores,
  DEMO_ORDER,
  EVENT_ORGANIZER,
  CASHIER_AGENT_PROMPT,
} from "../data/stores.js";
import { analyzeStores, formatKpi, KPI_DEFS } from "./stats.js";
import { createDemoController } from "./demo.js";

const state = {
  selectedId: null,
  stores: cloneStores(STORES),
  analysis: null,
};

function refreshAnalysis() {
  state.analysis = analyzeStores(state.stores);
}

refreshAnalysis();

const el = {
  asOf: document.querySelector("[data-as-of]"),
  groupStrip: document.querySelector("[data-group-strip]"),
  storeGrid: document.querySelector("[data-store-grid]"),
  attention: document.querySelector("[data-attention]"),
  detail: document.querySelector("[data-store-detail]"),
  demo: document.querySelector("[data-demo]"),
};

const demo = createDemoController({
  getStores: () => state.stores,
  setStores: (stores) => {
    state.stores = stores;
    refreshAnalysis();
    if (stores.some((s) => s.activeCase)) {
      state.selectedId = "miami-wynwood";
    }
  },
  onStage: () => {},
  render: () => render(),
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
  const { group } = state.analysis;
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
      <span class="metric-label">Open statistical risks</span>
      <strong class="metric-value ${group.openRisks ? "is-alert" : ""}">${group.openRisks}</strong>
    </div>
    <div class="metric">
      <span class="metric-label">Stores in compliance</span>
      <strong class="metric-value">${group.compliantCount}/${group.storeCount}</strong>
      <span class="metric-note">within 1.5σ on tracked KPIs</span>
    </div>
  `;
}

function chipHtml(store, keys) {
  return keys
    .map((key) => {
      const def = KPI_DEFS.find((d) => d.key === key);
      return `<span class="chip"><em>${def.label}</em> ${formatKpi(store.kpis[key], def.format)}</span>`;
    })
    .join("");
}

function renderStores() {
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
              <p>${store.neighborhood}</p>
            </div>
            <span class="status-pill">${statusLabel(status)}</span>
          </div>
          <div class="chips">
            ${chipHtml(store, ["revenue", "capacityUtil", "refundRate", "staffingFill", "inventoryDays"])}
          </div>
          <p class="store-meta">
            Cap ${store.capacityPizzas} · ${store.vanAvailable ? "Van ready" : "No van"} · ${flags.length} flag${flags.length === 1 ? "" : "s"}
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
      <p class="suggestion-kpi">${DEMO_ORDER.caseId} · cashier accepted</p>
      <p>${DEMO_ORDER.qty} ${DEMO_ORDER.item} · ${DEMO_ORDER.when} · ${DEMO_ORDER.where} · ~$${DEMO_ORDER.value.toLocaleString()}. Location is red because capacity and inventory just broke peer and self-history bands.</p>
    </li>`
    : "";

  if (!suggestions.length && !materialHtml) {
    el.attention.innerHTML = `
      <div class="empty-attention">
        <h3>Owner attention</h3>
        <p>No material statistical deviations${state.selectedId ? " for this store" : ""}. Routine Joe's activity stays quiet.</p>
      </div>
    `;
    return;
  }

  el.attention.innerHTML = `
    <div class="attention-head">
      <h3>Owner attention</h3>
      <p>${suggestions.length + (materialHtml ? 1 : 0)} signal${suggestions.length + (materialHtml ? 1 : 0) === 1 ? "" : "s"} · sorted by impact</p>
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
  if (!state.selectedId) {
    el.detail.innerHTML = `
      <p class="detail-placeholder">Select a Joe's location to inspect every owner KPI against peer and self-history baselines.</p>
    `;
    return;
  }

  const analysis = state.analysis.storeAnalyses.find(
    (a) => a.store.id === state.selectedId
  );
  const { store, flags } = analysis;
  const status = effectiveStatus(analysis);
  const peer = state.analysis.peerStats;

  el.detail.innerHTML = `
    <div class="detail-head">
      <div>
        <h3>${store.name}</h3>
        <p>${store.manager}${store.phone ? ` · ${store.phone}` : ""}</p>
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
        const peerNote = `Peer ${formatKpi(p.mean, def.format)} · σ ${p.stddev.toFixed(2)}`;
        return `
          <div class="detail-kpi ${flag ? `severity-${flag.severity}` : ""}">
            <span class="metric-label">${def.label}</span>
            <strong>${formatKpi(value, def.format)}</strong>
            <span class="metric-note">${peerNote}${flag ? ` · ${flag.z >= 0 ? "+" : ""}${flag.z.toFixed(1)}σ ${flag.sourceLabel}` : ""}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderDemo() {
  const stage = demo.stage;
  const lines = demo.transcript();
  const ownerLines = demo.ownerTranscript();

  const stageNote = {
    idle: "Press run — you'll order 300 pies from a Joe's Wynwood cashier agent.",
    call: "Live cashier intake (Retell-ready prompt below).",
    entered: "Order hit POS — Miami Wynwood just turned red.",
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
        <button type="button" class="btn btn-ghost" data-demo-reset>Reset</button>
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
        ${
          stage === "enrich"
            ? `<p class="searching">Searching public event + people graph…</p>`
            : ""
        }
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
  });
  el.demo.querySelector("[data-demo-yes]")?.addEventListener("click", () => {
    demo.approveEnrichment();
  });
}

function render() {
  el.asOf.textContent = `As of ${new Date(ORG.asOf).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  })}`;
  renderDemo();
  renderGroupStrip();
  renderStores();
  renderAttention();
  renderDetail();
}

render();
