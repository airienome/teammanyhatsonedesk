import {
  CASHIER_AGENT_PROMPT,
  DEMO_ORDER,
  EVENT_ORGANIZER,
  OWNER_RADAR_AGENT_PROMPT,
} from "../data/stores.js";

/** Live webhook path — escalate when a shop looks unusually off, not a fixed pizza count. */
const OWNER_LINES = [
  {
    who: "OwnerRadar → Pablo (SMS)",
    text: "Hey Pablo — one of your Joe's shops looks off versus the rest of the network. We can supply through the other locations, but you should know.",
  },
  {
    who: "OwnerRadar → Pablo (SMS)",
    text: "Reply APPROVE to coordinate, REVIEW for detail, or CALL to talk.",
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
      if (!liveCase?.breachSummary && !liveCase?.qty) return OWNER_LINES;
      const qtyBit = liveCase.qty ? `${liveCase.qty} pies` : "a demand spike";
      const whereBit = liveCase.where || "the venue";
      const spcBit =
        liveCase.breachSummary || "something unusual versus other shops or this week's usual";
      return [
        {
          who: "OwnerRadar → Pablo (SMS)",
          text: `Hey Pablo — ${liveCase.storeName || "a Joe's store"} needs a look (${spcBit}). Related order: ${qtyBit} for ${whereBit}. Reply APPROVE / REVIEW / CALL.`,
        },
        OWNER_LINES[1],
      ];
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

  async function approveEnrichment() {
    if (stage !== "owner_call" && stage !== "enrich") return;
    setStage("enrich");
    clearTimer();
    try {
      // Simulate owner replying APPROVE to the SPC SMS
      await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reply",
          body: "APPROVE",
          from: undefined,
        }),
      });
    } catch (err) {
      console.warn("approve sms failed", err);
    }
    try {
      await fetch("/api/text-owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: EVENT_ORGANIZER.name,
          role: EVENT_ORGANIZER.role,
          linkedin: EVENT_ORGANIZER.linkedin,
          notes: EVENT_ORGANIZER.publicNotes,
        }),
      });
    } catch (err) {
      console.warn("text-owner failed", err);
    }
    timer = setTimeout(() => setStage("found"), 900);
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
