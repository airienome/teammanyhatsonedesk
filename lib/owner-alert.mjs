import { getSql, fetchNetworkSnapshot } from "./snapshot.mjs";
import { ALERT_Z, analyzeStores, summarizeBreach } from "./spc.mjs";
import {
  buildOwnerAlertSms,
  maskPhone,
  ownerPhone,
  parseOwnerSmsCommand,
  recentlyTextedOwner,
  sendSms,
  twilioConfigured,
} from "./sms.mjs";
import { placeOwnerCall } from "./call-owner.mjs";
import {
  NEAREST_HELP_STORE_ID,
  PRIMARY_STORE_ID,
  planFulfillment,
} from "./orders.mjs";

/**
 * SPC ≥2σ → proactive owner SMS (primary escalation).
 * Voice dial stays on the CALL reply path.
 */
export async function textOwnerForOutOfControl({
  snapshot = null,
  storeId = null,
  order = null,
  caseId = null,
  plan = null,
  force = false,
  toNumber = null,
  reason = "spc_out_of_control",
} = {}) {
  const snap = snapshot || (await fetchNetworkSnapshot());
  const analysis = analyzeStores(snap.stores || []);
  const targets = analysis.outOfControl.filter((a) =>
    storeId ? a.store.id === storeId : true
  );

  if (!targets.length) {
    return {
      ok: true,
      texted: [],
      skipped: [
        {
          reason: "in_statistical_control",
          message: `No store ≥${ALERT_Z}σ out of control`,
        },
      ],
      analysis: { alertZ: ALERT_Z, outOfControlCount: 0 },
    };
  }

  if (!twilioConfigured()) {
    const err = new Error(
      "Twilio SMS not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER"
    );
    err.code = "NO_TWILIO";
    throw err;
  }
  if (!(toNumber || ownerPhone())) {
    const err = new Error("OWNER_PHONE is not set");
    err.code = "NO_OWNER_PHONE";
    throw err;
  }

  const sql = getSql();
  const texted = [];
  const skipped = [];

  for (const target of targets) {
    if (!force && (await recentlyTextedOwner(sql, target.store.id))) {
      skipped.push({
        storeId: target.store.id,
        reason: "cooldown",
        message: `Owner already texted for ${target.store.name} within cooldown`,
        breachSummary: summarizeBreach(target),
      });
      continue;
    }

    try {
      const resolvedCaseId =
        caseId ||
        target.store.activeCase?.caseId ||
        order?.caseId ||
        `SPC-${target.store.id}-${Date.now().toString(36).toUpperCase()}`;

      const breachSummary = summarizeBreach(target);
      const body = buildOwnerAlertSms({
        storeName: target.store.name,
        breachSummary,
        order:
          order ||
          (target.store.activeCase
            ? {
                qty: target.store.activeCase.qty,
                when: target.store.activeCase.when,
                where: target.store.activeCase.where,
                item: target.store.activeCase.item,
                ticketCents: target.store.activeCase.value
                  ? Math.round(Number(target.store.activeCase.value) * 100)
                  : null,
                caseId: target.store.activeCase.caseId,
              }
            : null),
        caseId: resolvedCaseId,
        plan,
      });

      const msg = await sendSms({ to: toNumber || ownerPhone(), body });

      await sql`
        INSERT INTO store_events (
          store_id, event_type, severity, title, body, payload
        ) VALUES (
          ${target.store.id},
          'owner_sms',
          'alert',
          'OwnerRadar texted owner (partner)',
          ${body},
          ${JSON.stringify({
            caseId: resolvedCaseId,
            sid: msg.sid,
            toMasked: msg.toMasked,
            reason,
            alertZ: ALERT_Z,
            breachSummary,
            status: "awaiting_approval",
            flags: target.alertFlags,
            order: order || null,
            plan: plan || null,
            channel: "sms",
          })}
        )
      `;

      texted.push({
        ok: true,
        storeId: target.store.id,
        storeName: target.store.name,
        caseId: resolvedCaseId,
        sid: msg.sid,
        toMasked: msg.toMasked,
        breachSummary,
        body,
        status: "awaiting_approval",
        message: body.split("\n")[0],
      });
    } catch (err) {
      skipped.push({
        storeId: target.store.id,
        reason: err.code || "sms_failed",
        message: err.message,
      });
    }
  }

  return {
    ok: true,
    texted,
    skipped,
    analysis: {
      alertZ: ALERT_Z,
      outOfControlCount: targets.length,
      stores: targets.map((t) => ({
        storeId: t.store.id,
        storeName: t.store.name,
        worstAbs: t.worstAbs,
        breachSummary: summarizeBreach(t),
        flags: t.alertFlags,
      })),
    },
  };
}

async function latestOwnerCase(sql, storeId = PRIMARY_STORE_ID) {
  const rows = await sql`
    SELECT * FROM store_events
    WHERE store_id = ${storeId}
      AND event_type IN ('owner_sms', 'material_order', 'owner_sms_reply', 'coordination')
    ORDER BY occurred_at DESC
    LIMIT 20
  `;
  for (const row of rows) {
    const payload =
      typeof row.payload === "string"
        ? JSON.parse(row.payload || "{}")
        : row.payload || {};
    if (payload.caseId) {
      return { row, payload, caseId: payload.caseId };
    }
  }
  return null;
}

/**
 * Handle inbound owner SMS: APPROVE | REVIEW | CALL.
 */
export async function handleOwnerSmsReply({
  from,
  body,
  messageSid = null,
} = {}) {
  const { command, raw } = parseOwnerSmsCommand(body);
  const sql = getSql();
  const active = await latestOwnerCase(sql);
  const caseId = active?.caseId || `SMS-${Date.now().toString(36).toUpperCase()}`;
  const storeId = active?.row?.store_id || PRIMARY_STORE_ID;
  const prior = active?.payload || {};

  let replyText = "";
  let status = "unknown";
  let dial = null;
  let coordination = null;

  if (command === "APPROVE") {
    status = "approved";
    const qty = Number(prior.order?.qty || prior.qty || 300);
    const snap = await fetchNetworkSnapshot();
    const primary = snap.stores?.find((s) => s.id === PRIMARY_STORE_ID);
    const help = snap.stores?.find((s) => s.id === NEAREST_HELP_STORE_ID);
    const plan =
      prior.plan ||
      planFulfillment(
        qty,
        primary?.capacityPizzas || primary?.capacity_pizzas || 100,
        help?.capacityPizzas || help?.capacity_pizzas || 100
      );

    coordination = {
      caseId,
      status: "coordinating",
      plan,
      managers: [
        {
          storeId: PRIMARY_STORE_ID,
          role: "primary",
          share: plan.primaryShare,
          state: "assigned",
        },
        ...(plan.needsHelp
          ? [
              {
                storeId: NEAREST_HELP_STORE_ID,
                role: "assist",
                share: plan.helpShare,
                state: "assigned",
              },
            ]
          : []),
      ],
    };

    await sql`
      INSERT INTO store_events (
        store_id, event_type, severity, title, body, payload
      ) VALUES (
        ${storeId},
        'coordination',
        'watch',
        'Owner APPROVED — coordinating production',
        ${`Case ${caseId}: Plant The Future ${plan.primaryShare}${
          plan.needsHelp ? ` + Pollinator ${plan.helpShare}` : ""
        } panels.`},
        ${JSON.stringify(coordination)}
      )
    `;

    if (plan.needsHelp) {
      await sql`
        INSERT INTO store_events (
          store_id, event_type, severity, title, body, payload
        ) VALUES (
          ${NEAREST_HELP_STORE_ID},
          'fulfillment_assist',
          'watch',
          'Owner approved — help Plant The Future',
          ${`Produce ${plan.helpShare} panels for case ${caseId}.`},
          ${JSON.stringify({ caseId, plan, approvedBy: "owner_sms" })}
        )
      `;
    }

    replyText = plan.needsHelp
      ? `Approved. Coordinating now: Plant The Future ${plan.primaryShare} + Pollinator ${plan.helpShare}. Leads notified. Case ${caseId}.`
      : `Approved. Plant The Future covering ${plan.primaryShare} panels solo. Case ${caseId}.`;
  } else if (command === "REVIEW") {
    status = "review";
    const breach = prior.breachSummary || "unusual studio/capacity load";
    const qty = prior.order?.qty || "—";
    const where = prior.order?.where || "—";
    replyText = [
      `Review ${caseId}:`,
      `${prior.order ? `${qty} panels · ${where}` : "Live SPC alert"}`,
      `Signal: ${String(breach).replace(/\s*σ/g, " vs normal")}`,
      `Reply APPROVE to coordinate or CALL to talk.`,
    ].join("\n");
  } else if (command === "CALL") {
    status = "calling";
    try {
      dial = await placeOwnerCall({
        storeId,
        storeName:
          prior.storeName ||
          (storeId === PRIMARY_STORE_ID
            ? "Plant The Future"
            : storeId),
        caseId,
        flags: prior.flags || [],
        summary: prior.breachSummary,
        order: prior.order || null,
        toNumber: from || ownerPhone(),
        reason: "owner_sms_call",
        force: true,
      });
      replyText = `Calling you now from OwnerRadar. Case ${caseId}.`;
    } catch (err) {
      replyText = `Couldn't place the call (${err.message}). Reply APPROVE to coordinate instead. Case ${caseId}.`;
      status = "call_failed";
    }
  } else {
    status = "unknown";
    replyText = `OwnerRadar here. Reply APPROVE, REVIEW, or CALL. Case ${caseId}.`;
  }

  await sql`
    INSERT INTO store_events (
      store_id, event_type, severity, title, body, payload
    ) VALUES (
      ${storeId},
      'owner_sms_reply',
      'info',
      ${`Owner SMS: ${command || "UNKNOWN"}`},
      ${String(raw || body || "")},
      ${JSON.stringify({
        caseId,
        command,
        status,
        fromMasked: maskPhone(from),
        messageSid,
        replyText,
        coordination,
        dial: dial
          ? { callId: dial.callId, provider: dial.provider }
          : null,
      })}
    )
  `;

  return {
    ok: true,
    command,
    status,
    caseId,
    storeId,
    replyText,
    coordination,
    dial,
  };
}
