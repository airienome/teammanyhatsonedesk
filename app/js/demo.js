import {
  CASHIER_AGENT_PROMPT,
  DEMO_ORDER,
  EVENT_ORGANIZER,
} from "../data/stores.js";

const CALL_LINES = [
  { who: "You", text: "Hey — I need 300 pizzas." },
  {
    who: "Mia · Joe's cashier",
    text: "Ok wow, that's a big order — no problem. When do you need it by?",
  },
  { who: "You", text: "As soon as possible." },
  { who: "Mia · Joe's cashier", text: "Got it. Where should we bring them?" },
  { who: "You", text: "Here at the dock — Wynwood." },
  {
    who: "Mia · Joe's cashier",
    text: "No problem — 300 pies ASAP to the dock in Wynwood. Entering it now…",
  },
];

const OWNER_LINES = [
  {
    who: "OwnerRadar",
    text: `Hey boss — Joe's Miami Wynwood just took a ${DEMO_ORDER.qty}-pizza order for ${DEMO_ORDER.where}. Estimated ~$${DEMO_ORDER.value.toLocaleString()}. We can supply it, but you should know.`,
  },
  {
    who: "OwnerRadar",
    text: "Want me to find who's running that event? There might be more catering in it — I can look up who's in charge and text you their LinkedIn and public info.",
  },
];

export function createDemoController({
  getStores,
  setStores,
  onStage,
  render,
  fireDemoOrder,
}) {
  let stage = "idle";
  let callIndex = 0;
  let timer = null;

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
    if (stage === "idle") return [];
    if (stage === "call") return CALL_LINES.slice(0, callIndex + 1);
    return CALL_LINES;
  }

  function ownerTranscript() {
    if (stage === "owner_call" || stage === "enrich" || stage === "found") {
      return OWNER_LINES;
    }
    return [];
  }

  function playCall() {
    clearTimer();
    callIndex = 0;
    setStage("call");

    const step = () => {
      if (callIndex >= CALL_LINES.length - 1) {
        timer = setTimeout(async () => {
          try {
            if (fireDemoOrder) await fireDemoOrder();
          } catch (err) {
            console.error(err);
          }
          setStage("entered");
          timer = setTimeout(() => setStage("owner_call"), 1200);
        }, 700);
        return;
      }
      callIndex += 1;
      render?.();
      timer = setTimeout(step, 1100);
    };

    timer = setTimeout(step, 1100);
  }

  function approveEnrichment() {
    if (stage !== "owner_call" && stage !== "enrich") return;
    setStage("enrich");
    clearTimer();
    timer = setTimeout(() => setStage("found"), 1400);
  }

  function reset() {
    clearTimer();
    callIndex = 0;
    setStage("idle");
  }

  return {
    get stage() {
      return stage;
    },
    get callIndex() {
      return callIndex;
    },
    transcript,
    ownerTranscript,
    playCall,
    approveEnrichment,
    reset,
    CALL_LINES,
    OWNER_LINES,
    DEMO_ORDER,
    EVENT_ORGANIZER,
    CASHIER_AGENT_PROMPT,
  };
}
