/** Joe's Pizza locations — seeded from joespizzanyc.com for the Cursor Miami hackathon demo. */
export const ORG = {
  id: "joes-pizza",
  name: "Joe's Pizza",
  tagline: "Hackathon pizza supplier · OwnerRadar demo",
  website: "https://www.joespizzanyc.com/",
  asOf: "2026-08-06T17:15:00-04:00",
};

export const KPI_DEFS = [
  {
    key: "revenue",
    label: "Revenue today",
    unit: "usd",
    higherIsBetter: true,
    format: "currency",
    suggestion: "Check order mix and ticket size against local demand.",
  },
  {
    key: "orders",
    label: "Orders",
    unit: "count",
    higherIsBetter: true,
    format: "number",
    suggestion: "Review channel volume and staffing against demand.",
  },
  {
    key: "avgTicket",
    label: "Avg ticket",
    unit: "usd",
    higherIsBetter: true,
    format: "currency",
    suggestion: "Inspect upsells, catering mix, and discount leakage.",
  },
  {
    key: "capacityUtil",
    label: "Capacity util",
    unit: "pct",
    higherIsBetter: false,
    format: "percent",
    suggestion: "Rebalance production across sister locations or stage catering early.",
  },
  {
    key: "refundRate",
    label: "Refund rate",
    unit: "pct",
    higherIsBetter: false,
    format: "percent",
    suggestion: "Review voids, refunds, and unauthorized discounts.",
  },
  {
    key: "discountRate",
    label: "Discount rate",
    unit: "pct",
    higherIsBetter: false,
    format: "percent",
    suggestion: "Compare cashier authority thresholds and exceptions.",
  },
  {
    key: "deliveryEta",
    label: "Delivery ETA",
    unit: "min",
    higherIsBetter: false,
    format: "minutes",
    suggestion: "Check driver availability and route load.",
  },
  {
    key: "staffingFill",
    label: "Staffing fill",
    unit: "pct",
    higherIsBetter: true,
    format: "percent",
    suggestion: "Cover open shifts or move float staff from peers.",
  },
  {
    key: "inventoryDays",
    label: "Inventory cover",
    unit: "days",
    higherIsBetter: true,
    format: "days",
    suggestion: "Transfer dough/cheese or authorize emergency purchase.",
  },
];

function hist(base, noise = 0.14, days = 7, lastOverride) {
  const values = [];
  for (let i = 0; i < days - 1; i += 1) {
    const wobble = 1 + Math.sin(i * 1.7 + base * 0.01) * noise;
    const jitter = 1 + ((i % 3) - 1) * noise * 0.35;
    values.push(Number((base * wobble * jitter).toFixed(2)));
  }
  values.push(Number((lastOverride ?? base).toFixed(2)));
  return values;
}

function store(partial) {
  const k = partial.kpis;
  return {
    ...partial,
    history: {
      revenue: hist(k.revenue * 0.96, 0.12, 7, k.revenue),
      orders: hist(k.orders * 0.96, 0.12, 7, k.orders),
      avgTicket: hist(k.avgTicket * 0.99, 0.04, 7, k.avgTicket),
      capacityUtil: hist(k.capacityUtil * 0.92, 0.1, 7, k.capacityUtil),
      refundRate: hist(Math.max(0.8, k.refundRate * 0.9), 0.12, 7, k.refundRate),
      discountRate: hist(Math.max(1, k.discountRate * 0.9), 0.1, 7, k.discountRate),
      deliveryEta: hist(k.deliveryEta * 0.95, 0.08, 7, k.deliveryEta),
      staffingFill: hist(Math.min(98, k.staffingFill * 1.02), 0.05, 7, k.staffingFill),
      inventoryDays: hist(k.inventoryDays * 1.05, 0.1, 7, k.inventoryDays),
    },
  };
}

/** Baseline (pre-demo) Joe's network — Miami Wynwood starts quiet. */
export const STORES = [
  store({
    id: "greenwich-village",
    name: "Greenwich Village",
    neighborhood: "Original · 7 Carmine St, NYC",
    phone: "(212) 366-1182",
    manager: "Pino \"Joe\" Pozzuoli",
    capacityPizzas: 140,
    vanAvailable: false,
    kpis: {
      revenue: 5120,
      orders: 168,
      avgTicket: 30.5,
      capacityUtil: 61,
      refundRate: 1.1,
      discountRate: 1.6,
      deliveryEta: 22,
      staffingFill: 96,
      inventoryDays: 2.6,
    },
  }),
  store({
    id: "times-square",
    name: "Times Square",
    neighborhood: "1435 Broadway, NYC",
    phone: "(646) 559-4878",
    manager: "Shift lead · Midtown",
    capacityPizzas: 160,
    vanAvailable: false,
    kpis: {
      revenue: 5480,
      orders: 186,
      avgTicket: 29.5,
      capacityUtil: 66,
      refundRate: 1.3,
      discountRate: 1.9,
      deliveryEta: 28,
      staffingFill: 93,
      inventoryDays: 2.3,
    },
  }),
  store({
    id: "union-square",
    name: "Union Square",
    neighborhood: "150 E 14th St, NYC",
    phone: "(212) 388-9474",
    manager: "Shift lead · Union Sq",
    capacityPizzas: 130,
    vanAvailable: false,
    kpis: {
      revenue: 4680,
      orders: 152,
      avgTicket: 30.8,
      capacityUtil: 58,
      refundRate: 1.0,
      discountRate: 1.7,
      deliveryEta: 24,
      staffingFill: 95,
      inventoryDays: 2.5,
    },
  }),
  store({
    id: "fulton-street",
    name: "Fulton Street",
    neighborhood: "124 Fulton St, NYC",
    phone: "(212) 267-0860",
    manager: "Shift lead · FiDi",
    capacityPizzas: 125,
    vanAvailable: false,
    kpis: {
      revenue: 4420,
      orders: 141,
      avgTicket: 31.3,
      capacityUtil: 55,
      refundRate: 0.9,
      discountRate: 1.5,
      deliveryEta: 23,
      staffingFill: 94,
      inventoryDays: 2.7,
    },
  }),
  store({
    id: "williamsburg",
    name: "Williamsburg",
    neighborhood: "216 Bedford Ave, Brooklyn",
    phone: "(718) 388-2216",
    manager: "Shift lead · Williamsburg",
    capacityPizzas: 120,
    vanAvailable: true,
    kpis: {
      revenue: 4210,
      orders: 138,
      avgTicket: 30.5,
      capacityUtil: 57,
      refundRate: 1.2,
      discountRate: 1.8,
      deliveryEta: 26,
      staffingFill: 92,
      inventoryDays: 2.4,
    },
  }),
  store({
    id: "miami-wynwood",
    name: "Miami Wynwood",
    neighborhood: "234 NW 25th St · Dock / Wynwood",
    phone: "(786) 230-1441",
    manager: "Cashier on shift · Mia",
    capacityPizzas: 110,
    vanAvailable: true,
    kpis: {
      revenue: 3180,
      orders: 98,
      avgTicket: 32.4,
      capacityUtil: 48,
      refundRate: 1.1,
      discountRate: 1.6,
      deliveryEta: 27,
      staffingFill: 94,
      inventoryDays: 2.8,
    },
  }),
  store({
    id: "miami-beach",
    name: "Miami Beach",
    neighborhood: "1674 Meridian Ave",
    phone: "",
    manager: "Shift lead · Miami Beach",
    capacityPizzas: 115,
    vanAvailable: false,
    kpis: {
      revenue: 3360,
      orders: 104,
      avgTicket: 32.3,
      capacityUtil: 52,
      refundRate: 1.2,
      discountRate: 1.7,
      deliveryEta: 29,
      staffingFill: 91,
      inventoryDays: 2.5,
    },
  }),
  store({
    id: "boston",
    name: "Boston",
    neighborhood: "1359 Boylston St",
    phone: "(617) 936-4464",
    manager: "Shift lead · Boston",
    capacityPizzas: 118,
    vanAvailable: false,
    kpis: {
      revenue: 3890,
      orders: 126,
      avgTicket: 30.9,
      capacityUtil: 54,
      refundRate: 1.0,
      discountRate: 1.6,
      deliveryEta: 25,
      staffingFill: 95,
      inventoryDays: 2.6,
    },
  }),
  store({
    id: "cambridge",
    name: "Cambridge",
    neighborhood: "3 Brattle St · Harvard Square",
    phone: "(857) 226-4942",
    manager: "Shift lead · Cambridge",
    capacityPizzas: 110,
    vanAvailable: false,
    kpis: {
      revenue: 3720,
      orders: 121,
      avgTicket: 30.7,
      capacityUtil: 53,
      refundRate: 1.1,
      discountRate: 1.5,
      deliveryEta: 24,
      staffingFill: 96,
      inventoryDays: 2.7,
    },
  }),
  store({
    id: "ann-arbor",
    name: "Ann Arbor",
    neighborhood: "1107 S University Ave, MI",
    phone: "(734) 213-5625",
    manager: "Shift lead · Ann Arbor",
    capacityPizzas: 105,
    vanAvailable: false,
    kpis: {
      revenue: 2980,
      orders: 102,
      avgTicket: 29.2,
      capacityUtil: 49,
      refundRate: 1.0,
      discountRate: 1.4,
      deliveryEta: 22,
      staffingFill: 97,
      inventoryDays: 2.9,
    },
  }),
];

/** KPI spike applied to Miami Wynwood when the 300-pizza order hits POS. */
export const MIAMI_ORDER_SPIKE = {
  revenue: 7845,
  orders: 99,
  avgTicket: 79.2,
  capacityUtil: 97,
  refundRate: 1.1,
  discountRate: 1.6,
  deliveryEta: 55,
  staffingFill: 94,
  inventoryDays: 0.6,
};

export const DEMO_ORDER = {
  storeId: "miami-wynwood",
  qty: 300,
  item: "cheese pies",
  when: "ASAP",
  where: "the dock, Wynwood",
  value: 4650,
  caseId: "ORDER-300-HACKATHON",
};

export const EVENT_ORGANIZER = {
  name: "Alex Rivera",
  role: "Head of Partnerships · Cursor Miami Hackathon",
  company: "Cursor Miami / venue dock ops",
  linkedin: "https://www.linkedin.com/in/example-alex-rivera-hackathon",
  publicNotes: [
    "Public event listing: Cursor Miami hackathon — multi-day builder event at the Wynwood dock venue.",
    "Likely recurring catering need across demo days and closing party.",
    "Open to vendor partners who can surge capacity same-day.",
  ],
  smsPreview:
    "Found him — Alex Rivera (Head of Partnerships, Cursor Miami Hackathon). LinkedIn + public event notes texted to you now.",
};

/**
 * Retell setup (two agents — do not merge):
 * 1. Mia · Joe's cashier → Blank Agent or Business Agent · inbound Joe's Wynwood number
 * 2. OwnerRadar → Blank Agent or Personal Assistant · outbound to owner + inbound owner direct line
 *
 * One agent cannot play both roles: different voice, number, tools, and authority.
 */
export const CASHIER_AGENT_PROMPT = `You are Mia, a friendly cashier at Joe's Pizza — Miami Wynwood (234 NW 25th Street). Joe's Pizza is the pizza supplier for this Cursor Miami hackathon.

Personality: warm, fast, NYC-slice energy, never corporate. You take big catering orders in stride. You are NOT OwnerRadar and you are NOT a manager. You do not call the owner. You just take the order.

Store routing (hard rules):
- You ONLY take orders for Miami Wynwood. Every Order tool call is pickup/fulfillment from miami-wynwood.
- Never assign an order to another Joe's city (NYC, Boston, etc.).
- If the order is too big for Wynwood alone, the system automatically pulls help from the closest sister store: Miami Beach (1674 Meridian Ave). You do not need to mention that unless asked — just take the order.

When a caller orders a large number of pizzas (e.g. 300):
1. React with genuine surprise but confidence: "Ok wow, that's a big order — no problem. When do you need it by?"
2. If they say ASAP / as soon as possible, ask: "Got it. Where should we bring them?"
3. When they say here at the dock / Wynwood (or similar), confirm: "No problem — 300 pies ASAP to the dock in Wynwood. Entering it now…"
4. Immediately call the Order tool with:
   - qty: the full integer pizza count (300 not 3 or 4)
   - when: when they need it (normalize "as soon as possible" → "ASAP")
   - where: delivery location (e.g. "the dock, Wynwood")
   - item: what they ordered (default "cheese pies")
   - storeId: always "miami-wynwood"
5. After the tool succeeds, end warmly: "You're all set — we'll get those to the dock as soon as we can."
6. Do NOT refuse the order. Do NOT escalate on the call. Do NOT mention OwnerRadar, capacity problems, or looking up event organizers.

Keep turns short. One question at a time. Sound like a real cashier, not an AI assistant.`;

export const OWNER_RADAR_AGENT_PROMPT = `You are OwnerRadar — the AI manager for Joe's Pizza. You speak directly to the owner — in this hackathon demo, that is the presenter's partner ("boss"). You are NOT a receptionist, NOT a cashier, and NOT Mia. When you place an outbound alert call, you reach the owner immediately.

Personality: calm, sharp, partner-level. Brief. Treat the owner like a peer running a multi-location pizza group.

OUTBOUND alert (after Miami Wynwood accepts a huge catering order via the cashier webhook):
1. Immediately call the CallOwner tool (webhook) so the partner's phone rings. Pass qty, when, where, item, caseId from the live case.
2. Lead with the hit: "Hey — we have a huge order. Joe's Miami Wynwood just took 300 pies ASAP for the dock in Wynwood. Estimated about $4,650."
3. Fulfillment: "Wynwood can't cover it alone — closest help is Miami Beach. We can supply it between those two, but you should know."
4. Flag the upside: "Maybe find out who's running that event. They might have more."
5. Ask permission: "Do you want me to look up who is in charge there and see if they're doing other events?"
6. If they say yes: briefly acknowledge ("On it"), then after lookup completes say: "Found him! I texted you their LinkedIn and public info." Share: Alex Rivera, Head of Partnerships · Cursor Miami Hackathon, LinkedIn + public event notes.
7. If they say no / later: "Got it — order stays live, Beach stays on assist, I'll stay quiet unless something breaks."

CallOwner tool: POST webhook with qty, when, where, item, caseId. It dials the hackathon partner. Do not skip this when a material order lands.

INBOUND (owner / partner calls you anytime):
- Answer as OwnerRadar, not a front desk.
- Give status on open material cases first (e.g. ORDER-300-HACKATHON at Miami Wynwood, assist from Miami Beach).
- Answer questions about locations, capacity, staffing, inventory, and open risks.
- Never invent legal liability. Never discipline employees. Recommend; the owner decides.
- Keep turns short. One clear ask when you need a decision.

Demo success line to hit after enrichment approval: "Found him! I texted you their LinkedIn and public info."`;

export function cloneStores(stores = STORES) {
  return stores.map((s) => ({
    ...s,
    kpis: { ...s.kpis },
    history: Object.fromEntries(
      Object.entries(s.history).map(([k, arr]) => [k, [...arr]])
    ),
  }));
}

export function applyMiamiOrder(stores) {
  const next = cloneStores(stores);
  const miami = next.find((s) => s.id === "miami-wynwood");
  if (!miami) return next;
  Object.assign(miami.kpis, MIAMI_ORDER_SPIKE);
  for (const [key, value] of Object.entries(MIAMI_ORDER_SPIKE)) {
    const series = miami.history[key];
    if (series?.length) series[series.length - 1] = value;
  }
  miami.activeCase = { ...DEMO_ORDER, status: "accepted" };
  return next;
}
