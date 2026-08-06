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

function directionLabel(z, higherIsBetter) {
  const above = z > 0;
  if (higherIsBetter) {
    return above ? "above" : "below";
  }
  return above ? "above" : "below";
}

function isAdverse(z, higherIsBetter) {
  return higherIsBetter ? z < 0 : z > 0;
}

function buildSuggestionCopy(store, def, z, baselineLabel, baselineValue, value) {
  const dir = directionLabel(z, def.higherIsBetter);
  const adverse = isAdverse(z, def.higherIsBetter);
  const tone = adverse ? "Review" : "Note";
  return `${store.name} ${def.label.toLowerCase()} is ${Math.abs(z).toFixed(1)}σ ${dir} ${baselineLabel} (${formatKpi(value, def.format)} vs ${formatKpi(baselineValue, def.format)}). ${tone}: ${def.suggestion}`;
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
        kpiFlags.push({
          storeId: store.id,
          storeName: store.name,
          kpi: def.key,
          label: def.label,
          source: "peer",
          sourceLabel: "peer group",
          value,
          baseline: peer.mean,
          z: peerZ,
          severity: peerSeverity,
          format: def.format,
          copy: buildSuggestionCopy(
            store,
            def,
            peerZ,
            "peer mean",
            peer.mean,
            value
          ),
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
        kpiFlags.push({
          storeId: store.id,
          storeName: store.name,
          kpi: def.key,
          label: def.label,
          source: "history",
          sourceLabel: "own 7-day history",
          value,
          baseline: histMean,
          z: histZ,
          severity: histSeverity,
          format: def.format,
          copy: buildSuggestionCopy(
            store,
            def,
            histZ,
            "its 7-day mean",
            histMean,
            value
          ),
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
