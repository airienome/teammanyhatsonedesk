/**
 * Shared "real-ish" pizza-ops timing helpers.
 * Sim day for the hackathon anchors at 7:00 PM America/New_York.
 */

export const SIM_TZ = "America/New_York";

/** Default wall-clock start for tonight's demo service. */
export function defaultSimStart() {
  // 2026-08-06 19:00 America/New_York = 23:00 UTC (EDT)
  return new Date("2026-08-06T23:00:00.000Z");
}

export function hourInTz(date = new Date(), timeZone = SIM_TZ) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value || 0);
}

/**
 * Relative demand for a Joe's slice shop by local hour.
 * 1.0 = dinner peak; quieter late night / mid-afternoon.
 */
export function demandMultiplier(date = new Date()) {
  const h = hourInTz(date);
  if (h >= 11 && h < 13) return 0.75; // lunch
  if (h >= 13 && h < 17) return 0.35;
  if (h >= 17 && h < 18) return 0.7;
  if (h >= 18 && h < 20) return 1.0; // dinner peak (incl. 7pm start)
  if (h >= 20 && h < 21) return 0.8;
  if (h >= 21 && h < 22) return 0.5;
  if (h >= 22 && h < 23) return 0.3;
  return 0.12;
}

export function formatSimClock(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SIM_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}
