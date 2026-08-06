import { KPI_DEFS, STORES } from "../data/stores.js";

const WATCH_Z = 1.5;
const ALERT_Z = 2.0;

export function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function stddev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Avoid absurd z-scores when a series is nearly flat. */
export function robustStddev(values) {
  const m = mean(values);
  const sd = stddev(values);
  const relativeFloor = Math.abs(m) * 0.1;
  const absoluteFloor = 0.25;
  return Math.max(sd, relativeFloor, absoluteFloor);
}

export function zScore(value, avg, sd) {
  if (!sd || sd === 0) return 0;
  return (value - avg) / sd;
}

export function severityFromZ(z) {
  const abs = Math.abs(z);
  if (abs >= ALERT_Z) return "alert";
  if (abs >= WATCH_Z) return "watch";
  return "ok";
}

export function formatKpi(value, format) {
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
    case "percent":
      return `${value.toFixed(1)}%`;
    case "minutes":
      return `${Math.round(value)} min`;
    case "days":
      return `${value.toFixed(1)}d`;
    case "number":
    default:
      return new Intl.NumberFormat("en-US").format(Math.round(value));
  }
}

function isAdverse(z, higherIsBetter) {
  return higherIsBetter ? z < 0 : z > 0;
}

/** Owner-facing metric name (no ops jargon). */
function plainMetric(def) {
  const map = {
    revenue: "sales",
    orders: "orders",
    avgTicket: "average ticket",
    capacityUtil: "kitchen load",
    refundRate: "refunds",
    discountRate: "discounting",
    deliveryEta: "delivery times",
    staffingFill: "staffing",
    inventoryDays: "inventory cover",
  };
  return map[def.key] || def.label.toLowerCase();
}

function compareAgainst(source) {
  return source === "peer" ? "your other shops" : "this shop's usual week";
}

function sourcePlain(source) {
  return source === "peer" ? "other shops" : "this shop's last 7 days";
}

/**
 * Plain-language alert for pizza owners.
 * Math stays in `math` for the info (i) control.
 */
function buildSuggestionNarratives(store, def, z, source, baselineValue, value) {
  const vs = formatKpi(value, def.format);
  const base = formatKpi(baselineValue, def.format);
  const against = compareAgainst(source);
  const above = z > 0;
  const metric = plainMetric(def);

  let headline;
  let body;

  switch (def.key) {
    case "orders":
      headline = above
        ? `${store.name} is busier than ${against}`
        : `${store.name} is quieter than ${against}`;
      body = above
        ? `${store.name} has ${vs} orders today vs about ${base} at ${against}. Make sure the kitchen and front counter can keep up.`
        : `${store.name} has ${vs} orders today vs about ${base} at ${against}. ${def.suggestion}`;
      break;
    case "deliveryEta":
      headline = `${store.name} deliveries are running slow`;
      body = `Deliveries are averaging ${vs} vs about ${base} for ${against}. ${def.suggestion}`;
      break;
    case "capacityUtil":
      headline = above
        ? `${store.name}'s kitchen is slammed`
        : `${store.name}'s kitchen is quieter than usual`;
      body = above
        ? `Kitchen load is ${vs} vs about ${base} for ${against}. ${def.suggestion}`
        : `Kitchen load is ${vs} vs about ${base} for ${against}. Fine if demand is soft — otherwise check why tickets are down.`;
      break;
    case "discountRate":
      headline = `${store.name} is discounting more than usual`;
      body = `Discounts are at ${vs} vs about ${base} for ${against}. ${def.suggestion}`;
      break;
    case "refundRate":
      headline = `${store.name} refunds are elevated`;
      body = `Refund rate is ${vs} vs about ${base} for ${against}. ${def.suggestion}`;
      break;
    case "inventoryDays":
      headline = above
        ? `${store.name} is overstocked`
        : `${store.name} may run short on inventory`;
      body = above
        ? `Inventory cover is ${vs} vs about ${base} for ${against}.`
        : `Inventory cover is ${vs} vs about ${base} for ${against}. ${def.suggestion}`;
      break;
    case "staffingFill":
      headline = above
        ? `${store.name} is overstaffed vs usual`
        : `${store.name} looks short-staffed`;
      body = `Staffing is ${vs} vs about ${base} for ${against}. ${def.suggestion}`;
      break;
    case "revenue":
      headline = above
        ? `${store.name} sales are up vs ${against}`
        : `${store.name} sales are down vs ${against}`;
      body = `Sales are ${vs} vs about ${base}. ${def.suggestion}`;
      break;
    case "avgTicket":
      headline = above
        ? `${store.name} tickets are larger than usual`
        : `${store.name} tickets are smaller than usual`;
      body = `Average ticket is ${vs} vs about ${base} for ${against}. ${def.suggestion}`;
      break;
    default:
      headline = `${store.name}: ${metric} looks off`;
      body = `${metric} is ${above ? "higher" : "lower"} than ${against} (${vs} vs about ${base}). ${def.suggestion}`;
  }

  const math = [
    `${def.label}: ${vs}`,
    `Compared to ${sourcePlain(source)}: ${base}`,
    `Gap score: ${z >= 0 ? "+" : ""}${z.toFixed(2)}σ (alert at ±2.0σ, watch at ±1.5σ)`,
  ].join(" · ");

  return {
    title: headline,
    copy: body,
    math,
  };
}

export function analyzeStores(stores = STORES, defs = KPI_DEFS) {
  const peerStats = {};
  for (const def of defs) {
      const values = stores.map((s) => s.kpis[def.key]);
      const avg = mean(values);
      const sd = robustStddev(values);
      peerStats[def.key] = { mean: avg, stddev: sd, values };
  }

  const storeAnalyses = stores.map((store) => {
    const kpiFlags = [];

    for (const def of defs) {
      const value = store.kpis[def.key];
      const peer = peerStats[def.key];
      const peerZ = zScore(value, peer.mean, peer.stddev);
      const peerSeverity = severityFromZ(peerZ);

      if (peerSeverity !== "ok" && isAdverse(peerZ, def.higherIsBetter)) {
        const narrative = buildSuggestionNarratives(
          store,
          def,
          peerZ,
          "peer",
          peer.mean,
          value
        );
        kpiFlags.push({
          storeId: store.id,
          storeName: store.name,
          kpi: def.key,
          label: def.label,
          plainLabel: plainMetric(def),
          source: "peer",
          sourceLabel: "other shops",
          value,
          baseline: peer.mean,
          z: peerZ,
          severity: peerSeverity,
          format: def.format,
          title: narrative.title,
          copy: narrative.copy,
          math: narrative.math,
        });
      }

      const history = store.history[def.key] || [];
      const histPrior = history.slice(0, -1);
      const histSeries = histPrior.length ? histPrior : history;
      const histMean = mean(histSeries);
      const histSd = robustStddev(histSeries);
      const histZ = zScore(value, histMean, histSd);
      const histSeverity = severityFromZ(histZ);

      if (histSeverity !== "ok" && isAdverse(histZ, def.higherIsBetter)) {
        const narrative = buildSuggestionNarratives(
          store,
          def,
          histZ,
          "history",
          histMean,
          value
        );
        kpiFlags.push({
          storeId: store.id,
          storeName: store.name,
          kpi: def.key,
          label: def.label,
          plainLabel: plainMetric(def),
          source: "history",
          sourceLabel: "this shop's usual week",
          value,
          baseline: histMean,
          z: histZ,
          severity: histSeverity,
          format: def.format,
          title: narrative.title,
          copy: narrative.copy,
          math: narrative.math,
        });
      }
    }

    const worstAbs = kpiFlags.reduce(
      (max, f) => Math.max(max, Math.abs(f.z)),
      0
    );
    let status = "ok";
    if (worstAbs >= ALERT_Z) status = "alert";
    else if (worstAbs >= WATCH_Z) status = "watch";

    return {
      store,
      flags: kpiFlags,
      status,
      worstAbs,
    };
  });

  const suggestions = storeAnalyses
    .flatMap((a) => a.flags)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));

  const compliantCount = storeAnalyses.filter((a) => a.status === "ok").length;
  const groupRevenue = stores.reduce((sum, s) => sum + s.kpis.revenue, 0);
  const groupOrders = stores.reduce((sum, s) => sum + s.kpis.orders, 0);
  const openRisks = storeAnalyses.filter((a) => a.status === "alert").length;

  return {
    storeAnalyses,
    suggestions,
    peerStats,
    group: {
      revenue: groupRevenue,
      orders: groupOrders,
      openRisks,
      compliantCount,
      storeCount: stores.length,
    },
  };
}

export { WATCH_Z, ALERT_Z, KPI_DEFS, STORES };
