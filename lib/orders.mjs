import { getSql, fetchNetworkSnapshot } from "./snapshot.mjs";
import { latestBalance, recomputeStoreKpi } from "./kpi.mjs";
import { anchorOrderNow } from "./chain.mjs";
import { ALERT_Z, analyzeStores, summarizeBreach } from "./spc.mjs";
import { textOwnerForOutOfControl } from "./owner-alert.mjs";
import {
  dialOwnerForOutOfControl,
  placeOwnerCall,
} from "./call-owner.mjs";
import {
  buildOwnerAlertSms,
  ownerPhone,
  sendSms,
  twilioConfigured,
} from "./sms.mjs";

/** Hackathon voice orders always land on Wynwood; Beach is nearest overflow. */
export const PRIMARY_STORE_ID = "miami-wynwood";
export const NEAREST_HELP_STORE_ID = "miami-beach";

/** Owner is always dialed when pizza count exceeds this (exclusive). */
export const OWNER_CALL_QTY_THRESHOLD = 100;

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
 * Owner escalation when:
 *   - SPC ≥2σ out of control, OR
 *   - pizza count > OWNER_CALL_QTY_THRESHOLD (100)
 */
export async function insertCateringOrder({
  storeId = PRIMARY_STORE_ID,
  qty,
  when = "ASAP",
  where = "the dock, Wynwood",
  item = "cheese pies",
  channel = "phone",
  caseId = null,
  callerLabel = "voice_agent",
  unitCents = DEFAULT_UNIT_CENTS,
  note = null,
  dialOwner = true,
} = {}) {
  const sql = getSql();

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
  const resolvedCaseId =
    caseId || `ORDER-${primaryId}-${Date.now().toString(36).toUpperCase()}`;
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
          caseId: resolvedCaseId,
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

  await drawInventory(
    sql,
    primaryId,
    plan.primaryShare || pizzaCount,
    resolvedCaseId,
    plan.needsHelp ? "wynwood_share" : "full"
  );

  if (plan.needsHelp && plan.helpShare > 0) {
    await drawInventory(sql, helpId, plan.helpShare, resolvedCaseId, "beach_help");

    await sql`
      INSERT INTO store_events (
        store_id, event_type, severity, title, body, payload
      ) VALUES (
        ${helpId},
        'fulfillment_assist',
        'watch',
        'Helping Wynwood fulfill',
        ${`Miami Beach producing ${plan.helpShare} pies to help Wynwood cover ${pizzaCount}-pie order to ${where}.`},
        ${JSON.stringify({ caseId: resolvedCaseId, plan, requestedBy: primaryId })}
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

  const kpi = await recomputeStoreKpi(sql, primary, {
    deliveryEta: plan.needsHelp ? 55 : undefined,
  });
  const helpKpi = plan.needsHelp
    ? await recomputeStoreKpi(sql, help)
    : null;

  const snapshot = await fetchNetworkSnapshot(sql);
  const spc = analyzeStores(snapshot.stores || []);
  const primaryAnalysis = spc.storeAnalyses.find((a) => a.store.id === primaryId);
  const spcOutOfControl = Boolean(primaryAnalysis?.outOfControl);
  const largeCatering = pizzaCount > OWNER_CALL_QTY_THRESHOLD;
  const outOfControl = spcOutOfControl || largeCatering;
  const spcBreach = primaryAnalysis ? summarizeBreach(primaryAnalysis) : null;
  const breachSummary = largeCatering
    ? spcOutOfControl
      ? `${pizzaCount}-pie order (over ${OWNER_CALL_QTY_THRESHOLD}) · ${spcBreach}`
      : `${pizzaCount}-pie catering order (over ${OWNER_CALL_QTY_THRESHOLD})`
    : spcBreach;

  const fulfillCopy = plan.needsHelp
    ? ` Fulfillment: Wynwood ${plan.primaryShare} + Miami Beach ${plan.helpShare}${plan.uncovered ? ` (${plan.uncovered} still uncovered)` : ""}.`
    : " Fulfillment: Wynwood solo.";

  const eventTitle = largeCatering
    ? `Large catering · ${pizzaCount} pies`
    : spcOutOfControl
      ? `Out of control ≥${ALERT_Z}σ · ${pizzaCount}-pie order`
      : "Order accepted";
  const eventBody = outOfControl
    ? `Cashier accepted ${bodyNote}.${fulfillCopy}${
        spcOutOfControl ? ` SPC: ${spcBreach}.` : ""
      }${largeCatering ? ` Auto-escalating: qty > ${OWNER_CALL_QTY_THRESHOLD}.` : ""}`
    : `Cashier accepted ${bodyNote}.${fulfillCopy} KPIs remain within ${ALERT_Z}σ.`;

  await sql`
    INSERT INTO store_events (
      store_id, event_type, severity, title, body, payload
    ) VALUES (
      ${primaryId},
      ${outOfControl ? "material_order" : "order"},
      ${outOfControl ? "alert" : "info"},
      ${eventTitle},
      ${eventBody},
      ${JSON.stringify({
        caseId: resolvedCaseId,
        qty: pizzaCount,
        item: pizzaType,
        when,
        where,
        ticketCents,
        channel,
        fulfillment: plan,
        pickupStore: primaryId,
        helpStore: plan.needsHelp ? helpId : null,
        largeCatering,
        ownerCallQtyThreshold: OWNER_CALL_QTY_THRESHOLD,
        spc: {
          outOfControl: spcOutOfControl,
          alertZ: ALERT_Z,
          worstAbs: primaryAnalysis?.worstAbs ?? 0,
          breachSummary: spcBreach,
          flags: primaryAnalysis?.alertFlags || [],
        },
      })}
    )
  `;

  // Stamp escalation result onto the POS row for the orders UI
  const stampedItems = [
    {
      item: pizzaType,
      qty: pizzaCount,
      when,
      where,
      note: bodyNote,
      caseId: resolvedCaseId,
      fulfillment: plan,
      pickupStore: primaryId,
      helpStore: plan.needsHelp ? helpId : null,
      outOfControl,
      largeCatering,
      breachSummary,
      alertZ: ALERT_Z,
    },
  ];
  await sql`
    UPDATE pos_orders
    SET items_json = ${JSON.stringify(stampedItems)}
    WHERE id = ${orderRows[0].id}
  `;
  orderRows[0].items_json = stampedItems;

  let ownerAlert = null;
  if (dialOwner && outOfControl) {
    const orderCtx = {
      qty: pizzaCount,
      when,
      where,
      item: pizzaType,
      ticketCents,
      caseId: resolvedCaseId,
    };
    const reason = largeCatering
      ? "large_catering_order"
      : "spc_out_of_control_after_order";

    // Prefer live OwnerRadar voice dial; SMS is a backup / parallel alert.
    // qty > 100 always forces a dial (bypasses SPC-only filter + cooldown gate).
    try {
      if (largeCatering) {
        const dial = await placeOwnerCall({
          storeId: primaryId,
          storeName: primary.name,
          caseId: resolvedCaseId,
          summary: breachSummary,
          flags: primaryAnalysis?.alertFlags || [],
          order: orderCtx,
          reason,
          force: true,
        });
        ownerAlert = { ok: true, dialed: [dial], skipped: [] };
      } else {
        ownerAlert = await dialOwnerForOutOfControl({
          snapshot,
          storeId: primaryId,
          caseId: resolvedCaseId,
          order: orderCtx,
          reason,
        });
      }
    } catch (err) {
      console.warn("[owner-call] auto dial failed:", err?.message || err);
      ownerAlert = { ok: false, error: err.message, code: err.code, dialed: [] };
    }
    try {
      let sms;
      if (largeCatering && twilioConfigured() && ownerPhone()) {
        const body = buildOwnerAlertSms({
          storeName: primary.name,
          breachSummary,
          order: orderCtx,
          caseId: resolvedCaseId,
          plan,
        });
        const msg = await sendSms({ to: ownerPhone(), body });
        await sql`
          INSERT INTO store_events (
            store_id, event_type, severity, title, body, payload
          ) VALUES (
            ${primaryId},
            'owner_sms',
            'alert',
            'OwnerRadar texted owner (large catering)',
            ${body},
            ${JSON.stringify({
              caseId: resolvedCaseId,
              sid: msg.sid,
              toMasked: msg.toMasked,
              reason,
              largeCatering: true,
              ownerCallQtyThreshold: OWNER_CALL_QTY_THRESHOLD,
              breachSummary,
              status: "awaiting_approval",
              order: orderCtx,
              plan,
              channel: "sms",
            })}
          )
        `;
        sms = {
          ok: true,
          texted: [
            {
              ok: true,
              storeId: primaryId,
              caseId: resolvedCaseId,
              sid: msg.sid,
              toMasked: msg.toMasked,
              body,
            },
          ],
          skipped: [],
        };
      } else if (spcOutOfControl) {
        sms = await textOwnerForOutOfControl({
          snapshot,
          storeId: primaryId,
          caseId: resolvedCaseId,
          plan,
          order: orderCtx,
          reason,
        });
      } else {
        sms = {
          ok: false,
          skipped: [{ reason: "sms_not_configured" }],
        };
      }
      ownerAlert = { ...ownerAlert, sms };
    } catch (err) {
      console.warn("[owner-sms] auto text failed:", err?.message || err);
      ownerAlert = {
        ...(ownerAlert || {}),
        sms: { ok: false, error: err.message, code: err.code },
      };
    }
  }

  let chain = null;
  try {
    chain = await anchorOrderNow(orderRows[0]);
  } catch (err) {
    console.warn("[chain] catering anchor failed:", err?.message || err);
  }

  return {
    order: orderRows[0],
    caseId: resolvedCaseId,
    storeId: primaryId,
    helpStoreId: plan.needsHelp ? helpId : null,
    fulfillment: plan,
    qty: pizzaCount,
    when,
    where,
    ticketCents,
    isMaterial: outOfControl,
    outOfControl,
    largeCatering,
    ownerCallQtyThreshold: OWNER_CALL_QTY_THRESHOLD,
    spcOutOfControl,
    alertZ: ALERT_Z,
    breachSummary,
    spcFlags: primaryAnalysis?.alertFlags || [],
    kpi,
    helpKpi,
    ownerAlert,
    ownerCall: ownerAlert, // back-compat for older clients
    chain,
  };
}
