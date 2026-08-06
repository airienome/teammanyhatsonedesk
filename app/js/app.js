import { ORG } from "../data/stores.js";
import {
  analyzeStores,
  formatKpi,
  KPI_DEFS,
} from "./stats.js";

const state = {
  selectedId: null,
  analysis: analyzeStores(),
};

const el = {
  asOf: document.querySelector("[data-as-of]"),
  groupStrip: document.querySelector("[data-group-strip]"),
  storeGrid: document.querySelector("[data-store-grid]"),
  attention: document.querySelector("[data-attention]"),
  detail: document.querySelector("[data-store-detail]"),
};

function statusLabel(status) {
  if (status === "alert") return "Needs attention";
  if (status === "watch") return "Watch";
  return "In compliance";
}

function renderGroupStrip() {
  const { group } = state.analysis;
  el.groupStrip.innerHTML = `
    <div class="metric">
      <span class="metric-label">Group revenue</span>
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
  const { storeAnalyses } = state.analysis;
  el.storeGrid.innerHTML = storeAnalyses
    .map(({ store, status, flags }) => {
      const selected = state.selectedId === store.id ? "is-selected" : "";
      return `
        <button
          type="button"
          class="store-card status-${status} ${selected}"
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
  let suggestions = state.analysis.suggestions;
  if (state.selectedId) {
    suggestions = suggestions.filter((s) => s.storeId === state.selectedId);
  }

  if (!suggestions.length) {
    el.attention.innerHTML = `
      <div class="empty-attention">
        <h3>Owner attention</h3>
        <p>No material statistical deviations${state.selectedId ? " for this store" : ""}. Routine activity stays quiet.</p>
      </div>
    `;
    return;
  }

  el.attention.innerHTML = `
    <div class="attention-head">
      <h3>Owner attention</h3>
      <p>${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} · sorted by |z|</p>
    </div>
    <ul class="suggestion-list">
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
      <p class="detail-placeholder">Select a store to inspect every owner KPI against peer and self-history baselines.</p>
    `;
    return;
  }

  const analysis = state.analysis.storeAnalyses.find(
    (a) => a.store.id === state.selectedId
  );
  const { store, status, flags } = analysis;
  const peer = state.analysis.peerStats;

  el.detail.innerHTML = `
    <div class="detail-head">
      <div>
        <h3>${store.name}</h3>
        <p>${store.manager}</p>
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

function render() {
  el.asOf.textContent = `As of ${new Date(ORG.asOf).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  })}`;
  renderGroupStrip();
  renderStores();
  renderAttention();
  renderDetail();
}

render();
