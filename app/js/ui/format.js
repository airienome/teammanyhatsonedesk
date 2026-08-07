import { formatKpi, ALERT_Z, WATCH_Z } from "../stats.js";

export { formatKpi };

export function money(cents) {
  return formatKpi((Number(cents) || 0) / 100, "currency");
}

export function timeLabel(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function timeShort(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function channelLabel(channel) {
  const map = {
    phone: "Phone",
    web: "Web",
    pos: "Gallery",
    counter: "Gallery",
    trade: "Trade",
    commission: "Commission",
    uber_eats: "Delivery app",
    door_dash: "Delivery app",
  };
  return map[channel] || channel || "POS";
}

export function itemDisplay(order) {
  const raw = order.itemLabel || order.item || "Order";
  if (raw === "mixed_pies") return "mixed pieces";
  if (raw === "cheese_pie" || raw === "slice_or_pie") return "arrangement";
  return raw;
}

export function statusLabel(status) {
  if (status === "alert" || status === "attention" || status === "critical") {
    return "Needs attention";
  }
  if (status === "watch") return "Watch";
  return "Normal";
}

export function toTileStatus(status) {
  if (status === "alert") return "attention";
  if (status === "critical") return "critical";
  if (status === "watch") return "watch";
  return "normal";
}

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Business-language comparison without σ notation at executive level. */
export function vsExpectedCopy(value, baseline, format, higherIsBetter) {
  if (baseline == null || !Number.isFinite(baseline) || baseline === 0) {
    return "Within typical range";
  }
  const delta = ((value - baseline) / Math.abs(baseline)) * 100;
  const dir = delta >= 0 ? "above" : "below";
  const adverse = higherIsBetter ? delta < 0 : delta > 0;
  const tone = adverse ? "vs expected" : "vs typical";
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% ${dir} ${tone} · ${formatKpi(baseline, format)} peer avg`;
}

export function severityConfidence(z) {
  const abs = Math.abs(z || 0);
  if (abs >= ALERT_Z + 0.5) return "High";
  if (abs >= ALERT_Z) return "Elevated";
  if (abs >= WATCH_Z) return "Moderate";
  return "Low";
}

export function plainAlertTitle(suggestion) {
  if (suggestion.title) return suggestion.title;
  const store = suggestion.storeName || "Location";
  const label = suggestion.plainLabel || (suggestion.label || "metric").toLowerCase();
  if (suggestion.severity === "alert") {
    return `${store}: ${label} needs a look`;
  }
  return `${store}: keep an eye on ${label}`;
}

export function materialCaseTitle(activeCase, storeName = "Plant The Future") {
  const qty = activeCase?.qty;
  if (qty) return `${storeName}: ${qty}-panel ASAP — floor didn't escalate`;
  return `${storeName}: silent failure — material commit not escalated`;
}

export function materialCaseImpact(activeCase) {
  const qty = activeCase?.qty;
  const value = activeCase?.value;
  const valuePart = value
    ? ` Ticket about ${formatKpi(value, "currency")}.`
    : "";
  const qtyPart = qty ? ` ${qty} panels ASAP` : " A large ASAP commission";
  return `${qtyPart} with no install drivers / vans available.${valuePart} Staff hoped to figure it out rather than disturb the owner.`;
}

export function materialRecommendedAction() {
  return "Brief the owner, float install capacity from Pollinator or push the window, and loop the buyer if needed.";
}

export function locationDiagnostic(analysis) {
  if (!analysis) return "Looks normal.";
  const { flags, status, store } = analysis;
  if (store?.activeCase && status === "alert") {
    const qty = store.activeCase.qty;
    return qty
      ? `Silent failure: ${qty}-panel ASAP with no install capacity — floor didn't escalate.`
      : "Silent failure: material ASAP commit without owner escalation.";
  }
  if (status === "alert") {
    const top = [...(flags || [])].sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
    if (top?.copy) return top.copy;
    if (top?.title) return top.title;
    return "Something unusual is going on — open this location for details.";
  }
  if (!flags?.length) return "Everything looks normal versus other desks and this week's usual.";
  const top = [...flags].sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
  return top.copy || top.title || `${top.label} looks off versus ${top.sourceLabel}.`;
}

export function orderExceptionTag(order) {
  if (order.isMaterial) return "Large commission";
  if (order.channel === "phone" && (order.pizzaCount || 0) >= 8) {
    return "Capacity risk";
  }
  return "Routine";
}

export function shortHash(hash) {
  if (!hash) return "—";
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function chainStatusLabel(chain) {
  if (!chain) return "";
  if (chain.status === "anchored") return "On-chain";
  if (chain.status === "signed") return "Signed";
  if (chain.status === "pending") return "Chain pending";
  if (chain.status === "failed") return "Chain failed";
  return chain.status || "";
}

export function recentOrdersWindow(rows, minutes = 5) {
  const cutoff = Date.now() - minutes * 60_000;
  return (rows || []).filter((o) => {
    const t = o.occurredAt ? new Date(o.occurredAt).getTime() : 0;
    return t >= cutoff;
  });
}

export function estimatedExposure(stores, analysis) {
  let exposure = 0;
  for (const s of stores || []) {
    if (s.activeCase?.value) exposure += Number(s.activeCase.value) || 0;
  }
  const alertStores = (analysis?.storeAnalyses || []).filter(
    (a) => a.status === "alert"
  );
  for (const a of alertStores) {
    if (!a.store.activeCase) {
      exposure += Math.round((a.store.kpis?.revenue || 0) * 0.08);
    }
  }
  return exposure;
}
