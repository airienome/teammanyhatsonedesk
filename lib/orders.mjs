import { getSql } from "./snapshot.mjs";
import { latestBalance, recomputeStoreKpi } from "./kpi.mjs";
import { anchorOrderNow } from "./chain.mjs";

/** Orders at or above this size are material for OwnerRadar escalation. */
export const MATERIAL_PIZZA_THRESHOLD = 75;

/** Hackathon voice orders always land on Wynwood; Beach is nearest overflow. */
export const PRIMARY_STORE_ID = "miami-wynwood";
export const NEAREST_HELP_STORE_ID = "miami-beach";

const DEFAULT_UNIT_CENTS = 1550; // ~$15.50 / pie

async function drawInventory(sql, storeId, pizzaCount, caseId, reasonSuffix = "") {
  const reason = reasonSuffix ? `${caseId}:${reasonSuffix}` : caseId;
  for (const [sku, perPie] of [
    ["dough", 1.05],
    ["water", 0.22],
    ["cheese", 0.55],
    ["sauce", 0.12],
    ["boxes", 1],
  ]) {
    const delta = -(pizzaCount * perPie);
    const bal = await latestBalance(sql, storeId, sku);
    await sql`
      INSERT INTO inventory_ledger (store_id, sku, delta, balance, reason)
      VALUES (
        ${storeId},
        ${sku},
        ${delta},
        ${Number((bal + delta).toFixed(3))},
        ${reason}
      )
    `;
  }

  await sql`
    INSERT INTO utility_readings (
      store_id, water_gallons, gas_therms, electric_kwh, dough_lbs_produced
    ) VALUES (
      ${storeId},
      ${pizzaCount * 0.22},
      ${Math.max(0.5, pizzaCount * 0.015)},
      ${Math.max(1, pizzaCount * 0.09)},
      ${pizzaCount * 1.05}
    )
  `;
}

/**
 * Build a fulfillment split: Wynwood takes up to local capacity;
 * Miami Beach (closest) covers the rest when needed.
 */
export function planFulfillment(qty, primaryCap, helpCap) {
  const total = Math.max(1, Number(qty) || 1);
  const primaryShare = Math.min(total, Math.max(0, Number(primaryCap) || 0));
  const remaining = total - primaryShare;
  const helpShare = Math.min(remaining, Math.max(0, Number(helpCap) || 0));
  const uncovered = total - primaryShare - helpShare;

  return {
    primaryStoreId: PRIMARY_STORE_ID,
    helpStoreId: NEAREST_HELP_STORE_ID,
    primaryShare,
    helpShare,
    uncovered,
    needsHelp: helpShare > 0,
  };
}

/**
 * Insert a catering/phone order. Always attributed to Miami Wynwood.
 * If qty exceeds Wynwood capacity, Miami Beach is enlisted to help fulfill.
 */
export async function insertCateringOrder({
  storeId = PRIMARY_STORE_ID,
  qty = 300,
  when = "ASAP",
  where = "the dock, Wynwood",
  item = "cheese pies",
  channel = "phone",
  caseId = "ORDER-300-HACKATHON",
  callerLabel = "hackathon_judge",
  unitCents = DEFAULT_UNIT_CENTS,
  note = null,
} = {}) {
  const sql = getSql();

  // Voice / webhook orders always pick up at Wynwood — ignore other storeIds
  const primaryId = PRIMARY_STORE_ID;
  const helpId = NEAREST_HELP_STORE_ID;

  const primaryRows = await sql`SELECT * FROM stores WHERE id = ${primaryId}`;
  const helpRows = await sql`SELECT * FROM stores WHERE id = ${helpId}`;
  const primary = primaryRows[0];
  const help = helpRows[0];
  if (!primary) throw new Error(`Unknown store: ${primaryId}`);
  if (!help) throw new Error(`Unknown store: ${helpId}`);

  const pizzaCount = Math.max(1, Number(qty) || 1);
  const pizzaType = String(item || "cheese pies");
  const ticketCents = Math.round(pizzaCount * unitCents);
  const bodyNote =
    note || `${pizzaCount} ${pizzaType} · ${when} · ${where}`;

  const plan = planFulfillment(
    pizzaCount,
    primary.capacity_pizzas,
    help.capacity_pizzas
  );

  const orderRows = await sql`
    INSERT INTO pos_orders (
      store_id, channel, items_json, pizza_count, ticket_cents, status
    ) VALUES (
      ${primaryId},
      ${channel},
      ${JSON.stringify([
        {
          item: pizzaType,
          qty: pizzaCount,
          when,
          where,
          note: bodyNote,
          caseId,
          fulfillment: plan,
          pickupStore: primaryId,
          helpStore: plan.needsHelp ? helpId : null,
        },
      ])},
      ${pizzaCount},
      ${ticketCents},
      'paid'
    )
    RETURNING *
  `;

  // Wynwood always takes the order on POS; inventory split by fulfillment plan
  await drawInventory(
    sql,
    primaryId,
    plan.primaryShare || pizzaCount,
    caseId,
    plan.needsHelp ? "wynwood_share" : "full"
  );

  if (plan.needsHelp && plan.helpShare > 0) {
    await drawInventory(sql, helpId, plan.helpShare, caseId, "beach_help");

    // Mirror a production transfer event on Beach (not a separate customer order)
    await sql`
      INSERT INTO store_events (
        store_id, event_type, severity, title, body, payload
      ) VALUES (
        ${helpId},
        'fulfillment_assist',
        'watch',
        'Helping Wynwood fulfill',
        ${`Miami Beach producing ${plan.helpShare} pies to help Wynwood cover ${pizzaCount}-pie order to ${where}.`},
        ${JSON.stringify({ caseId, plan, requestedBy: primaryId })}
      )
    `;
  }

  await sql`
    INSERT INTO phone_calls (
      store_id, direction, duration_sec, outcome, caller_label
    ) VALUES (
      ${primaryId}, 'inbound', 96, 'order_taken', ${callerLabel}
    )
  `;

  const isMaterial = pizzaCount >= MATERIAL_PIZZA_THRESHOLD;
  const fulfillCopy = plan.needsHelp
    ? ` Fulfillment: Wynwood ${plan.primaryShare} + Miami Beach ${plan.helpShare}${plan.uncovered ? ` (${plan.uncovered} still uncovered)` : ""}.`
    : " Fulfillment: Wynwood solo.";

  await sql`
    INSERT INTO store_events (
      store_id, event_type, severity, title, body, payload
    ) VALUES (
      ${primaryId},
      ${isMaterial ? "material_order" : "order"},
      ${isMaterial ? "alert" : "info"},
      ${isMaterial ? `${pizzaCount}-pizza order accepted` : "Order accepted"},
      ${`Cashier accepted ${bodyNote}.${fulfillCopy} Written to POS + inventory.`},
      ${JSON.stringify({
        caseId,
        qty: pizzaCount,
        item: pizzaType,
        when,
        where,
        ticketCents,
        channel,
        fulfillment: plan,
        pickupStore: primaryId,
        helpStore: plan.needsHelp ? helpId : null,
      })}
    )
  `;

  const kpi = await recomputeStoreKpi(sql, primary, {
    deliveryEta: isMaterial ? 55 : undefined,
  });
  const helpKpi = plan.needsHelp
    ? await recomputeStoreKpi(sql, help)
    : null;

  let chain = null;
  try {
    chain = await anchorOrderNow(orderRows[0]);
  } catch (err) {
    console.warn("[chain] catering anchor failed:", err?.message || err);
  }

  return {
    order: orderRows[0],
    caseId,
    storeId: primaryId,
    helpStoreId: plan.needsHelp ? helpId : null,
    fulfillment: plan,
    qty: pizzaCount,
    when,
    where,
    ticketCents,
    isMaterial,
    kpi,
    helpKpi,
    chain,
  };
}
