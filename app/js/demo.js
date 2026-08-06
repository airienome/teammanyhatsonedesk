import {
  CASHIER_AGENT_PROMPT,
  DEMO_ORDER,
  EVENT_ORGANIZER,
  OWNER_RADAR_AGENT_PROMPT,
} from "../data/stores.js";

/** Live webhook path — no scripted cashier demo. */
const OWNER_LINES = [
  {
    who: "OwnerRadar → Owner (partner)",
    text: `Hey — Joe's Miami Wynwood just took a material catering order (~${DEMO_ORDER.qty} pies for ${DEMO_ORDER.where}). Estimated ~$${DEMO_ORDER.value.toLocaleString()}. We can supply it, but you should know.`,
  },
  {
    who: "OwnerRadar → Owner (partner)",
    text: "Want me to find who's running that event? There might be more catering in it — I can look up who's in charge and text you their LinkedIn and public info.",
  },
];

export function createDemoController({ onStage, render }) {
  let stage = "listening";
  let timer = null;
  let liveCase = null;
  let listenSince = Date.now();

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function setStage(next) {
    stage = next;
    onStage?.(stage);
    render?.();
  }

  function transcript() {
    // Cashier side is a real phone call — UI only mirrors webhook result.
    if (!liveCase) return [];
    return [
      {
        who: "Webhook · Order tool",
        text: `${liveCase.qty || DEMO_ORDER.qty} ${liveCase.item || "pies"} · ${liveCase.when || "ASAP"} · ${liveCase.where || DEMO_ORDER.where}`,
      },
      {
        who: "POS",
        text: `Case ${liveCase.caseId || DEMO_ORDER.caseId} written · KPIs recomputed · Wynwood flagged`,
      },
    ];
  }

  function ownerTranscript() {
    if (stage === "owner_call" || stage === "enrich" || stage === "found") {
      return OWNER_LINES.map((line) => {
        if (!liveCase) return line;
        const qty = liveCase.qty || DEMO_ORDER.qty;
        const where = liveCase.where || DEMO_ORDER.where;
        const value = liveCase.value || DEMO_ORDER.value;
        return {
          ...line,
          text: line.text
            .replace(String(DEMO_ORDER.qty), String(qty))
            .replace(DEMO_ORDER.where, where)
            .replace(
              DEMO_ORDER.value.toLocaleString(),
              Number(value).toLocaleString()
            ),
        };
      });
    }
    return [];
  }

  /** Fired when a fresh material order lands via /api/order or /api/retell-order. */
  function markEntered(activeCase = null) {
    if (activeCase) liveCase = activeCase;
    if (stage !== "listening") return;
    const eventAt = activeCase?.eventAt
      ? new Date(activeCase.eventAt).getTime()
      : Date.now();
    // Ignore cases that already existed before we started / reset listening
    if (eventAt < listenSince - 5_000) return;
    clearTimer();
    setStage("alert");
    timer = setTimeout(() => setStage("owner_call"), 1400);
  }

  function approveEnrichment() {
    if (stage !== "owner_call" && stage !== "enrich") return;
    setStage("enrich");
    clearTimer();
    timer = setTimeout(() => setStage("found"), 1400);
  }

  function reset() {
    clearTimer();
    liveCase = null;
    listenSince = Date.now();
    setStage("listening");
  }

  return {
    get stage() {
      return stage;
    },
    get liveCase() {
      return liveCase;
    },
    transcript,
    ownerTranscript,
    approveEnrichment,
    markEntered,
    reset,
    OWNER_LINES,
    DEMO_ORDER,
    EVENT_ORGANIZER,
    CASHIER_AGENT_PROMPT,
    OWNER_RADAR_AGENT_PROMPT,
  };
}
