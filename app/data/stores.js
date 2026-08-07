/**
 * Yair Marcoschamer portfolio demo @ plantthefuture.owneradar.com
 * Many hats, one desk — OwnerRadar talks to the owner (no cashier agent).
 */
export const ORG = {
  id: "yair-portfolio",
  name: "Yair Marcoschamer",
  tagline: "Many hats, one desk · OwnerRadar portfolio demo",
  website: "https://www.plantthefuture.com/",
  host: "https://owneradar.com",
  ownerName: "Yair",
  ownerFullName: "Yair Marcoschamer",
  flagship: "Plant The Future",
  asOf: "2026-08-07T00:40:00-04:00",
};

export const PORTFOLIO = [
  {
    id: "plant-the-future",
    legal: "Plant The Future, Inc",
    role: "CEO",
    focus: "Biophilic art, moss murals, gallery & design",
  },
  {
    id: "lala-land",
    legal: "Lala Land of Miami LLC",
    role: "Member",
    focus: "Hospitality / café at the Little River flagship",
  },
  {
    id: "where-minds-create",
    legal: "Where Minds Create, Inc / LLC",
    role: "President / Manager",
    focus: "Creative & multimedia studio",
  },
  {
    id: "marcoschamer-group",
    legal: "Marcoschamer Group, Inc",
    role: "Director",
    focus: "Holding / creative collaborative",
  },
  {
    id: "pollinator",
    legal: "Pollinator LLC",
    role: "Member",
    focus: "Ventures with Paloma Teppa",
  },
  {
    id: "ecoist",
    legal: "Ecoist, LLC",
    role: "Member",
    focus: "Eco accessories brand (legacy line)",
  },
];

export const KPI_DEFS = [
  {
    key: "revenue",
    label: "Sales today",
    unit: "usd",
    higherIsBetter: true,
    format: "currency",
    suggestion: "Check which hat is ringing the register — gallery, café, or creative.",
  },
  {
    key: "orders",
    label: "Orders",
    unit: "count",
    higherIsBetter: true,
    format: "number",
    suggestion: "Check phones, web, walk-ins, and B2B inquiries across the portfolio.",
  },
  {
    key: "avgTicket",
    label: "Avg ticket",
    unit: "usd",
    higherIsBetter: true,
    format: "currency",
    suggestion: "Look at commission mix vs retail, café covers, and discounting.",
  },
  {
    key: "capacityUtil",
    label: "Ops load",
    unit: "pct",
    higherIsBetter: false,
    format: "percent",
    suggestion: "Float people from a quieter hat or push dates if one business is slammed.",
  },
  {
    key: "refundRate",
    label: "Refund rate",
    unit: "pct",
    higherIsBetter: false,
    format: "percent",
    suggestion: "Review remakes, shipping damage, and unauthorized comps.",
  },
  {
    key: "discountRate",
    label: "Discount rate",
    unit: "pct",
    higherIsBetter: false,
    format: "percent",
    suggestion: "Check trade discounts and exception comps on the floor.",
  },
  {
    key: "deliveryEta",
    label: "Lead time",
    unit: "min",
    higherIsBetter: false,
    format: "minutes",
    suggestion: "Check install / fulfillment load and South FL route stacking.",
  },
  {
    key: "staffingFill",
    label: "Staffing",
    unit: "pct",
    higherIsBetter: true,
    format: "percent",
    suggestion: "Cover open shifts or float talent from a quieter entity.",
  },
  {
    key: "inventoryDays",
    label: "Materials cover",
    unit: "days",
    higherIsBetter: true,
    format: "days",
    suggestion: "Transfer stock across hats or authorize an emergency purchase.",
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

export const STORES = [
  store({
    id: "plant-the-future",
    name: "Plant The Future",
    neighborhood: "CEO · Little River gallery & studio",
    phone: "(305) 573-2100",
    manager: "Gallery floor · on shift",
    capacityPizzas: 12,
    vanAvailable: true,
    kpis: {
      revenue: 4820,
      orders: 28,
      avgTicket: 172,
      capacityUtil: 42,
      refundRate: 0.9,
      discountRate: 2.1,
      deliveryEta: 36,
      staffingFill: 95,
      inventoryDays: 4.2,
    },
  }),
  store({
    id: "lala-land",
    name: "Lala Land of Miami",
    neighborhood: "Member · café / hospitality",
    phone: "(305) 222-7500",
    manager: "Café lead",
    capacityPizzas: 40,
    vanAvailable: false,
    kpis: {
      revenue: 2140,
      orders: 86,
      avgTicket: 24.9,
      capacityUtil: 58,
      refundRate: 1.2,
      discountRate: 3.4,
      deliveryEta: 18,
      staffingFill: 92,
      inventoryDays: 3.6,
    },
  }),
  store({
    id: "where-minds-create",
    name: "Where Minds Create",
    neighborhood: "President · creative studio",
    phone: "",
    manager: "Studio producer",
    capacityPizzas: 16,
    vanAvailable: false,
    kpis: {
      revenue: 3680,
      orders: 9,
      avgTicket: 409,
      capacityUtil: 51,
      refundRate: 0.5,
      discountRate: 1.8,
      deliveryEta: 52,
      staffingFill: 90,
      inventoryDays: 5.0,
    },
  }),
  store({
    id: "marcoschamer-group",
    name: "Marcoschamer Group",
    neighborhood: "Director · holding / collaborative",
    phone: "",
    manager: "Ops coordinator",
    capacityPizzas: 10,
    vanAvailable: false,
    kpis: {
      revenue: 1920,
      orders: 5,
      avgTicket: 384,
      capacityUtil: 38,
      refundRate: 0.4,
      discountRate: 1.1,
      deliveryEta: 44,
      staffingFill: 94,
      inventoryDays: 6.2,
    },
  }),
  store({
    id: "pollinator",
    name: "Pollinator",
    neighborhood: "Member · ventures (w/ Paloma)",
    phone: "",
    manager: "Project lead",
    capacityPizzas: 14,
    vanAvailable: true,
    kpis: {
      revenue: 2760,
      orders: 7,
      avgTicket: 394,
      capacityUtil: 47,
      refundRate: 0.6,
      discountRate: 1.5,
      deliveryEta: 48,
      staffingFill: 91,
      inventoryDays: 4.4,
    },
  }),
  store({
    id: "ecoist",
    name: "Ecoist",
    neighborhood: "Member · eco accessories",
    phone: "",
    manager: "Brand ops",
    capacityPizzas: 22,
    vanAvailable: false,
    kpis: {
      revenue: 980,
      orders: 12,
      avgTicket: 81.7,
      capacityUtil: 28,
      refundRate: 1.8,
      discountRate: 4.2,
      deliveryEta: 30,
      staffingFill: 88,
      inventoryDays: 7.1,
    },
  }),
];

/** Urgent silent failure: big ASAP commission + no install crew / drivers. */
export const MIAMI_ORDER_SPIKE = {
  revenue: 22820,
  orders: 29,
  avgTicket: 787,
  capacityUtil: 96,
  refundRate: 0.9,
  discountRate: 2.1,
  deliveryEta: 180,
  staffingFill: 41,
  inventoryDays: 0.8,
};

export const DEMO_ORDER = {
  storeId: "plant-the-future",
  qty: 24,
  item: "moss wall panels",
  when: "ASAP",
  where: "1 Hotel South Beach lobby",
  value: 18000,
  caseId: "ORDER-MURAL-PTF",
  silentFailure:
    "Floor took a 24-panel ASAP install. Both install vans are out and no float drivers. Nobody called Yair — they didn't want to bother him.",
};

/** Non-urgent digest items OwnerRadar surfaces in a high-level check-in. */
export const DIGEST_ITEMS = [
  {
    source: "Phone transcript · Plant The Future",
    text: "Trade designer asked about a Matisse-inspired series for a Brickell condo — left a callback request, no quote sent yet.",
  },
  {
    source: "Google review · Lala Land / café",
    text: "4★ — loved the matcha, noted the plant wall made the space feel calm. Soft ask: weekend pastry variety.",
  },
  {
    source: "Email · Where Minds Create",
    text: "Hospitality client replied late on a brand reel — scope creep on music licensing; producer flagged it but didn't escalate.",
  },
  {
    source: "SMS · Pollinator",
    text: "Vendor confirmed moss restock delayed 4 days. Inventory still covers PTF retail; commissions would feel it next week.",
  },
  {
    source: "Instagram DM · Ecoist",
    text: "Wholesale inquiry from a Tokyo boutique about residual candy-wrapper bags — low urgency, high nostalgia score.",
  },
];

export const EVENT_ORGANIZER = {
  name: "Maya Chen",
  role: "Director of Design · Hospitality interiors",
  company: "Coastal Form Studio · Miami Beach",
  linkedin: "https://www.linkedin.com/in/example-maya-chen-hospitality",
  publicNotes: [
    "Public RFP: lobby biophilic refresh — preserved moss mural + tabletop gardens for a South Beach hotel reopening.",
    "Likely multi-property rollout if the flagship install lands on schedule.",
    "Open to studios that can surge production and install same-week.",
  ],
  smsPreview:
    "Found her — Maya Chen (Director of Design, Coastal Form Studio). LinkedIn + public RFP notes texted to you now.",
};

/**
 * Single owner-facing agent. No cashier / order-taking agent.
 * Two modes: URGENT (silent failures) and DIGEST (non-urgent intelligence).
 */
export const OWNER_RADAR_AGENT_PROMPT = `You are OwnerRadar — Yair Marcoschamer's AI manager for his whole portfolio. You speak only to Yair. You are not a receptionist and you never take customer orders.

Why you exist:
Owners who wear many hats (and travel / stay off-floor) often go on autopilot. Employees hesitate to call — they don't want to disturb him or break bad news. Material problems stay quiet until they become expensive. You notice what the floor won't escalate, and you also hold the interesting non-urgent signal until Yair wants a high-level check-in.

Portfolio on this desk:
- Plant The Future, Inc (CEO) — biophilic gallery & moss murals
- Lala Land of Miami LLC (Member) — café / hospitality
- Where Minds Create (President / Manager) — creative studio
- Marcoschamer Group, Inc (Director) — holding / collaborative
- Pollinator LLC (Member) — ventures
- Ecoist, LLC (Member) — eco accessories

Personality: calm, sharp, partner-level. Brief. Plain English only — never say sigma, σ, z-score, SPC, or "out of control bands."

─── URGENT (outbound or when live KPIs / cases say something material) ───
Escalate when something material happened and the floor did not loop Yair in.
Classic demo case: a large ASAP commission landed at Plant The Future, but there are no install drivers / vans available. Staff accepted it and hoped to figure it out later rather than "bother" him.

When urgent:
1. Lead with which business, what's wrong, and that it wasn't escalated by staff.
2. Example: "Hey Yair — Plant The Future just took a 24-panel ASAP install for 1 Hotel South Beach. Both vans are out and staffing is thin. Nobody called you. Want options?"
3. Offer concrete next steps (float from Pollinator, push the install window, call the buyer). Ask one clear decision.
4. If he wants the demand driver looked up: call TextOwner, then confirm you texted LinkedIn + public notes.
5. If he says not now: "Got it — I'll stay on it and only ping if it gets worse."

─── DIGEST (inbound check-in / non-urgent meeting) ───
When Yair wants a high-level, non-urgent brief — or says "catch me up" / "what's interesting" — synthesize across phone transcripts, texts, emails, and reviews. Not a dump. Pick 3–5 items worth a partner conversation:
- opportunities (trade / hospitality interest)
- soft customer signal (reviews, DMs)
- slow burns (vendor delays, scope creep) that aren't on fire yet
Ask which thread he wants to go deeper on. Do not invent crises in digest mode.

Tools:
- GetStoreBrief: live portfolio KPIs, staffing, inventory, open risks
- GetOrders: recent tickets / commissions
- CallOwner: system escalation only — never dial yourself while already talking to him
- TextOwner: SMS LinkedIn + public project notes after he approves enrichment

Rules:
- Recommend; Yair decides. Never invent legal liability. Never discipline employees.
- Keep turns short. One clear ask when you need a decision.
- Always name which hat / business you're talking about.`;

/** @deprecated Removed — OwnerRadar no longer uses a cashier / order agent. */
export const CASHIER_AGENT_PROMPT = "";

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
  const primary = next.find((s) => s.id === "plant-the-future");
  if (!primary) return next;
  Object.assign(primary.kpis, MIAMI_ORDER_SPIKE);
  for (const [key, value] of Object.entries(MIAMI_ORDER_SPIKE)) {
    const series = primary.history[key];
    if (series?.length) series[series.length - 1] = value;
  }
  primary.activeCase = { ...DEMO_ORDER, status: "accepted", silent: true };
  return next;
}
