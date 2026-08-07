/**
 * Wire Mia + OwnerRadar tools against production OwnerRadar APIs.
 *
 * Usage: node scripts/setup-elevenlabs.mjs
 */
import "dotenv/config";

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error("ELEVENLABS_API_KEY missing in .env");
  process.exit(1);
}

const HOST =
  process.env.OWNERRADAR_HOST || "https://owneradar.com";

const MIA_ID = process.env.ELEVENLABS_MIA_AGENT_ID || "agent_0201kzcmymnneke8wf4txdb5er48";
const OWNER_ID =
  process.env.ELEVENLABS_OWNER_AGENT_ID || "agent_0701kzcqx4ajf40ac19eg95ags45";
const ORDER_TOOL_ID =
  process.env.ELEVENLABS_ORDER_TOOL_ID || "tool_5901kzcnp7erf8yakn7yqrptmjqh";

const headers = {
  "xi-api-key": KEY,
  "Content-Type": "application/json",
};

async function api(method, path, body) {
  const res = await fetch(`https://api.elevenlabs.io${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}`);
    err.detail = json;
    throw err;
  }
  return json;
}

function bodyProp(description, type = "string", extra = {}) {
  return {
    type,
    description,
    dynamic_variable: "",
    constant_value: "",
    ...extra,
  };
}

const MIA_PROMPT = `You are Sofia, a warm gallery associate at Plant The Future — Little River flagship (8484 NE 2nd Ave, Miami). Plant The Future is Yair Marcoschamer's biophilic art and design studio (one of several businesses he runs).

Personality: calm, design-aware, never corporate. You take large commission and trade orders in stride. You are NOT OwnerRadar and you are NOT a manager. You do not call Yair. You just take the order for Plant The Future.

Routing (hard rules):
- You ONLY take orders for Plant The Future. Every Order tool call is fulfillment from plant-the-future.
- Never assign an order to Yair's other entities (Lala Land, Where Minds Create, Pollinator, Ecoist, Marcoschamer Group).
- If the order is too big for the gallery alone, the system can pull help from Pollinator (sister venture). You do not need to mention that unless asked — just take the order.

When a caller orders moss panels, murals, or arrangements (any size — use the exact count they say):
1. Confirm qty, when needed, and where (install / delivery location).
2. Immediately call the Order tool with:
   - qty: the exact integer panel/piece count from the conversation (never invent a default)
   - when: when they need it (normalize "as soon as possible" → "ASAP")
   - where: install or delivery location (e.g. "1 Hotel South Beach lobby")
   - item: what they ordered (default "moss wall panels")
   - storeId: always "plant-the-future"
3. After the tool succeeds, end warmly: "You're all set — we'll get the studio on it right away."
4. Do NOT refuse the order. Do NOT escalate on the call. Do NOT mention OwnerRadar, σ / statistical control, capacity problems, or looking up designers.

Keep turns short. One question at a time. Sound like a real gallery associate, not an AI assistant.`;

const OWNER_PROMPT = `You are OwnerRadar — the AI manager for Yair Marcoschamer's portfolio. You speak directly to Yair. You are NOT a receptionist, NOT a gallery associate, and NOT Sofia.

Yair wears many hats. His entities on this desk:
- Plant The Future, Inc (CEO) — biophilic gallery & moss murals
- Lala Land of Miami LLC (Member) — café / hospitality
- Where Minds Create (President / Manager) — creative studio
- Marcoschamer Group, Inc (Director) — holding / collaborative
- Pollinator LLC (Member) — ventures
- Ecoist, LLC (Member) — eco accessories

Personality: calm, sharp, partner-level. Brief. Treat Yair like a peer running several Miami creative businesses. Use plain English — never say sigma, σ, z-score, SPC, statistical control, peer mean, or "out of control bands." Say things like "quieter than your other businesses," "Plant The Future is slammed," "installs are running long," or "discounting more than usual."

OUTBOUND alert (only when a business looks unusually off versus the others or its own usual week):
1. The system / CallOwner tool dials Yair. Do not invent a panel count — lead with what's wrong in plain language (which business, what's off).
2. Example lead: "Hey Yair — Plant The Future's ops load just spiked versus your other businesses, and materials cover dropped. Pollinator can help fulfill, but you should know."
3. If a large commission contributed, mention its real qty/where from the live case — never assume 24.
4. Fulfillment when relevant: "Closest help is Pollinator if Plant The Future can't keep up."
5. Ask permission to look up who's driving the demand / the project.
6. If yes: say "On it", call TextOwner, then "Found her! I texted you their LinkedIn and public info."
7. If no: "Got it — I'll stay quiet unless something else looks off."

CallOwner tool: POST /api/call-owner — dials only if live KPIs look unusually off. No hardcoded order size.
TextOwner tool: POST /api/text-owner — SMS LinkedIn + public project notes (Maya Chen / Coastal Form).

INBOUND (Yair calls you anytime):
- Answer as OwnerRadar.
- Lead with businesses that need a look and plain-language summaries of what's wrong.
- Answer questions about any hat: Plant The Future, Lala Land, Where Minds Create, Marcoschamer Group, Pollinator, Ecoist.
- Never invent legal liability. Never discipline employees. Recommend; Yair decides.
- Keep turns short. One clear ask when you need a decision.

Demo success line after enrichment: "Found her! I texted you their LinkedIn and public info."`;

async function ensureTool(existingByName, config) {
  const existing = existingByName.get(config.name);
  if (existing) {
    console.log(`Updating tool ${config.name} (${existing.id})`);
    await api("PATCH", `/v1/convai/tools/${existing.id}`, {
      tool_config: config,
    });
    return existing.id;
  }
  console.log(`Creating tool ${config.name}`);
  const created = await api("POST", `/v1/convai/tools`, {
    tool_config: config,
  });
  return created.id;
}

async function main() {
  const listed = await api("GET", "/v1/convai/tools");
  const byName = new Map(
    (listed.tools || []).map((t) => [t.tool_config?.name, t])
  );

  // Fix Mia Order tool → live /api/order (was demo-order, never attached)
  const orderId = await ensureTool(byName, {
    type: "webhook",
    name: "Order",
    description:
      "Enter a confirmed commission/order into Plant The Future POS after the customer gives quantity, timing, and delivery location. Call once details are confirmed — never before. qty is required.",
    api_schema: {
      url: `${HOST}/api/order`,
      method: "POST",
      content_type: "application/json",
      request_headers: {},
      request_body_schema: {
        type: "object",
        description: "Confirmed order fields from the call",
        required: ["qty", "when", "where", "item"],
        properties: {
          qty: bodyProp("Exact integer panel/piece count from the conversation", "integer"),
          when: bodyProp('When needed, e.g. "ASAP"'),
          where: bodyProp('Delivery / pickup location, e.g. "1 Hotel South Beach lobby"'),
          item: bodyProp('What they ordered, e.g. "moss wall panels"'),
        },
      },
    },
  });

  const briefId = await ensureTool(byName, {
    type: "webhook",
    name: "GetStoreBrief",
    description:
      "Fetch live Yair Marcoschamer portfolio status from the OwnerRadar database: store KPIs, out-of-band shops, recent catering orders, inventory, and who is on the clock. Call this whenever the owner asks about shops or status. Optional storeId to focus on one shop (e.g. plant-the-future).",
    api_schema: {
      url: `${HOST}/api/owner-brief`,
      method: "POST",
      content_type: "application/json",
      request_headers: {},
      request_body_schema: {
        type: "object",
        description: "Optional filter",
        required: [],
        properties: {
          storeId: bodyProp(
            "Optional store id such as plant-the-future, pollinator, lala-land. Omit for all shops."
          ),
        },
      },
    },
  });

  const ordersId = await ensureTool(byName, {
    type: "webhook",
    name: "GetOrders",
    description:
      "Fetch recent orders from the live database. Use when the owner asks about tickets, catering, phone orders, or a specific shop's recent sales.",
    api_schema: {
      url: `${HOST}/api/orders`,
      method: "GET",
      request_headers: {},
      query_params_schema: {
        properties: {
          storeId: bodyProp("Optional store id filter"),
          limit: bodyProp("Max rows (default 40)", "string"),
          material: bodyProp('Pass "1" for material / out-of-band catering only'),
        },
      },
    },
  });

  const callOwnerId = await ensureTool(byName, {
    type: "webhook",
    name: "CallOwner",
    description:
      "Dial the owner phone when a shop looks unusually off versus peers or its usual week. System escalation tool — do not use while already on an inbound call with the owner.",
    api_schema: {
      url: `${HOST}/api/call-owner`,
      method: "POST",
      content_type: "application/json",
      request_headers: {},
      request_body_schema: {
        type: "object",
        description: "Optional targeting",
        required: [],
        properties: {
          storeId: bodyProp("Business to evaluate, e.g. plant-the-future"),
          reason: bodyProp("Short reason for the dial"),
          force: bodyProp("Set true only to bypass cooldown", "boolean"),
        },
      },
    },
  });

  const textOwnerId = await ensureTool(byName, {
    type: "webhook",
    name: "TextOwner",
    description:
      "SMS the owner LinkedIn + public event notes after they approve enrichment (Maya Chen / Coastal Form).",
    api_schema: {
      url: `${HOST}/api/text-owner`,
      method: "POST",
      content_type: "application/json",
      request_headers: {},
      request_body_schema: {
        type: "object",
        description: "Optional overrides; defaults to demo organizer enrichment",
        required: [],
        properties: {
          name: bodyProp("Organizer name"),
          role: bodyProp("Organizer role"),
          linkedin: bodyProp("LinkedIn URL"),
        },
      },
    },
  });

  console.log("Attaching tools to Sofia…");
  await api("PATCH", `/v1/convai/agents/${MIA_ID}`, {
    conversation_config: {
      agent: {
        prompt: {
          prompt: MIA_PROMPT,
          tool_ids: [orderId || ORDER_TOOL_ID],
        },
        first_message: "Plant The Future, this is Sofia — how can I help you today?",
      },
    },
  });

  console.log("Attaching tools to OwnerRadar…");
  await api("PATCH", `/v1/convai/agents/${OWNER_ID}`, {
    conversation_config: {
      agent: {
        prompt: {
          prompt: OWNER_PROMPT,
          tool_ids: [briefId, ordersId, callOwnerId, textOwnerId],
        },
        first_message:
          "OwnerRadar here — give me a sec to pull your portfolio, then I'll brief you.",
      },
    },
  });

  console.log("\nDone.");
  console.log(
    JSON.stringify(
      {
        host: HOST,
        mia: MIA_ID,
        owner: OWNER_ID,
        tools: {
          Order: orderId,
          GetStoreBrief: briefId,
          GetOrders: ordersId,
          CallOwner: callOwnerId,
          TextOwner: textOwnerId,
        },
        envHint: {
          ELEVENLABS_OWNER_AGENT_ID: OWNER_ID,
          ELEVENLABS_OWNER_PHONE_NUMBER_ID:
            "phnum_5401kzcrh23pexxth6v24xmgtqgg",
          ELEVENLABS_MIA_AGENT_ID: MIA_ID,
        },
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message);
  console.error(JSON.stringify(err.detail, null, 2));
  process.exit(1);
});
