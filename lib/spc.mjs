/**
 * Statistical process control for OwnerRadar.
 * Alert when any KPI is ≥ ALERT_Z σ adverse vs peer group or own history.
 * No hardcoded order sizes — escalation is purely σ-based.
 */

export const WATCH_Z = 1.5;
export const ALERT_Z = 2.0;

/** Mirror of app KPI defs (server-safe). */
export const KPI_DEFS = [
  { key: "revenue", label: "Revenue today", higherIsBetter: true, format: "currency" },
  { key: "orders", label: "Orders", higherIsBetter: true, format: "number" },
  { key: "avgTicket", label: "Avg ticket", higherIsBetter: true, format: "currency" },
  { key: "capacityUtil", label: "Capacity util", higherIsBetter: false, format: "percent" },
  { key: "refundRate", label: "Refund rate", higherIsBetter: false, format: "percent" },
  { key: "discountRate", label: "Discount rate", higherIsBetter: false, format: "percent" },
  { key: "deliveryEta", label: "Delivery ETA", higherIsBetter: false, format: "minutes" },
  { key: "staffingFill", label: "Staffing fill", higherIsBetter: true, format: "percent" },
  { key: "inventoryDays", label: "Inventory cover", higherIsBetter: true, format: "days" },
];

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

export function robustStddev(values) {
  const m = mean(values);
  const sd = stddev(values);
  return Math.max(sd, Math.abs(m) * 0.1, 0.25);
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

function isAdverse(z, higherIsBetter) {
  return higherIsBetter ? z < 0 : z > 0;
}

/**
 * @param {Array} stores — snapshot.stores shape with kpis + history
 */
export function analyzeStores(stores, defs = KPI_DEFS) {
  const peerStats = {};
  for (const def of defs) {
    const values = stores.map((s) => Number(s.kpis?.[def.key] ?? 0));
    peerStats[def.key] = {
      mean: mean(values),
      stddev: robustStddev(values),
      values,
    };
  }

  const storeAnalyses = stores.map((store) => {
    const flags = [];

    for (const def of defs) {
      const value = Number(store.kpis?.[def.key] ?? 0);
      const peer = peerStats[def.key];
      const peerZ = zScore(value, peer.mean, peer.stddev);
      const peerSeverity = severityFromZ(peerZ);

      if (peerSeverity !== "ok" && isAdverse(peerZ, def.higherIsBetter)) {
        flags.push({
          storeId: store.id,
          storeName: store.name,
          kpi: def.key,
          label: def.label,
          source: "peer",
          sourceLabel: "other shops",
          value,
          baseline: peer.mean,
          z: peerZ,
          severity: peerSeverity,
          format: def.format,
        });
      }

      const history = store.history?.[def.key] || [];
      const histPrior = history.slice(0, -1);
      const histSeries = histPrior.length ? histPrior : history;
      const histMean = mean(histSeries);
      const histSd = robustStddev(histSeries);
      const histZ = zScore(value, histMean, histSd);
      const histSeverity = severityFromZ(histZ);

      if (histSeverity !== "ok" && isAdverse(histZ, def.higherIsBetter)) {
        flags.push({
          storeId: store.id,
          storeName: store.name,
          kpi: def.key,
          label: def.label,
          source: "history",
          sourceLabel: "this shop's usual week",
          value,
          baseline: histMean,
          z: histZ,
          severity: histSeverity,
          format: def.format,
        });
      }
    }

    const alertFlags = flags.filter((f) => f.severity === "alert");
    const worstAbs = flags.reduce((max, f) => Math.max(max, Math.abs(f.z)), 0);
    let status = "ok";
    if (worstAbs >= ALERT_Z) status = "alert";
    else if (worstAbs >= WATCH_Z) status = "watch";

    return {
      store,
      flags,
      alertFlags,
      status,
      worstAbs,
      outOfControl: status === "alert",
    };
  });

  return {
    storeAnalyses,
    peerStats,
    outOfControl: storeAnalyses.filter((a) => a.outOfControl),
    alertZ: ALERT_Z,
    watchZ: WATCH_Z,
  };
}

export function summarizeBreach(analysis) {
  if (!analysis?.outOfControl) return "Looks normal";
  const top = [...(analysis.alertFlags || analysis.flags || [])]
    .filter((f) => f.severity === "alert")
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, 3);
  if (!top.length) {
    return `${analysis.store?.name || "Store"} needs a look — numbers are off versus other shops or this week's usual`;
  }
  return top
    .map((f) => {
      const dir = f.z >= 0 ? "higher" : "lower";
      const vs =
        f.source === "peer" ? "other shops" : "this shop's usual week";
      return `${f.label} ${dir} than ${vs} (${f.z >= 0 ? "+" : ""}${f.z.toFixed(1)}σ)`;
    })
    .join("; ");
}
