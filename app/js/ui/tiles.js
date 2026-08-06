/**
 * Collapsible operational tile system + localStorage prefs.
 */

const PREFS_KEY = "ownerradar.tiles";

const DEFAULT_PREFS = {
  attention: { expanded: true, pinned: false },
  orders: { expanded: false, pinned: false },
  locations: { expanded: false, pinned: false },
  inventory: { expanded: false, pinned: false },
  labor: { expanded: false, pinned: false },
  phone: { expanded: false, pinned: false },
  discounts: { expanded: false, pinned: false },
  delivery: { expanded: false, pinned: false },
  utilities: { expanded: false, pinned: false },
  demo: { expanded: false, pinned: false },
};

export function loadTilePrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return structuredClone(DEFAULT_PREFS);
    const parsed = JSON.parse(raw);
    const merged = structuredClone(DEFAULT_PREFS);
    for (const id of Object.keys(merged)) {
      if (parsed[id]) {
        merged[id] = {
          expanded: Boolean(parsed[id].expanded),
          pinned: Boolean(parsed[id].pinned),
        };
      }
    }
    return merged;
  } catch {
    return structuredClone(DEFAULT_PREFS);
  }
}

export function saveTilePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function collapseAllPrefs(prefs) {
  const next = {};
  for (const [id, val] of Object.entries(prefs)) {
    next[id] = { ...val, expanded: Boolean(val.pinned) };
  }
  return next;
}

export function expandPinnedPrefs(prefs) {
  const next = {};
  for (const [id, val] of Object.entries(prefs)) {
    next[id] = { ...val, expanded: Boolean(val.pinned) };
  }
  return next;
}

export function setTileExpanded(prefs, id, expanded) {
  const cur = prefs[id] || { expanded: false, pinned: false };
  return {
    ...prefs,
    [id]: { ...cur, expanded: Boolean(expanded) },
  };
}

export function toggleTilePin(prefs, id) {
  const cur = prefs[id] || { expanded: false, pinned: false };
  const pinned = !cur.pinned;
  return {
    ...prefs,
    [id]: { expanded: pinned ? true : cur.expanded, pinned },
  };
}

export function statusBadgeLabel(status) {
  const map = {
    normal: "Normal",
    watch: "Watch",
    attention: "Needs attention",
    critical: "Critical",
    ok: "Normal",
    alert: "Needs attention",
  };
  return map[status] || status;
}

/**
 * @param {object} opts
 * @returns {string} HTML
 */
export function tileShell({
  id,
  title,
  icon = "",
  status = "normal",
  headline = "",
  secondaryMetric = "",
  summary = "",
  alertCount = 0,
  lastUpdated = "",
  expanded = false,
  pinned = false,
  actionsHtml = "",
  bodyHtml = "",
  live = false,
}) {
  const badge = statusBadgeLabel(status);
  const alertHtml =
    alertCount > 0
      ? `<span class="exception-badge" aria-label="${alertCount} exceptions">${alertCount}</span>`
      : "";
  const liveHtml = live
    ? `<span class="live-indicator" title="Live"><span class="live-dot"></span> Live</span>`
    : "";

  return `
    <article
      class="ops-tile status-${status} ${expanded ? "is-expanded" : "is-collapsed"} ${pinned ? "is-pinned" : ""}"
      data-tile-id="${id}"
      id="tile-${id}"
    >
      <div class="ops-tile-header">
        <button
          type="button"
          class="ops-tile-toggle"
          data-tile-toggle="${id}"
          aria-expanded="${expanded}"
          aria-controls="tile-panel-${id}"
          id="tile-btn-${id}"
        >
          ${icon ? `<span class="ops-tile-icon" aria-hidden="true">${icon}</span>` : ""}
          <span class="ops-tile-titles">
            <span class="ops-tile-title-row">
              <span class="ops-tile-title">${title}</span>
              ${liveHtml}
              <span class="status-badge status-${status}">${badge}</span>
              ${alertHtml}
            </span>
            <span class="ops-tile-headline">
              ${headline ? `<strong class="tabular">${headline}</strong>` : ""}
              ${secondaryMetric ? `<span class="ops-tile-secondary">${secondaryMetric}</span>` : ""}
            </span>
            ${summary ? `<span class="ops-tile-summary">${summary}</span>` : ""}
          </span>
          <span class="ops-tile-chevron" aria-hidden="true"></span>
        </button>
        <div class="ops-tile-actions" data-stop-toggle>
          ${lastUpdated ? `<span class="ops-tile-updated">${lastUpdated}</span>` : ""}
          <button
            type="button"
            class="btn btn-ghost btn-sm pin-btn ${pinned ? "is-active" : ""}"
            data-tile-pin="${id}"
            aria-pressed="${pinned}"
            title="${pinned ? "Unpin tile" : "Pin tile open"}"
            aria-label="${pinned ? "Unpin" : "Pin"} ${title}"
          >${pinned ? "Pinned" : "Pin"}</button>
          ${actionsHtml}
        </div>
      </div>
      <div
        class="ops-tile-panel"
        id="tile-panel-${id}"
        role="region"
        aria-labelledby="tile-btn-${id}"
        ${expanded ? "" : "hidden"}
      >
        <div class="ops-tile-body">${bodyHtml}</div>
      </div>
    </article>
  `;
}

/**
 * Bind toggle / pin handlers on a mount root. Returns cleanup.
 */
export function bindTileControls(root, { prefs, onChange }) {
  const onClick = (e) => {
    const pin = e.target.closest("[data-tile-pin]");
    if (pin && root.contains(pin)) {
      e.preventDefault();
      e.stopPropagation();
      const id = pin.getAttribute("data-tile-pin");
      onChange(toggleTilePin(prefs, id));
      return;
    }
    const toggle = e.target.closest("[data-tile-toggle]");
    if (toggle && root.contains(toggle)) {
      const id = toggle.getAttribute("data-tile-toggle");
      const cur = prefs[id]?.expanded;
      onChange(setTileExpanded(prefs, id, !cur));
    }
  };

  const onKey = (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const toggle = e.target.closest("[data-tile-toggle]");
    if (!toggle || !root.contains(toggle)) return;
    e.preventDefault();
    const id = toggle.getAttribute("data-tile-toggle");
    const cur = prefs[id]?.expanded;
    onChange(setTileExpanded(prefs, id, !cur));
  };

  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKey);
  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("keydown", onKey);
  };
}
