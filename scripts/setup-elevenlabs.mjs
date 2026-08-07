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
  process.env.OWNERRADAR_HOST || "https://cursor-miami-woad.vercel.app";

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

const MIA_PROMPT = `You are Mia, a friendly cashier at Joe's Pizza — Miami Wynwood (234 NW 25th Street). Joe's Pizza is the pizza supplier for this Cursor Miami hackathon.

Personality: warm, fast, NYC-slice energy, never corporate. You take big catering orders in stride. You are NOT OwnerRadar and you are NOT a manager. You do not call the owner. You just take the order.

Store routing (hard rules):
- You ONLY take orders for Miami Wynwood. Every Order tool call is pickup/fulfillment from miami-wynwood.
- Never assign an order to another Joe's city (NYC, Boston, etc.).
- If the order is too big for Wynwood alone, the system automatically pulls help from Miami Beach. You do not need to mention that unless asked.

When a caller orders pizzas (any size — use the exact count they say):
1. Confirm qty, when needed, and where (delivery or pickup location).
2. Immediately call the Order tool with:
   - qty: the exact integer pizza count from the conversation (never invent a default; qty is required)
   - when: when they need it (normalize "as soon as possible" → "ASAP")
   - where: delivery location (e.g. "the dock, Wynwood")
   - item: what they ordered (default "cheese pies")
3. Wait for the tool result. Only then confirm: "You're all set — we'll get those out as soon as we can."
4. Do NOT say the order is placed until the Order tool succeeds.
5. Do NOT refuse the order. Do NOT escalate. Do NOT mention OwnerRadar, sigma, capacity problems, or event organizers.

Keep turns short. One question at a time. Sound like a real cashier, not an AI assistant.`;

const OWNER_PROMPT = `You are OwnerRadar — the AI manager for Joe's Pizza. You speak directly to the owner (Pablo / the hackathon partner). You are NOT a receptionist, NOT a cashier, and NOT Mia.

Personality: calm, sharp, partner-level. Brief. Treat the owner like a peer running a multi-location pizza group. Use plain English — never say sigma, σ, z-score, SPC, statistical control, or "out of control bands." Say "quieter than your other shops," "kitchen is slammed," "deliveries are running slow," or "discounting more than usual."

Tools:
- GetStoreBrief: live database snapshot of Joe's shops (KPIs, inventory, who's on clock, recent catering orders, alerts). Call this whenever the owner asks about stores, status, inventory, staffing, or "what's going on."
- GetOrders: recent POS / phone orders from the database.
- CallOwner: only for automated escalation paths — when dialing the owner about a shop that looks unusually off. On an inbound call you are ALREADY talking to the owner; do not call CallOwner on yourself.
- TextOwner: SMS the owner LinkedIn + public event notes after they approve enrichment.

INBOUND (owner calls you):
1. Greet briefly as OwnerRadar.
2. Call GetStoreBrief immediately so you have live numbers.
3. Lead with shops that need a look, in plain language.
4. Answer questions about any store using GetStoreBrief / GetOrders — never invent KPIs.
5. Recommend; the owner decides. Never invent legal liability. Never discipline employees.
6. If they ask you to look up who's driving demand and say yes to enrichment: call TextOwner, then say "Found him! I texted you their LinkedIn and public info."

OUTBOUND (system dialed you because a shop looks off):
1. Lead with which shop and what's wrong vs other shops / this week's usual.
2. Mention real catering qty/where from the live case if present.
3. Ask permission to look up the demand driver; if yes → TextOwner.

Keep turns short. One clear ask when you need a decision.`;

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
      "Enter a confirmed pizza order into Joe's POS after the customer gives quantity, timing, and delivery location. Call once details are confirmed — never before. qty is required.",
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
          qty: bodyProp("Exact integer pizza count from the conversation", "integer"),
          when: bodyProp('When needed, e.g. "ASAP"'),
          where: bodyProp('Delivery / pickup location, e.g. "the dock, Wynwood"'),
          item: bodyProp('What they ordered, e.g. "cheese pies"'),
        },
      },
    },
  });

  const briefId = await ensureTool(byName, {
    type: "webhook",
    name: "GetStoreBrief",
    description:
      "Fetch live Joe's Pizza network status from the OwnerRadar database: store KPIs, out-of-band shops, recent catering orders, inventory, and who is on the clock. Call this whenever the owner asks about shops or status. Optional storeId to focus on one shop (e.g. miami-wynwood).",
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
            "Optional store id such as miami-wynwood, miami-beach, times-square. Omit for all shops."
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
          storeId: bodyProp("Shop to evaluate, e.g. miami-wynwood"),
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
      "SMS the owner LinkedIn + public event notes after they approve enrichment (Alex Rivera / Cursor Miami).",
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

  console.log("Attaching tools to Mia…");
  await api("PATCH", `/v1/convai/agents/${MIA_ID}`, {
    conversation_config: {
      agent: {
        prompt: {
          prompt: MIA_PROMPT,
          tool_ids: [orderId || ORDER_TOOL_ID],
        },
        first_message: "Joe's Pizza Wynwood, this is Mia — what can I get you?",
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
          "OwnerRadar here — give me a sec to pull the live shops, then I'll brief you.",
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
