import { formatKpi, KPI_DEFS, ALERT_Z } from "../stats.js";
import { tileShell } from "./tiles.js";
import {
  money,
  timeLabel,
  timeShort,
  channelLabel,
  itemDisplay,
  statusLabel,
  toTileStatus,
  escapeHtml,
  vsExpectedCopy,
  severityConfidence,
  plainAlertTitle,
  materialCaseTitle,
  materialCaseImpact,
  materialRecommendedAction,
  locationDiagnostic,
  orderExceptionTag,
  recentOrdersWindow,
  estimatedExposure,
  shortHash,
  chainStatusLabel,
} from "./format.js";
import {
  DEMO_ORDER,
  DIGEST_ITEMS,
  EVENT_ORGANIZER,
  OWNER_RADAR_AGENT_PROMPT,
} from "../../data/stores.js";

function pref(prefs, id) {
  return prefs[id] || { expanded: false, pinned: false };
}

function watchCount(analysis) {
  return (analysis?.storeAnalyses || []).filter((a) => a.status === "watch")
    .length;
}

function networkNarrative(analysis, stores) {
  const group = analysis?.group;
  if (!group) return "Loading network analysis…";
  const alerts = group.openRisks || 0;
  const watch = watchCount(analysis);
  if (!alerts && !watch) {
    return "All businesses look normal right now.";
  }
  const parts = [];
  const miami = stores?.find((s) => s.id === "plant-the-future");
  const miamiA = analysis.storeAnalyses.find(
    (a) => a.store.id === "plant-the-future"
  );
  if (miami?.activeCase && miamiA?.status === "alert") {
    parts.push("one rush mural commission");
  }
  const inv = analysis.suggestions.find((s) => s.kpi === "inventoryDays");
  if (inv) parts.push("one inventory risk");
  const disc = analysis.suggestions.find((s) => s.kpi === "discountRate");
  if (disc) parts.push("one shop discounting more than usual");
  if (!parts.length) {
    const top = analysis.suggestions[0];
    if (top) parts.push((top.title || `${top.label} at ${top.storeName}`).toLowerCase());
  }
  const lead =
    alerts === 1
      ? "1 business needs attention"
      : `${alerts} businesses need attention`;
  const detail = parts.length
    ? parts.slice(0, 3).join(", ").replace(/, ([^,]*)$/, ", and $1")
    : `${watch} on watch`;
  return `${lead}. ${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`;
}

/* ─── Header / banner / KPIs ─── */

export function renderCommandStatus(el, state) {
  if (!el) return;
  const group = state.analysis?.group;
  const alerts = group?.openRisks || 0;
  const watch = watchCount(state.analysis);
  let label = "Network normal";
  let cls = "status-ok";
  if (alerts > 0) {
    label = `${alerts} need attention`;
    cls = "status-alert";
  } else if (watch > 0) {
    label = `${watch} on watch`;
    cls = "status-watch";
  } else if (!state.live) {
    label = state.error ? "Offline" : "Connecting…";
    cls = "status-watch";
  }
  el.className = `command-status ${cls}`;
  el.innerHTML = `<span class="live-dot" aria-hidden="true"></span><span data-status-label>${escapeHtml(label)}</span>`;
}

export function renderNetworkBanner(el, state, { onReviewAlerts }) {
  if (!el) return;
  if (!state.analysis) {
    el.innerHTML = `<div class="network-banner-inner"><p>Connecting to Neon…</p></div>`;
    return;
  }
  const { group } = state.analysis;
  const watch = watchCount(state.analysis);
  const alerts = group.openRisks || 0;
  const status =
    alerts > 0 ? "attention" : watch > 0 ? "watch" : "normal";
  const narrative = networkNarrative(state.analysis, state.stores);
  const asOf = state.asOf
    ? timeShort(state.asOf)
    : "—";

  el.innerHTML = `
    <div class="network-banner-inner status-${status}">
      <div class="network-banner-main">
        <div class="network-banner-title-row">
          <span class="status-badge status-${status}">${statusLabel(status === "attention" ? "alert" : status)}</span>
          <h2>${alerts > 0 ? `${alerts} location${alerts === 1 ? "" : "s"} need attention` : watch > 0 ? `Network on watch` : `Network operating normally`}</h2>
        </div>
        <p class="network-banner-copy">${escapeHtml(narrative)}</p>
        <div class="network-counts">
          <span><strong class="tabular">${group.compliantCount}</strong> normal</span>
          <span><strong class="tabular">${watch}</strong> watch</span>
          <span><strong class="tabular">${alerts}</strong> attention</span>
          <span class="network-asof">Last analysis ${escapeHtml(asOf)} ET</span>
        </div>
      </div>
      <div class="network-banner-actions">
        <button type="button" class="btn btn-primary" data-review-alerts>Review alerts</button>
      </div>
    </div>
  `;
  el.querySelector("[data-review-alerts]")?.addEventListener("click", onReviewAlerts);
}

export function renderExecutiveKpis(el, state, { onMetric }) {
  if (!el) return;
  if (!state.analysis) {
    el.innerHTML = `<div class="kpi-card"><span class="metric-label">Loading…</span></div>`;
    return;
  }
  const { group, peerStats, storeAnalyses } = state.analysis;
  const calls = state.stores.reduce(
    (sum, s) => sum + (s.kpis.phoneCallsToday || 0),
    0
  );
  const avgTicket =
    group.orders > 0
      ? state.stores.reduce((s, x) => s + (x.kpis.avgTicket || 0), 0) /
        storeAnalyses.length
      : peerStats.avgTicket?.mean || 0;
  const exposure = estimatedExposure(state.stores, state.analysis);
  const peerRev = peerStats.revenue?.mean
    ? peerStats.revenue.mean * group.storeCount
    : null;
  const peerOrd = peerStats.orders?.mean
    ? peerStats.orders.mean * group.storeCount
    : null;

  const cards = [
    {
      id: "revenue",
      label: "Sales today",
      value: formatKpi(group.revenue, "currency"),
      note: vsExpectedCopy(group.revenue, peerRev, "currency", true),
      status: "normal",
    },
    {
      id: "orders",
      label: "Orders today",
      value: formatKpi(group.orders, "number"),
      note: vsExpectedCopy(group.orders, peerOrd, "number", true),
      status: "normal",
    },
    {
      id: "avgTicket",
      label: "Average ticket",
      value: formatKpi(avgTicket, "currency"),
      note: vsExpectedCopy(
        avgTicket,
        peerStats.avgTicket?.mean,
        "currency",
        true
      ),
      status: "normal",
    },
    {
      id: "phone",
      label: "Phone calls",
      value: formatKpi(calls, "number"),
      note: "Across the network today",
      status: "normal",
    },
    {
      id: "attention",
      label: "Need attention",
      value: formatKpi(group.openRisks, "number"),
      note: `${group.compliantCount} of ${group.storeCount} normal`,
      status: group.openRisks > 0 ? "attention" : "normal",
    },
    {
      id: "exposure",
      label: "Est. exposure",
      value: formatKpi(exposure, "currency"),
      note: "Material cases + alert risk",
      status: exposure > 1000 ? "watch" : "normal",
    },
  ];

  el.innerHTML = cards
    .map(
      (c) => `
    <button type="button" class="kpi-card status-${c.status}" data-kpi="${c.id}" title="Open metric detail">
      <span class="metric-label">${c.label}</span>
      <strong class="metric-value tabular">${c.value}</strong>
      <span class="metric-note">${escapeHtml(c.note)}</span>
    </button>`
    )
    .join("");

  el.querySelectorAll("[data-kpi]").forEach((btn) => {
    btn.addEventListener("click", () => onMetric(btn.getAttribute("data-kpi")));
  });
}

/* ─── Attention ─── */

function isDismissed(state, key) {
  return state.dismissedAlerts?.has(key);
}

export function buildAttentionItems(state) {
  const items = [];
  const miami = state.stores.find((s) => s.id === "plant-the-future");
  const miamiAnalysis = state.analysis?.storeAnalyses.find(
    (a) => a.store.id === "plant-the-future"
  );
  const materialCase =
    miami?.activeCase && miamiAnalysis?.status === "alert"
      ? miami.activeCase
      : null;

  if (materialCase) {
    const key = `material:${materialCase.caseId || miami.id}`;
    if (!isDismissed(state, key)) {
      const mathBits = [
        materialCase.caseId || DEMO_ORDER.caseId,
        materialCase.qty ? `${materialCase.qty} panels` : null,
        materialCase.breachSummary || materialCase.spc?.breachSummary || null,
      ].filter(Boolean);
      items.push({
        key,
        urgency: "now",
        severity: "alert",
        storeId: miami.id,
        storeName: miami.name,
        title: materialCaseTitle(materialCase, miami.name),
        why: materialCaseImpact(materialCase),
        impact: materialCase.value
          ? formatKpi(materialCase.value, "currency")
          : "High capacity risk",
        detected: materialCase.eventAt || state.asOf,
        confidence: "High",
        action: materialRecommendedAction(),
        tech: mathBits.join(" · "),
        kind: "material",
        case: materialCase,
      });
    }
  }

  let suggestions = state.analysis?.suggestions || [];
  if (state.selectedId) {
    suggestions = suggestions.filter((s) => s.storeId === state.selectedId);
  }
  if (state.commandQuery) {
    const q = state.commandQuery.toLowerCase();
    suggestions = suggestions.filter(
      (s) =>
        s.storeName.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q) ||
        (s.plainLabel || "").toLowerCase().includes(q) ||
        (s.copy || "").toLowerCase().includes(q) ||
        (s.title || "").toLowerCase().includes(q)
    );
  }

  for (const s of suggestions) {
    const key = `flag:${s.storeId}:${s.kpi}:${s.source}`;
    if (isDismissed(state, key)) continue;
    items.push({
      key,
      urgency: s.severity === "alert" ? "now" : "soon",
      severity: s.severity,
      storeId: s.storeId,
      storeName: s.storeName,
      title: s.title || plainAlertTitle(s),
      why: s.copy,
      impact: `${formatKpi(s.value, s.format)} vs ${formatKpi(s.baseline, s.format)} usual`,
      detected: state.asOf,
      confidence: severityConfidence(s.z),
      action: KPI_DEFS.find((d) => d.key === s.kpi)?.suggestion || "Review with the GM.",
      tech:
        s.math ||
        `${s.label}: ${formatKpi(s.value, s.format)} vs ${s.sourceLabel} ${formatKpi(s.baseline, s.format)} · z = ${s.z >= 0 ? "+" : ""}${s.z.toFixed(2)}σ`,
      kind: "flag",
      flag: s,
    });
  }

  return items;
}

export function renderAttentionTile(mount, state, prefs, handlers) {
  if (!mount) return;
  const p = pref(prefs, "attention");
  const items = buildAttentionItems(state);
  const exposure = estimatedExposure(state.stores, state.analysis);
  const now = items.filter((i) => i.urgency === "now");
  const soon = items.filter((i) => i.urgency === "soon");
  const status =
    now.length > 0 ? "attention" : soon.length > 0 ? "watch" : "normal";

  const groupHtml = (title, list) => {
    if (!list.length) return "";
    return `
      <div class="inbox-group">
        <h3>${title}</h3>
        <ul class="inbox-list">
          ${list
            .map(
              (item) => `
            <li class="inbox-item severity-${item.severity}">
              <div class="inbox-item-top">
                <strong>${escapeHtml(item.title)}</strong>
                <span class="confidence">${escapeHtml(item.confidence)}</span>
              </div>
              <p class="inbox-meta">${escapeHtml(item.storeName)} · ${timeLabel(item.detected)} · ${escapeHtml(String(item.impact))}</p>
              <p>${escapeHtml(item.why)}</p>
              <div class="inbox-controls">
                <button type="button" class="btn btn-ghost btn-sm" data-alert-evidence="${escapeHtml(item.key)}">Details</button>
                <button type="button" class="btn btn-primary btn-sm" data-alert-resolve="${escapeHtml(item.key)}">Resolve</button>
              </div>
            </li>`
            )
            .join("")}
        </ul>
      </div>`;
  };

  let bodyHtml;
  if (!items.length) {
    bodyHtml = `
      <div class="empty-attention">
        <p>Nothing unusual right now${state.selectedId ? " at this business" : ""}. We'll flag anything that looks off versus other businesses or this week's usual.</p>
      </div>`;
  } else {
    bodyHtml = `
      ${groupHtml("Act now", now)}
      ${groupHtml("Review soon", soon)}
    `;
  }

  mount.innerHTML = tileShell({
    id: "attention",
    title: "Owner Attention",
    status,
    headline: `${items.length} unresolved`,
    secondaryMetric: `Est. exposure ${formatKpi(exposure, "currency")}`,
    summary:
      items.length === 0
        ? "Inbox clear — nothing odd across the network"
        : `${now.length} act now · ${soon.length} review soon`,
    alertCount: now.length,
    expanded: p.expanded,
    pinned: p.pinned,
    bodyHtml,
  });

  mount.querySelectorAll("[data-alert-resolve]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onDismiss(btn.getAttribute("data-alert-resolve"));
    });
  });
  mount.querySelectorAll("[data-alert-evidence]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.getAttribute("data-alert-evidence");
      const item = items.find((i) => i.key === key);
      if (item) handlers.onEvidence(item);
    });
  });
}

/* ─── Live orders ─── */

export function renderOrdersTile(mount, state, prefs, handlers) {
  if (!mount) return;
  const p = pref(prefs, "orders");
  const rows = state.orders.rows || [];
  const recent = recentOrdersWindow(rows, 5);
  const recentRev = recent.reduce((s, o) => s + (o.ticketCents || 0), 0);
  const unusual = rows.filter((o) => o.isMaterial).length;
  const latest = rows[0];
  const status = unusual > 0 ? "attention" : recent.length > 8 ? "watch" : "normal";

  const summary = latest
    ? `Latest: ${latest.storeName} · ${money(latest.ticketCents)} · ${channelLabel(latest.channel)} · ${latest.pizzaCount} × ${itemDisplay(latest)}`
    : "Waiting for POS stream…";

  const filters = [
    { id: "all", label: "All" },
    { id: "material", label: "Material" },
    { id: "phone", label: "Phone" },
    { id: "pos", label: "Counter" },
  ];

  const storeOptions = (state.stores || [])
    .map(
      (s) =>
        `<option value="${s.id}" ${state.orderStoreFilter === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`
    )
    .join("");

  const storeNameById = Object.fromEntries(
    (state.stores || []).map((s) => [s.id, s.name])
  );
  const feedEvents = (state.feed?.events || []).slice(0, 12);
  const activityHtml = feedEvents.length
    ? `<div class="activity-strip" aria-label="Recent store events">
        <p class="activity-strip-label">Recent events</p>
        <ul class="activity-list">
          ${feedEvents
            .map((ev) => {
              const name =
                storeNameById[ev.store_id] ||
                ev.store_id ||
                "Store";
              const title = ev.title || ev.event_type || "Event";
              const sev = ev.severity || "info";
              return `<li class="activity-item severity-${escapeHtml(sev)}">
                <span class="activity-time tabular">${timeShort(ev.occurred_at)}</span>
                <span class="activity-store">${escapeHtml(name)}</span>
                <span class="activity-title">${escapeHtml(title)}</span>
              </li>`;
            })
            .join("")}
        </ul>
      </div>`
    : "";

  const displayRows = rows.slice(0, 80);
  const paused = state.ordersPaused;

  const bodyHtml = `
    <div class="filter-bar">
      <div class="order-filters" role="tablist" aria-label="Order filters">
        ${filters
          .map(
            (f) => `
          <button type="button" class="chip-filter ${state.orderFilter === f.id ? "is-active" : ""}" data-order-filter="${f.id}" role="tab" aria-selected="${state.orderFilter === f.id}">${f.label}</button>`
          )
          .join("")}
      </div>
      <label class="filter-field">
        <span class="sr-only">Location</span>
        <select data-order-store>
          <option value="">All businesses</option>
          ${storeOptions}
        </select>
      </label>
      <label class="filter-field grow">
        <span class="sr-only">Search orders</span>
        <input type="search" data-order-search placeholder="Search store, case, channel…" value="${escapeHtml(state.orderSearch || "")}" />
      </label>
      <button type="button" class="btn btn-ghost btn-sm" data-orders-pause aria-pressed="${paused}">
        ${paused ? "Resume live" : "Pause live"}
      </button>
      <button type="button" class="btn btn-ghost btn-sm ${state.followLive ? "is-active" : ""}" data-follow-live aria-pressed="${state.followLive}">
        Follow live
      </button>
    </div>
    <div class="order-summary-inline">
      <span>Today: <strong class="tabular">${formatKpi(state.orders.summary.orderCount, "number")}</strong> orders</span>
      <span><strong class="tabular">${money(state.orders.summary.revenueCents)}</strong> ticket revenue</span>
      <span class="${unusual ? "is-alert" : ""}"><strong class="tabular">${unusual}</strong> material</span>
      <span><strong class="tabular">${formatKpi(
        (state.orders.summary.chain?.anchored || 0) +
          (state.orders.summary.chain?.signed || 0),
        "number"
      )}</strong> sealed · ${formatKpi(state.orders.summary.chain?.anchored || 0, "number")} on-chain · ${formatKpi(state.orders.summary.chain?.pending || 0, "number")} pending</span>
    </div>
    ${activityHtml}
    <div class="order-feed" role="listbox" aria-label="Live orders">
      ${
        displayRows.length
          ? displayRows
              .map((o) => {
                const tag = orderExceptionTag(o);
                const q = (state.orderSearch || "").toLowerCase();
                if (
                  q &&
                  !(
                    (o.storeName || "").toLowerCase().includes(q) ||
                    (o.caseId || "").toLowerCase().includes(q) ||
                    (o.channel || "").toLowerCase().includes(q) ||
                    String(o.id).includes(q)
                  )
                ) {
                  return "";
                }
                return `
                <button type="button" class="order-row ${o.isMaterial ? "is-material" : ""} ${state.selectedOrderId === o.id ? "is-selected" : ""}" data-order-id="${o.id}" role="option" aria-selected="${state.selectedOrderId === o.id}">
                  <span class="order-time tabular">${timeShort(o.occurredAt)}</span>
                  <span class="order-loc">${escapeHtml(o.storeName)}</span>
                  <span class="order-id mono">${escapeHtml((o.caseId || o.id || "").toString().slice(0, 14))}</span>
                  <span class="order-channel">${channelLabel(o.channel)}</span>
                  <span class="order-items">${o.pizzaCount} × ${escapeHtml(itemDisplay(o))}</span>
                  <span class="order-amount tabular">${money(o.ticketCents)}</span>
                  <span class="order-tag ${o.isMaterial ? "alert" : ""}">${tag}</span>
                  ${
                    o.chain
                      ? `<span class="order-tag chain ${
                          o.chain.status === "anchored"
                            ? "on-chain"
                            : o.chain.status
                        }">${chainStatusLabel(o.chain)}</span>`
                      : ""
                  }
                </button>`;
              })
              .join("")
          : `<p class="detail-placeholder">No orders match this filter.</p>`
      }
    </div>
  `;

  mount.innerHTML = tileShell({
    id: "orders",
    title: "Live Orders & Events",
    status,
    live: !paused && state.live,
    headline: `${recent.length} in last 5 min`,
    secondaryMetric: `${money(recentRev)} · ${unusual} unusual`,
    summary,
    alertCount: unusual,
    expanded: p.expanded,
    pinned: p.pinned,
    bodyHtml,
  });

  mount.querySelectorAll("[data-order-filter]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onFilter(btn.getAttribute("data-order-filter"));
    });
  });
  mount.querySelector("[data-order-store]")?.addEventListener("change", (e) => {
    handlers.onStoreFilter(e.target.value || null);
  });
  mount.querySelector("[data-order-search]")?.addEventListener("input", (e) => {
    handlers.onSearch(e.target.value);
  });
  mount.querySelector("[data-orders-pause]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.onPauseToggle();
  });
  mount.querySelector("[data-follow-live]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.onFollowToggle();
  });
  mount.querySelectorAll("[data-order-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onSelectOrder(btn.getAttribute("data-order-id"));
    });
  });
}

/* ─── Businesses ─── */

function sortAnalyses(list, sortKey) {
  const rank = { alert: 0, watch: 1, ok: 2 };
  const sorted = [...list].sort((a, b) => {
    const sr = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    if (sr !== 0) return sr;
    if (sortKey === "revenue") return (b.store.kpis.revenue || 0) - (a.store.kpis.revenue || 0);
    if (sortKey === "capacity")
      return (b.store.kpis.capacityUtil || 0) - (a.store.kpis.capacityUtil || 0);
    if (sortKey === "exceptions") return (b.flags?.length || 0) - (a.flags?.length || 0);
    if (sortKey === "risk") return (b.worstAbs || 0) - (a.worstAbs || 0);
    return (a.store.name || "").localeCompare(b.store.name || "");
  });
  return sorted;
}

export function renderLocationsTile(mount, state, prefs, handlers) {
  const p = pref(prefs, "locations");
  const analyses = state.analysis?.storeAnalyses || [];
  const alertN = analyses.filter((a) => a.status === "alert").length;
  const watchN = analyses.filter((a) => a.status === "watch").length;
  const okN = analyses.filter((a) => a.status === "ok").length;
  const status = alertN > 0 ? "attention" : watchN > 0 ? "watch" : "normal";

  let filtered = analyses;
  if (state.locationStatusFilter && state.locationStatusFilter !== "all") {
    filtered = filtered.filter((a) => a.status === state.locationStatusFilter);
  }
  if (state.locationCityFilter) {
    const city = state.locationCityFilter.toLowerCase();
    filtered = filtered.filter((a) =>
      (a.store.city || a.store.neighborhood || "").toLowerCase().includes(city)
    );
  }
  if (state.locationSearch) {
    const q = state.locationSearch.toLowerCase();
    filtered = filtered.filter(
      (a) =>
        a.store.name.toLowerCase().includes(q) ||
        (a.store.city || "").toLowerCase().includes(q)
    );
  }
  if (state.commandQuery) {
    const q = state.commandQuery.toLowerCase();
    if (q.includes("discount")) {
      filtered = filtered.filter((a) =>
        a.flags.some((f) => f.kpi === "discountRate")
      );
    } else if (q.includes("ann arbor")) {
      filtered = filtered.filter((a) =>
        a.store.name.toLowerCase().includes("ann arbor")
      );
    } else {
      filtered = filtered.filter(
        (a) =>
          a.store.name.toLowerCase().includes(q) ||
          locationDiagnostic(a).toLowerCase().includes(q)
      );
    }
  }

  filtered = sortAnalyses(filtered, state.locationSort || "risk");
  const view = state.locationView || "cards";

  const cities = [
    ...new Set(
      analyses.map((a) => a.store.city || a.store.neighborhood).filter(Boolean)
    ),
  ];

  const cardsHtml = filtered
    .map((analysis) => {
      const { store, flags, status: st } = analysis;
      const selected = state.selectedId === store.id ? "is-selected" : "";
      const pulse =
        store.id === "plant-the-future" && st === "alert" && store.activeCase
          ? "is-pulsing"
          : "";
      return `
        <button type="button" class="loc-card status-${st} ${selected} ${pulse}" data-store-id="${store.id}">
          <div class="loc-card-top">
            <div>
              <h3>${escapeHtml(store.name)}</h3>
              <p>${escapeHtml(store.city || store.neighborhood || "")}</p>
            </div>
            <span class="status-badge status-${toTileStatus(st)}">${statusLabel(st)}</span>
          </div>
          <div class="loc-metrics">
            <span><em>Revenue</em><strong class="tabular">${formatKpi(store.kpis.revenue, "currency")}</strong></span>
            <span><em>Orders</em><strong class="tabular">${formatKpi(store.kpis.orders, "number")}</strong></span>
            <span><em>Capacity</em><strong class="tabular">${formatKpi(store.kpis.capacityUtil, "percent")}</strong></span>
            <span><em>Alerts</em><strong class="tabular">${flags.length}</strong></span>
          </div>
          <p class="loc-diag">${escapeHtml(locationDiagnostic(analysis))}</p>
        </button>`;
    })
    .join("");

  const tableHtml = `
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
          ${filtered
            .map((a) => {
              const s = a.store;
              return `<tr data-store-id="${s.id}" class="${state.selectedId === s.id ? "is-selected" : ""}" tabindex="0" role="button">
                <td>${escapeHtml(s.name)}</td>
                <td><span class="status-badge status-${toTileStatus(a.status)}">${statusLabel(a.status)}</span></td>
                <td class="tabular">${formatKpi(s.kpis.revenue, "currency")}</td>
                <td class="tabular">${formatKpi(s.kpis.orders, "number")}</td>
                <td class="tabular">${formatKpi(s.kpis.capacityUtil, "percent")}</td>
                <td class="tabular">${a.flags.length}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;

  const bodyHtml = `
    <div class="filter-bar">
      <div class="view-toggle" role="group" aria-label="Location view">
        <button type="button" class="chip-filter ${view === "cards" ? "is-active" : ""}" data-loc-view="cards">Cards</button>
        <button type="button" class="chip-filter ${view === "table" ? "is-active" : ""}" data-loc-view="table">Table</button>
      </div>
      <select data-loc-status aria-label="Status filter">
        <option value="all" ${!state.locationStatusFilter || state.locationStatusFilter === "all" ? "selected" : ""}>All statuses</option>
        <option value="alert" ${state.locationStatusFilter === "alert" ? "selected" : ""}>Needs attention</option>
        <option value="watch" ${state.locationStatusFilter === "watch" ? "selected" : ""}>Watch</option>
        <option value="ok" ${state.locationStatusFilter === "ok" ? "selected" : ""}>Normal</option>
      </select>
      <select data-loc-city aria-label="City filter">
        <option value="">All cities</option>
        ${cities
          .map(
            (c) =>
              `<option value="${escapeHtml(c)}" ${state.locationCityFilter === c ? "selected" : ""}>${escapeHtml(c)}</option>`
          )
          .join("")}
      </select>
      <select data-loc-sort aria-label="Sort">
        <option value="risk" ${state.locationSort === "risk" ? "selected" : ""}>Sort: risk</option>
        <option value="revenue" ${state.locationSort === "revenue" ? "selected" : ""}>Sort: revenue</option>
        <option value="capacity" ${state.locationSort === "capacity" ? "selected" : ""}>Sort: capacity</option>
        <option value="exceptions" ${state.locationSort === "exceptions" ? "selected" : ""}>Sort: exceptions</option>
      </select>
      <label class="filter-field grow">
        <span class="sr-only">Search businesses</span>
        <input type="search" data-loc-search placeholder="Search businesses…" value="${escapeHtml(state.locationSearch || "")}" />
      </label>
    </div>
    ${view === "table" ? tableHtml : `<div class="loc-grid">${cardsHtml || `<p class="detail-placeholder">No businesses match.</p>`}</div>`}
  `;

  mount.innerHTML = tileShell({
    id: "locations",
    title: "Businesses",
    status,
    headline: `${okN} normal · ${alertN} attention · ${watchN} watch`,
    secondaryMetric: `${analyses.length} stores`,
    summary: alertN
      ? `${alertN} business${alertN === 1 ? "" : "s"} need owner review`
      : "Portfolio businesses within policy",
    alertCount: alertN,
    expanded: p.expanded,
    pinned: p.pinned,
    bodyHtml,
  });

  const pick = (id) => handlers.onSelectStore(id);

  mount.querySelectorAll("[data-store-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      pick(el.getAttribute("data-store-id"));
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pick(el.getAttribute("data-store-id"));
      }
    });
  });
  mount.querySelectorAll("[data-loc-view]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onView(btn.getAttribute("data-loc-view"));
    });
  });
  mount.querySelector("[data-loc-status]")?.addEventListener("change", (e) => {
    handlers.onStatusFilter(e.target.value);
  });
  mount.querySelector("[data-loc-city]")?.addEventListener("change", (e) => {
    handlers.onCityFilter(e.target.value || null);
  });
  mount.querySelector("[data-loc-sort]")?.addEventListener("change", (e) => {
    handlers.onSort(e.target.value);
  });
  mount.querySelector("[data-loc-search]")?.addEventListener("input", (e) => {
    handlers.onSearch(e.target.value);
  });
}

/* ─── Ops tiles ─── */

function outlierStores(analyses, kpiKey, higherIsBetter) {
  return analyses
    .filter((a) => a.flags.some((f) => f.kpi === kpiKey))
    .sort((a, b) => {
      const fa = a.flags.find((f) => f.kpi === kpiKey);
      const fb = b.flags.find((f) => f.kpi === kpiKey);
      return Math.abs(fb?.z || 0) - Math.abs(fa?.z || 0);
    });
}

function opsListHtml(rows, formatValue) {
  if (!rows.length) {
    return `<p class="detail-placeholder">No exceptions in this category.</p>`;
  }
  return `<ul class="ops-exception-list">${rows
    .map(
      (r) => `
    <li>
      <button type="button" class="linkish" data-store-id="${r.id}">${escapeHtml(r.name)}</button>
      <span class="tabular">${formatValue(r)}</span>
      <span class="ops-note">${escapeHtml(r.note || "")}</span>
    </li>`
    )
    .join("")}</ul>`;
}

export function renderInventoryTile(mount, state, prefs, handlers) {
  if (!mount) return;
  const p = pref(prefs, "inventory");
  const analyses = state.analysis?.storeAnalyses || [];
  const outliers = outlierStores(analyses, "inventoryDays", true);
  const worst = [...analyses].sort(
    (a, b) => (a.store.kpis.inventoryDays || 0) - (b.store.kpis.inventoryDays || 0)
  )[0];
  const lowMoss = state.stores.filter(
    (s) => (s.inventory?.preserved_moss || 0) < 80
  );
  const alertCount = outliers.length + (lowMoss.length ? 1 : 0);
  const status = outliers.some((o) => o.status === "alert")
    ? "attention"
    : alertCount
      ? "watch"
      : "normal";

  const rows = analyses
    .map((a) => ({
      id: a.store.id,
      name: a.store.name,
      days: a.store.kpis.inventoryDays,
      moss: a.store.inventory?.preserved_moss,
      note: locationDiagnostic(a),
    }))
    .sort((a, b) => a.days - b.days)
    .slice(0, 8);

  const bodyHtml = `
    <p class="tile-lead">Moss cover and material balances across the studio.</p>
    ${opsListHtml(rows, (r) => `${formatKpi(r.days, "days")} · moss ${(r.moss ?? 0).toFixed(0)} sqft`)}
  `;

  mount.innerHTML = tileShell({
    id: "inventory",
    title: "Inventory",
    status,
    headline: worst
      ? `Lowest cover ${formatKpi(worst.store.kpis.inventoryDays, "days")} · ${worst.store.name}`
      : "—",
    secondaryMetric: `${lowMoss.length} low moss`,
    summary:
      outliers.length > 0
        ? `${outliers.length} location${outliers.length === 1 ? "" : "s"} below expected cover`
        : "Cover within peer bands",
    alertCount: outliers.length,
    expanded: p.expanded,
    pinned: p.pinned,
    bodyHtml,
  });
  mount.querySelectorAll("[data-store-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onSelectStore(btn.getAttribute("data-store-id"));
    });
  });
}

export function renderLaborTile(mount, state, prefs, handlers) {
  if (!mount) return;
  const p = pref(prefs, "labor");
  const analyses = state.analysis?.storeAnalyses || [];
  const outliers = outlierStores(analyses, "staffingFill", true);
  const onClock = state.stores.reduce(
    (s, x) => s + (x.kpis.employeesOnClock || 0),
    0
  );
  const status = outliers.some((o) => o.status === "alert")
    ? "attention"
    : outliers.length
      ? "watch"
      : "normal";

  const rows = analyses
    .map((a) => ({
      id: a.store.id,
      name: a.store.name,
      fill: a.store.kpis.staffingFill,
      clock: a.store.kpis.employeesOnClock,
      note: `${(a.store.onClock || []).length} named on clock`,
    }))
    .sort((a, b) => a.fill - b.fill);

  mount.innerHTML = tileShell({
    id: "labor",
    title: "Labor",
    status,
    headline: `${onClock} on the clock`,
    secondaryMetric: `${outliers.length} staffing flags`,
    summary:
      outliers.length > 0
        ? "Some businesses below staffing fill targets"
        : "Staffing within expected fill",
    alertCount: outliers.length,
    expanded: p.expanded,
    pinned: p.pinned,
    bodyHtml: opsListHtml(
      rows.slice(0, 8),
      (r) => `${formatKpi(r.fill, "percent")} fill · ${r.clock} clocked`
    ),
  });
  mount.querySelectorAll("[data-store-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onSelectStore(btn.getAttribute("data-store-id"));
    });
  });
}

export function renderPhoneTile(mount, state, prefs, handlers) {
  if (!mount) return;
  const p = pref(prefs, "phone");
  const calls = state.stores.reduce(
    (s, x) => s + (x.kpis.phoneCallsToday || 0),
    0
  );
  const feedCalls = (state.feed?.calls || []).slice(0, 12);
  const phoneOrders = (state.orders.rows || []).filter(
    (o) => o.channel === "phone"
  ).length;

  const bodyHtml = `
    <p class="tile-lead">${phoneOrders} phone-channel orders in the current feed · ${feedCalls.length} recent call events.</p>
    <ul class="ops-exception-list">
      ${state.stores
        .map((s) => ({
          id: s.id,
          name: s.name,
          calls: s.kpis.phoneCallsToday || 0,
        }))
        .sort((a, b) => b.calls - a.calls)
        .slice(0, 8)
        .map(
          (r) => `
        <li>
          <button type="button" class="linkish" data-store-id="${r.id}">${escapeHtml(r.name)}</button>
          <span class="tabular">${r.calls} calls</span>
        </li>`
        )
        .join("")}
    </ul>
  `;

  mount.innerHTML = tileShell({
    id: "phone",
    title: "Phone Activity",
    status: "normal",
    headline: `${calls} calls today`,
    secondaryMetric: `${phoneOrders} phone orders`,
    summary: "Inbound volume across the network",
    alertCount: 0,
    expanded: p.expanded,
    pinned: p.pinned,
    bodyHtml,
  });
  mount.querySelectorAll("[data-store-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onSelectStore(btn.getAttribute("data-store-id"));
    });
  });
}

export function renderDiscountsTile(mount, state, prefs, handlers) {
  if (!mount) return;
  const p = pref(prefs, "discounts");
  const analyses = state.analysis?.storeAnalyses || [];
  const disc = outlierStores(analyses, "discountRate", false);
  const refunds = outlierStores(analyses, "refundRate", false);
  const alertCount = disc.length + refunds.length;
  const status = [...disc, ...refunds].some((o) => o.status === "alert")
    ? "attention"
    : alertCount
      ? "watch"
      : "normal";
  const avgDisc =
    analyses.reduce((s, a) => s + (a.store.kpis.discountRate || 0), 0) /
    (analyses.length || 1);

  const rows = analyses
    .map((a) => ({
      id: a.store.id,
      name: a.store.name,
      d: a.store.kpis.discountRate,
      r: a.store.kpis.refundRate,
      note: a.flags
        .filter((f) => f.kpi === "discountRate" || f.kpi === "refundRate")
        .map((f) => f.label)
        .join(", "),
    }))
    .sort((a, b) => b.d - a.d);

  mount.innerHTML = tileShell({
    id: "discounts",
    title: "Discounts and Refunds",
    status,
    headline: `Avg discount ${formatKpi(avgDisc, "percent")}`,
    secondaryMetric: `${alertCount} exceptions`,
    summary:
      alertCount > 0
        ? "Elevated discount or refund activity at one or more stores"
        : "Discount and refund rates within bands",
    alertCount,
    expanded: p.expanded,
    pinned: p.pinned,
    bodyHtml: opsListHtml(
      rows.slice(0, 8),
      (r) =>
        `Disc ${formatKpi(r.d, "percent")} · Refund ${formatKpi(r.r, "percent")}`
    ),
  });
  mount.querySelectorAll("[data-store-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onSelectStore(btn.getAttribute("data-store-id"));
    });
  });
}

export function renderDeliveryTile(mount, state, prefs, handlers) {
  if (!mount) return;
  const p = pref(prefs, "delivery");
  const analyses = state.analysis?.storeAnalyses || [];
  const outliers = outlierStores(analyses, "deliveryEta", false);
  const avg =
    analyses.reduce((s, a) => s + (a.store.kpis.deliveryEta || 0), 0) /
    (analyses.length || 1);
  const status = outliers.some((o) => o.status === "alert")
    ? "attention"
    : outliers.length
      ? "watch"
      : "normal";

  const rows = analyses
    .map((a) => ({
      id: a.store.id,
      name: a.store.name,
      eta: a.store.kpis.deliveryEta,
      note: "",
    }))
    .sort((a, b) => b.eta - a.eta);

  mount.innerHTML = tileShell({
    id: "delivery",
    title: "Install / lead time",
    status,
    headline: `Avg lead ${formatKpi(avg, "minutes")}`,
    secondaryMetric: `${outliers.length} elevated`,
    summary:
      outliers.length > 0
        ? "Lead times elevated vs peers or history"
        : "Lead times within expected range",
    alertCount: outliers.length,
    expanded: p.expanded,
    pinned: p.pinned,
    bodyHtml: opsListHtml(rows.slice(0, 8), (r) =>
      formatKpi(r.eta, "minutes")
    ),
  });
  mount.querySelectorAll("[data-store-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onSelectStore(btn.getAttribute("data-store-id"));
    });
  });
}

export function renderUtilitiesTile(mount, state, prefs, handlers) {
  if (!mount) return;
  const p = pref(prefs, "utilities");
  const water = state.stores.reduce(
    (s, x) => s + (x.kpis.waterGallonsToday || 0),
    0
  );
  const moss = state.stores.reduce(
    (s, x) => s + (x.kpis.doughLbsToday || 0),
    0
  );

  const rows = state.stores
    .map((s) => ({
      id: s.id,
      name: s.name,
      water: s.kpis.waterGallonsToday || 0,
      moss: s.kpis.doughLbsToday || 0,
    }))
    .sort((a, b) => b.water - a.water);

  mount.innerHTML = tileShell({
    id: "utilities",
    title: "Studio utilities",
    status: "normal",
    headline: `${moss.toFixed(0)} sqft material processed`,
    secondaryMetric: `${water.toFixed(0)} gal water`,
    summary: "Utility and production counters across the portfolio today",
    alertCount: 0,
    expanded: p.expanded,
    pinned: p.pinned,
    bodyHtml: opsListHtml(
      rows.slice(0, 8),
      (r) => `${r.moss.toFixed(0)} sqft · ${r.water.toFixed(0)} gal`
    ),
  });
  mount.querySelectorAll("[data-store-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onSelectStore(btn.getAttribute("data-store-id"));
    });
  });
}

/* ─── Demo tile ─── */

export function renderDemoTile(mount, state, prefs, demo, handlers) {
  const p = pref(prefs, "demo");
  const stage = demo.stage;
  const mode = demo.mode;
  const lines = demo.transcript();
  const ownerLines = demo.ownerTranscript();
  const live = demo.liveCase;
  const miami = state.stores.find((s) => s.id === "plant-the-future");
  const miamiAnalysis = state.analysis?.storeAnalyses.find(
    (a) => a.store.id === "plant-the-future"
  );
  const isUrgent =
    mode === "urgent" &&
    (stage === "alert" ||
      stage === "owner_call" ||
      stage === "enrich" ||
      stage === "found" ||
      (miami?.activeCase && miamiAnalysis?.status === "alert"));
  const isDigest = mode === "digest";

  const stageNote = {
    idle: "OwnerRadar talks to Yair — urgent silent failures, or a non-urgent digest from calls, texts, email, and reviews.",
    alert: "Silent failure — ASAP commission with no install drivers. Floor didn't escalate. Texting Yair…",
    owner_call: "OwnerRadar briefed Yair — waiting for APPROVE / REVIEW / CALL.",
    enrich: "Looking up who's driving the hospitality commission…",
    found:
      mode === "digest"
        ? "Digest ready — pick a thread to go deeper."
        : "Found them — LinkedIn + public info texted to Yair.",
    digest: "Non-urgent check-in — interesting signals worth a partner conversation, not a fire drill.",
  }[stage] || "OwnerRadar is listening across the portfolio.";

  const stageLabel = {
    idle: "Ready",
    alert: "Urgent · silent failure",
    owner_call: "Brief → Yair",
    enrich: "Enriching…",
    found: mode === "digest" ? "Digest ready" : "Loop closed",
    digest: "Digest · non-urgent",
  }[stage] || "Ready";

  const bodyHtml = `
    <p class="tile-lead">${escapeHtml(stageNote)}</p>
    <div class="demo-actions-row">
      <button type="button" class="btn btn-primary" data-demo-urgent>Play urgent</button>
      <button type="button" class="btn btn-ghost" data-demo-digest>Play digest</button>
    </div>
    <div class="demo-grid">
      <section class="demo-card ${isUrgent ? "is-hot" : ""}">
        <h3>Urgent · what the floor won't say</h3>
        ${
          mode !== "urgent"
            ? `<ol class="transcript">
                <li class="muted">Big ASAP order lands. No drivers / install vans. Staff don't call — don't want to disturb Yair or break bad news.</li>
                <li class="muted">OwnerRadar notices the silent failure and briefs him.</li>
              </ol>`
            : `<ol class="transcript">
                ${lines
                  .map(
                    (l) =>
                      `<li><span class="who">${escapeHtml(l.who)}</span><span class="said">${escapeHtml(l.text)}</span></li>`
                  )
                  .join("")}
                ${
                  live || miami?.activeCase
                    ? `<li><span class="who">Case</span><span class="said">${(live || miami.activeCase).qty || DEMO_ORDER.qty} panels · ${(live || miami.activeCase).caseId || DEMO_ORDER.caseId}</span></li>`
                    : ""
                }
              </ol>`
        }
      </section>
      <section class="demo-card ${isDigest || stage === "owner_call" || stage === "enrich" || (stage === "found" && mode === "urgent") ? "is-hot" : ""}">
        <h3>${isDigest ? "Digest · high-level check-in" : "OwnerRadar → Yair"}</h3>
        <ol class="transcript">
          ${
            ownerLines.length
              ? ownerLines
                  .map(
                    (l) =>
                      `<li><span class="who">${escapeHtml(l.who)}</span><span class="said">${escapeHtml(l.text)}</span></li>`
                  )
                  .join("")
              : `<li class="muted">Idle until you play urgent (silent failure) or digest (non-urgent intel).</li>`
          }
        </ol>
        ${
          stage === "owner_call"
            ? `<button type="button" class="btn btn-primary" data-demo-yes>Simulate Yair: APPROVE</button>
               <p class="metric-note">Live path: reply APPROVE / REVIEW / CALL to the Twilio SMS.</p>`
            : ""
        }
        ${stage === "enrich" ? `<p class="searching">Searching public RFP + people graph…</p>` : ""}
        ${
          stage === "found" && mode === "urgent"
            ? `<div class="found-card">
                <p class="found-kicker">Found her</p>
                <h4>${escapeHtml(EVENT_ORGANIZER.name)}</h4>
                <p>${escapeHtml(EVENT_ORGANIZER.role)}</p>
                <p><a href="${EVENT_ORGANIZER.linkedin}" target="_blank" rel="noopener">LinkedIn profile</a></p>
                <ul>${EVENT_ORGANIZER.publicNotes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
                <p class="sms-preview">${escapeHtml(EVENT_ORGANIZER.smsPreview)}</p>
              </div>`
            : ""
        }
        ${
          isDigest
            ? `<p class="metric-note">${DIGEST_ITEMS.length} threads from transcripts, reviews, email, SMS, and DMs — none on fire, all worth a partner conversation.</p>`
            : ""
        }
      </section>
    </div>
    <details class="agent-prompt">
      <summary>OwnerRadar agent prompt (owner-only)</summary>
      <div class="agent-prompt-grid">
        <div>
          <h4>OwnerRadar → Yair</h4>
          <p class="agent-meta">Urgent silent failures · non-urgent digests · GetStoreBrief · TextOwner</p>
          <pre>${OWNER_RADAR_AGENT_PROMPT.replace(/</g, "&lt;")}</pre>
        </div>
      </div>
    </details>
  `;

  mount.innerHTML = tileShell({
    id: "demo",
    title: "OwnerRadar demo",
    status: isUrgent ? "attention" : isDigest ? "watch" : "normal",
    live: stage === "idle",
    headline: stageLabel,
    secondaryMetric: "Owner brief · no cashier agent",
    summary: stageNote,
    alertCount: isUrgent ? 1 : 0,
    expanded: p.expanded || isUrgent || isDigest,
    pinned: p.pinned,
    actionsHtml: `<button type="button" class="btn btn-ghost btn-sm" data-demo-reset>Reset</button>`,
    bodyHtml,
  });

  mount.querySelector("[data-demo-reset]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.onReset();
  });
  mount.querySelector("[data-demo-yes]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.onYes();
  });
  mount.querySelector("[data-demo-urgent]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.onUrgent?.();
  });
  mount.querySelector("[data-demo-digest]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.onDigest?.();
  });
}

/* ─── Drawer bodies ─── */

export function orderDrawerHtml(order, state) {
  if (!order) return `<p class="detail-placeholder">Order not found.</p>`;
  const analysis = state.analysis?.storeAnalyses.find(
    (a) => a.store.id === order.storeId
  );
  const flags = analysis?.flags || [];
  return `
    <div class="drawer-section">
      <div class="detail-head">
        <div>
          <p class="eyebrow">${escapeHtml(order.storeName)} · ${channelLabel(order.channel)}</p>
          <p class="metric-note">${escapeHtml(order.address || order.city || "")}</p>
        </div>
        <span class="status-badge status-${order.isMaterial ? "attention" : "normal"}">${orderExceptionTag(order)}</span>
      </div>
      <div class="drawer-kpi-row">
        <div class="detail-kpi ${order.isMaterial ? "severity-alert" : ""}">
          <span class="metric-label">Units</span>
          <strong class="tabular">${formatKpi(order.pizzaCount, "number")}</strong>
        </div>
        <div class="detail-kpi">
          <span class="metric-label">Ticket</span>
          <strong class="tabular">${money(order.ticketCents)}</strong>
        </div>
        <div class="detail-kpi">
          <span class="metric-label">Status</span>
          <strong>${escapeHtml(order.status || "accepted")}</strong>
        </div>
      </div>
      <dl class="order-facts">
        <div><dt>When needed</dt><dd>${escapeHtml(order.whenNeeded || "—")}</dd></div>
        <div><dt>Install / delivery</dt><dd>${escapeHtml(order.deliveryWhere || "—")}</dd></div>
        <div><dt>Accepted</dt><dd>${timeLabel(order.occurredAt)}</dd></div>
        ${
          order.caseId
            ? `<div><dt>Case ID</dt><dd class="mono">${escapeHtml(order.caseId)}</dd></div>`
            : ""
        }
        ${
          order.note
            ? `<div class="full"><dt>Note</dt><dd>${escapeHtml(order.note)}</dd></div>`
            : ""
        }
      </dl>
      <h3>Line items</h3>
      <ul class="ops-list">
        ${(order.items || [])
          .map(
            (line) =>
              `<li><span>${escapeHtml(
                (line.item || "Item") === "mixed_pies"
                  ? "mixed pieces"
                  : line.item || "Item"
              )}${line.qty ? ` × ${line.qty}` : ""}</span><strong class="tabular">${
                line.qty && order.pizzaCount
                  ? money(
                      Math.round(
                        (order.ticketCents / order.pizzaCount) * (line.qty || 0)
                      )
                    )
                  : money(order.ticketCents)
              }</strong></li>`
          )
          .join("") || "<li><span>No line items</span><strong>—</strong></li>"}
      </ul>
      ${
        flags.length
          ? `<h3>Related business signals</h3>
             <ul class="insight-list">${flags
               .slice(0, 4)
               .map(
                 (f) =>
                   `<li>${escapeHtml(f.label)} · ${escapeHtml(f.copy)}</li>`
               )
               .join("")}</ul>`
          : ""
      }
      <div class="drawer-recommend">
        <h3>Recommended action</h3>
        <p>${
          order.isMaterial
            ? escapeHtml(materialRecommendedAction())
            : "No owner action required — routine order."
        }</p>
      </div>

      <div class="chain-panel">
        <h3>Solana receipt</h3>
        ${
          order.chain
            ? `
          <dl class="order-facts">
            <div>
              <dt>Status</dt>
              <dd>${escapeHtml(order.chain.status)}${order.chain.cluster ? ` · ${escapeHtml(order.chain.cluster)}` : ""}</dd>
            </div>
            <div>
              <dt>SHA-256</dt>
              <dd class="mono" title="${escapeHtml(order.chain.hash || "")}">${escapeHtml(shortHash(order.chain.hash))}</dd>
            </div>
            ${
              order.chain.signature
                ? `<div class="full">
              <dt>Tx</dt>
              <dd class="mono"><a href="${escapeHtml(order.chain.explorerUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(order.chain.signature.slice(0, 20))}…</a></dd>
            </div>`
                : ""
            }
            ${
              order.chain.error
                ? `<div class="full"><dt>Error</dt><dd>${escapeHtml(order.chain.error)}</dd></div>`
                : ""
            }
          </dl>
          <div class="drawer-actions chain-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-verify-order>Verify hash</button>
            <button type="button" class="btn btn-ghost btn-sm" data-tamper-order>Tamper test</button>
            ${
              order.chain.explorerUrl
                ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(order.chain.explorerUrl)}" target="_blank" rel="noopener noreferrer">Explorer</a>`
                : ""
            }
          </div>
          ${
            state.verifyResult && state.verifyResult.orderId === order.id
              ? `<p class="chain-verdict ${state.verifyResult.matches ? "is-ok" : "is-bad"}">${
                  state.verifyResult.verdict === "tamper_detected"
                    ? "Tamper detected — recomputed hash ≠ anchored hash"
                    : state.verifyResult.matches
                      ? "Valid — live order matches anchored hash"
                      : escapeHtml(state.verifyResult.error || "Hash mismatch")
                }</p>`
              : ""
          }
        `
            : `<p class="detail-placeholder">No chain receipt yet — queued on the next sim tick once the wallet is funded.</p>`
        }
      </div>

      <button type="button" class="btn btn-ghost" data-drawer-jump-store="${order.storeId}">Open ${escapeHtml(order.storeName)}</button>
      <details class="tech-details">
        <summary>Analysis details</summary>
        <p class="mono">orderId ${escapeHtml(order.id)} · material=${order.isMaterial} · channel=${escapeHtml(order.channel)}${order.chain?.hash ? ` · hash=${escapeHtml(shortHash(order.chain.hash))}` : ""}</p>
      </details>
    </div>
  `;
}

export function locationDrawerHtml(storeId, state) {
  const analysis = state.analysis?.storeAnalyses.find(
    (a) => a.store.id === storeId
  );
  if (!analysis) return `<p class="detail-placeholder">Location not found.</p>`;
  const { store, flags, status } = analysis;
  const peer = state.analysis.peerStats;
  const inv = store.inventory || {};
  const storeOrders = (state.orders.rows || [])
    .filter((o) => o.storeId === storeId)
    .slice(0, 8);

  const narrative = locationDiagnostic(analysis);

  return `
    <div class="drawer-section">
      <div class="detail-head">
        <div>
          <p class="eyebrow">${escapeHtml(store.manager || "")}${store.phone ? ` · ${escapeHtml(store.phone)}` : ""}</p>
          <p class="metric-note">${escapeHtml(store.address || store.neighborhood || "")}</p>
        </div>
        <span class="status-badge status-${toTileStatus(status)}">${statusLabel(status)}</span>
      </div>
      <p class="location-narrative">${escapeHtml(
        status === "alert" && store.activeCase
          ? `${store.name} has a live mural commission case. ${narrative}`
          : `${store.name} is producing ${formatKpi(store.kpis.revenue, "currency")} today. ${narrative}`
      )}</p>

      <div class="drawer-kpi-row">
        <div class="detail-kpi"><span class="metric-label">Revenue</span><strong class="tabular">${formatKpi(store.kpis.revenue, "currency")}</strong></div>
        <div class="detail-kpi"><span class="metric-label">Orders</span><strong class="tabular">${formatKpi(store.kpis.orders, "number")}</strong></div>
        <div class="detail-kpi"><span class="metric-label">Avg ticket</span><strong class="tabular">${formatKpi(store.kpis.avgTicket, "currency")}</strong></div>
        <div class="detail-kpi"><span class="metric-label">On clock</span><strong class="tabular">${store.kpis.employeesOnClock || 0}</strong></div>
        <div class="detail-kpi"><span class="metric-label">Capacity</span><strong class="tabular">${formatKpi(store.kpis.capacityUtil, "percent")}</strong></div>
      </div>

      ${
        flags[0]
          ? `<div class="drawer-alert-callout">
              <strong>${escapeHtml(plainAlertTitle(flags[0]))}</strong>
              <p>${escapeHtml(flags[0].copy)}</p>
            </div>`
          : ""
      }

      <details class="drawer-cat" open>
        <summary>Overview KPIs</summary>
        <div class="detail-kpi-grid">
          ${KPI_DEFS.map((def) => {
            const value = store.kpis[def.key];
            const p = peer[def.key];
            const flag = flags
              .filter((f) => f.kpi === def.key)
              .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
            return `
              <button type="button" class="detail-kpi ${flag ? `severity-${flag.severity}` : ""}" data-metric-kpi="${def.key}" data-metric-store="${store.id}">
                <span class="metric-label">${def.label}</span>
                <strong class="tabular">${formatKpi(value || 0, def.format)}</strong>
                <span class="metric-note">${
                  p
                    ? vsExpectedCopy(value, p.mean, def.format, def.higherIsBetter)
                    : ""
                }</span>
              </button>`;
          }).join("")}
        </div>
      </details>

      <details class="drawer-cat">
        <summary>Live Orders</summary>
        <ul class="ops-list">
          ${
            storeOrders
              .map(
                (o) =>
                  `<li><button type="button" class="linkish" data-drawer-order="${o.id}">${timeShort(o.occurredAt)} · ${o.pizzaCount} panels · ${money(o.ticketCents)}</button><strong>${orderExceptionTag(o)}</strong></li>`
              )
              .join("") || "<li>No recent orders in feed</li>"
          }
        </ul>
      </details>

      <details class="drawer-cat">
        <summary>Inventory</summary>
        <ul class="ops-list">
          ${
            Object.entries(inv)
              .map(
                ([sku, bal]) =>
                  `<li><span>${escapeHtml(sku)}</span><strong class="tabular">${Number(bal).toFixed(1)}</strong></li>`
              )
              .join("") || "<li>No ledger yet</li>"
          }
        </ul>
      </details>

      <details class="drawer-cat">
        <summary>Staffing</summary>
        <ul class="ops-list">
          ${
            (store.onClock || [])
              .map(
                (p) =>
                  `<li><span>${escapeHtml(p.display_name)}</span><strong>${escapeHtml(p.role)}</strong></li>`
              )
              .join("") || "<li>None clocked in</li>"
          }
        </ul>
      </details>

      <details class="drawer-cat">
        <summary>Calls · Discounts · Lead time · Utilities</summary>
        <div class="detail-kpi-grid">
          <div class="detail-kpi"><span class="metric-label">Calls</span><strong>${store.kpis.phoneCallsToday || 0}</strong></div>
          <div class="detail-kpi"><span class="metric-label">Discount rate</span><strong>${formatKpi(store.kpis.discountRate, "percent")}</strong></div>
          <div class="detail-kpi"><span class="metric-label">Refund rate</span><strong>${formatKpi(store.kpis.refundRate, "percent")}</strong></div>
          <div class="detail-kpi"><span class="metric-label">Install lead time</span><strong>${formatKpi(store.kpis.deliveryEta, "minutes")}</strong></div>
          <div class="detail-kpi"><span class="metric-label">Water today</span><strong>${(store.kpis.waterGallonsToday || 0).toFixed(1)} gal</strong></div>
          <div class="detail-kpi"><span class="metric-label">Material processed</span><strong>${(store.kpis.doughLbsToday || 0).toFixed(1)} sqft</strong></div>
        </div>
      </details>

      <details class="drawer-cat">
        <summary>AI Findings</summary>
        <ul class="insight-list">
          ${
            flags.map((f) => `<li>${escapeHtml(f.copy)}</li>`).join("") ||
            "<li>No adverse signals vs peers or 7-day history.</li>"
          }
        </ul>
      </details>
    </div>
  `;
}

export function metricDrawerHtml(kpiId, state, storeId = null) {
  const def = KPI_DEFS.find((d) => d.key === kpiId);
  const analysis = state.analysis;
  if (!analysis) return `<p class="detail-placeholder">No analysis yet.</p>`;

  if (kpiId === "phone") {
    const calls = state.stores.reduce(
      (s, x) => s + (x.kpis.phoneCallsToday || 0),
      0
    );
    return `
      <div class="drawer-section">
        <p class="eyebrow">Network</p>
        <p class="metric-value tabular">${calls}</p>
        <p>Phone calls recorded across businesses today.</p>
        <p class="metric-note">Data source: store KPI snapshots · Last updated ${timeLabel(state.asOf)}</p>
      </div>`;
  }
  if (kpiId === "attention") {
    return `
      <div class="drawer-section">
        <p class="eyebrow">Network</p>
        <p class="metric-value tabular">${analysis.group.openRisks}</p>
        <p>Businesses that look unusual versus peers or this week's usual.</p>
        <ul class="insight-list">
          ${analysis.storeAnalyses
            .filter((a) => a.status === "alert")
            .map(
              (a) =>
                `<li><button type="button" class="linkish" data-drawer-store="${a.store.id}">${escapeHtml(a.store.name)}</button> — ${escapeHtml(locationDiagnostic(a))}</li>`
            )
            .join("") || "<li>None</li>"}
        </ul>
      </div>`;
  }
  if (kpiId === "exposure") {
    const exposure = estimatedExposure(state.stores, analysis);
    return `
      <div class="drawer-section">
        <p class="eyebrow">Estimated operational exposure</p>
        <p class="metric-value tabular">${formatKpi(exposure, "currency")}</p>
        <p>Sum of live material case values plus a conservative slice of revenue at alerted stores.</p>
      </div>`;
  }

  if (!def) {
    return `<p class="detail-placeholder">Unknown metric.</p>`;
  }

  const storeAnalysis = storeId
    ? analysis.storeAnalyses.find((a) => a.store.id === storeId)
    : null;
  const value = storeAnalysis
    ? storeAnalysis.store.kpis[def.key]
    : def.key === "revenue"
      ? analysis.group.revenue
      : def.key === "orders"
        ? analysis.group.orders
        : analysis.peerStats[def.key]?.mean;
  const peer = analysis.peerStats[def.key];
  const flags = storeAnalysis
    ? storeAnalysis.flags.filter((f) => f.kpi === def.key)
    : analysis.suggestions.filter((s) => s.kpi === def.key).slice(0, 5);

  return `
    <div class="drawer-section">
      <p class="eyebrow">${storeAnalysis ? escapeHtml(storeAnalysis.store.name) : "Network"} · ${escapeHtml(def.label)}</p>
      <p class="metric-value tabular">${formatKpi(value || 0, def.format)}</p>
      <p>${
        peer
          ? `Expected range near ${formatKpi(peer.mean, def.format)} (peer typical). ${vsExpectedCopy(value || 0, peer.mean, def.format, def.higherIsBetter)}.`
          : ""
      }</p>
      <h3>Why this looks ${flags.length ? "abnormal" : "normal"}</h3>
      <ul class="insight-list">
        ${
          flags.length
            ? flags
                .map((f) => `<li>${escapeHtml(f.copy || f.why || plainAlertTitle(f))}</li>`)
                .join("")
            : "<li>Looks normal versus other businesses and this week's usual.</li>"
        }
      </ul>
      <div class="drawer-recommend">
        <h3>Suggested action</h3>
        <p>${escapeHtml(def.suggestion)}</p>
      </div>
      <p class="metric-note">Data source: KPI snapshots · Last updated ${timeLabel(state.asOf)}</p>
      <details class="math-hint drawer-math">
        <summary class="info-btn" aria-label="How we calculated this" title="How we calculated this">i</summary>
        <div class="math-hint-body">
          <p class="math-hint-label">How we measured this</p>
          <p class="mono">Watch at ±${WATCH_DISPLAY()}σ · alert at ±${ALERT_Z}σ · peer avg ${peer ? peer.mean.toFixed(2) : "—"} · peer spread ${peer ? peer.stddev.toFixed(2) : "—"}
          ${flags.map((f) => ` · ${f.source} z=${f.z?.toFixed?.(2) ?? "—"}`).join("")}</p>
        </div>
      </details>
    </div>
  `;
}

function WATCH_DISPLAY() {
  return 1.5;
}

export function alertDrawerHtml(item, state) {
  if (!item) return `<p class="detail-placeholder">Alert not found.</p>`;
  return `
    <div class="drawer-section">
      <span class="status-badge status-${item.severity === "alert" ? "attention" : "watch"}">${item.urgency === "now" ? "Act now" : "Review soon"}</span>
      <h3 class="drawer-alert-title">${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.why)}</p>
      <dl class="order-facts">
        <div><dt>Location</dt><dd>${escapeHtml(item.storeName)}</dd></div>
        <div><dt>Business impact</dt><dd>${escapeHtml(String(item.impact))}</dd></div>
        <div><dt>Detected</dt><dd>${timeLabel(item.detected)}</dd></div>
        <div><dt>Confidence</dt><dd>${escapeHtml(item.confidence)}</dd></div>
      </dl>
      <div class="drawer-recommend">
        <h3>Recommended action</h3>
        <p>${escapeHtml(item.action)}</p>
      </div>
      <button type="button" class="btn btn-primary" data-drawer-store="${item.storeId}">Open business</button>
      <details class="math-hint drawer-math">
        <summary class="info-btn" aria-label="How we calculated this" title="How we calculated this">i</summary>
        <div class="math-hint-body">
          <p class="math-hint-label">How we spotted this</p>
          <p class="mono">${escapeHtml(item.tech)}</p>
        </div>
      </details>
    </div>
  `;
}
