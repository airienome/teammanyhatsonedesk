import {
  DEMO_ORDER,
  DIGEST_ITEMS,
  EVENT_ORGANIZER,
  OWNER_RADAR_AGENT_PROMPT,
} from "../data/stores.js";

const URGENT_LINES = [
  {
    who: "Signal · Plant The Future",
    text: "24 moss wall panels · ASAP · 1 Hotel South Beach lobby · ~$18k",
  },
  {
    who: "Floor (not escalated)",
    text: "Both install vans out · no float drivers · team hoped to 'figure it out' rather than call Yair",
  },
  {
    who: "OwnerRadar",
    text: "Silent failure detected — material ASAP commit with no delivery capacity. Escalating to Yair.",
  },
];

export function createDemoController({ onStage, render }) {
  let stage = "idle";
  let timer = null;
  let liveCase = null;
  let mode = null; // "urgent" | "digest"

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

  function signalTranscript() {
    if (mode !== "urgent" || stage === "idle") return [];
    return URGENT_LINES;
  }

  function ownerTranscript() {
    if (mode === "digest" && (stage === "digest" || stage === "found")) {
      return DIGEST_ITEMS.map((item) => ({
        who: item.source,
        text: item.text,
      }));
    }
    if (
      mode === "urgent" &&
      (stage === "owner_call" || stage === "enrich" || stage === "found")
    ) {
      const qty = liveCase?.qty || DEMO_ORDER.qty;
      const where = liveCase?.where || DEMO_ORDER.where;
      return [
        {
          who: "OwnerRadar → Yair",
          text: `Hey Yair — Plant The Future just took a ${qty}-panel ASAP install for ${where}. No drivers available and the floor didn't call you. Want options, or should I look up who's driving the project?`,
        },
        {
          who: "OwnerRadar → Yair",
          text: "Reply APPROVE to coordinate / enrich, REVIEW for detail, or CALL to talk.",
        },
      ];
    }
    return [];
  }

  function playDigest() {
    clearTimer();
    mode = "digest";
    liveCase = null;
    setStage("digest");
  }

  async function playUrgent() {
    clearTimer();
    mode = "urgent";
    liveCase = {
      ...DEMO_ORDER,
      storeName: "Plant The Future",
      breachSummary: "ASAP commission with no install drivers — not escalated by staff",
      eventAt: new Date().toISOString(),
    };
    setStage("alert");
    try {
      await fetch("/api/demo-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qty: DEMO_ORDER.qty,
          when: DEMO_ORDER.when,
          where: DEMO_ORDER.where,
          item: DEMO_ORDER.item,
        }),
      });
    } catch (err) {
      console.warn("demo-order failed", err);
    }
    timer = setTimeout(() => setStage("owner_call"), 1600);
  }

  /** Still used if a live material case appears from the API. */
  function markEntered(activeCase = null) {
    if (activeCase) liveCase = activeCase;
    if (stage !== "idle" && stage !== "listening") return;
    mode = "urgent";
    clearTimer();
    setStage("alert");
    timer = setTimeout(() => setStage("owner_call"), 1400);
  }

  async function approveEnrichment() {
    if (stage !== "owner_call" && stage !== "enrich") return;
    setStage("enrich");
    clearTimer();
    try {
      await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reply", body: "APPROVE" }),
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
    mode = null;
    setStage("idle");
  }

  return {
    get stage() {
      return stage;
    },
    get mode() {
      return mode;
    },
    get liveCase() {
      return liveCase;
    },
    transcript: signalTranscript,
    ownerTranscript,
    playDigest,
    playUrgent,
    approveEnrichment,
    markEntered,
    reset,
    DEMO_ORDER,
    DIGEST_ITEMS,
    EVENT_ORGANIZER,
    OWNER_RADAR_AGENT_PROMPT,
  };
}
