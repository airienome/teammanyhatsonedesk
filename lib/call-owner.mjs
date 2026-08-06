import { getSql, fetchNetworkSnapshot } from "./snapshot.mjs";
import { ALERT_Z, analyzeStores, summarizeBreach } from "./spc.mjs";

const OWNER_CALL_COOLDOWN_MS = 15 * 60_000;

/**
 * Dial the hackathon partner when a store is outside statistical control (≥2σ).
 * No hardcoded pizza counts — payload is SPC breach context.
 */
export async function placeOwnerCall({
  storeId,
  storeName = null,
  caseId = null,
  flags = [],
  summary = null,
  order = null,
  toNumber = null,
  reason = "spc_out_of_control",
  force = false,
} = {}) {
  if (!storeId) {
    const err = new Error("storeId is required");
    err.code = "NO_STORE";
    throw err;
  }

  const to =
    toNumber ||
    process.env.OWNER_PHONE ||
    process.env.HACKATHON_PARTNER_PHONE ||
    null;

  if (!to) {
    const err = new Error(
      "OWNER_PHONE (or HACKATHON_PARTNER_PHONE) is not set — add the partner E.164 number in Vercel env."
    );
    err.code = "NO_OWNER_PHONE";
    throw err;
  }

  const alertFlags = (flags || []).filter(
    (f) => f.severity === "alert" || Math.abs(Number(f.z) || 0) >= ALERT_Z
  );
  const breachSummary =
    summary ||
    (alertFlags.length
      ? alertFlags
          .slice(0, 3)
          .map(
            (f) =>
              `${f.label || f.kpi} ${Number(f.z) >= 0 ? "+" : ""}${Number(f.z).toFixed(1)}σ`
          )
          .join("; ")
      : null);

  if (!force && !breachSummary && !alertFlags.length) {
    const err = new Error(
      "No ≥2σ SPC breach provided — owner call only fires out of statistical control."
    );
    err.code = "IN_CONTROL";
    throw err;
  }

  const resolvedCaseId =
    caseId ||
    order?.caseId ||
    `SPC-${storeId}-${Date.now().toString(36).toUpperCase()}`;

  const dynamic = {
    case_id: String(resolvedCaseId),
    store_id: String(storeId),
    store_name: String(storeName || storeId),
    reason: String(reason),
    alert_z: String(ALERT_Z),
    breach_summary: String(breachSummary || "out of statistical control"),
    top_kpi: String(alertFlags[0]?.kpi || ""),
    top_z: String(alertFlags[0]?.z ?? ""),
    qty: order?.qty != null ? String(order.qty) : "",
    when: order?.when ? String(order.when) : "",
    where: order?.where ? String(order.where) : "",
    item: order?.item ? String(order.item) : "",
  };

  let provider = null;
  let providerResponse = null;

  if (process.env.RETELL_API_KEY && process.env.RETELL_FROM_NUMBER) {
    provider = "retell";
    const body = {
      from_number: process.env.RETELL_FROM_NUMBER,
      to_number: to,
      retell_llm_dynamic_variables: dynamic,
      metadata: {
        caseId: resolvedCaseId,
        reason,
        storeId,
        spc: true,
        alertZ: ALERT_Z,
      },
    };
    if (process.env.RETELL_OWNER_AGENT_ID) {
      body.override_agent_id = process.env.RETELL_OWNER_AGENT_ID;
    }
    const res = await fetch("https://api.retellai.com/v2/create-phone-call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    providerResponse = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(
        providerResponse?.message ||
          providerResponse?.error ||
          `Retell dial failed (${res.status})`
      );
      err.code = "RETELL_DIAL_FAILED";
      err.providerResponse = providerResponse;
      throw err;
    }
  } else if (
    process.env.ELEVENLABS_API_KEY &&
    process.env.ELEVENLABS_OWNER_AGENT_ID &&
    process.env.ELEVENLABS_OWNER_PHONE_NUMBER_ID
  ) {
    provider = "elevenlabs";
    const res = await fetch(
      "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: process.env.ELEVENLABS_OWNER_AGENT_ID,
          agent_phone_number_id: process.env.ELEVENLABS_OWNER_PHONE_NUMBER_ID,
          to_number: to,
          conversation_initiation_client_data: {
            dynamic_variables: dynamic,
          },
        }),
      }
    );
    providerResponse = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(
        providerResponse?.detail ||
          providerResponse?.message ||
          `ElevenLabs dial failed (${res.status})`
      );
      err.code = "ELEVENLABS_DIAL_FAILED";
      err.providerResponse = providerResponse;
      throw err;
    }
  } else {
    const err = new Error(
      "No dial provider configured. Set RETELL_API_KEY + RETELL_FROM_NUMBER (+ optional RETELL_OWNER_AGENT_ID) or ELEVENLABS_API_KEY + ELEVENLABS_OWNER_AGENT_ID + ELEVENLABS_OWNER_PHONE_NUMBER_ID."
    );
    err.code = "NO_DIAL_PROVIDER";
    throw err;
  }

  const callId =
    providerResponse?.call_id ||
    providerResponse?.callId ||
    providerResponse?.conversation_id ||
    providerResponse?.conversationId ||
    null;

  const speakable = `Calling owner (partner): ${storeName || storeId} out of statistical control (≥${ALERT_Z}σ). ${breachSummary || ""}`.trim();

  try {
    const sql = getSql();
    await sql`
      INSERT INTO phone_calls (
        store_id, direction, duration_sec, outcome, caller_label
      ) VALUES (
        ${storeId},
        'outbound',
        0,
        'owner_alert_dialed',
        ${`owner_partner:${provider}`}
      )
    `;
    await sql`
      INSERT INTO store_events (
        store_id, event_type, severity, title, body, payload
      ) VALUES (
        ${storeId},
        'owner_call',
        'alert',
        'OwnerRadar calling owner (partner)',
        ${speakable},
        ${JSON.stringify({
          caseId: resolvedCaseId,
          provider,
          callId,
          toMasked: maskPhone(to),
          reason,
          alertZ: ALERT_Z,
          flags: alertFlags,
          breachSummary,
          order: order || null,
        })}
      )
    `;
  } catch (dbErr) {
    console.error("call-owner DB write failed", dbErr);
  }

  return {
    ok: true,
    dialed: true,
    provider,
    callId,
    toMasked: maskPhone(to),
    caseId: resolvedCaseId,
    storeId,
    storeName,
    alertZ: ALERT_Z,
    flags: alertFlags,
    breachSummary,
    message: speakable,
    providerResponse,
  };
}

async function recentlyCalledOwner(sql, storeId) {
  const since = new Date(Date.now() - OWNER_CALL_COOLDOWN_MS).toISOString();
  const rows = await sql`
    SELECT id FROM store_events
    WHERE store_id = ${storeId}
      AND event_type = 'owner_call'
      AND occurred_at >= ${since}
    LIMIT 1
  `;
  return Boolean(rows[0]);
}

/**
 * Evaluate live network KPIs and dial the partner for each new ≥2σ breach.
 * Returns { dialed: [], skipped: [], analysis }.
 */
export async function dialOwnerForOutOfControl({
  snapshot = null,
  storeId = null,
  order = null,
  caseId = null,
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
      dialed: [],
      skipped: [
        {
          reason: "in_statistical_control",
          message: `No store ≥${ALERT_Z}σ out of control`,
        },
      ],
      analysis: {
        alertZ: ALERT_Z,
        outOfControlCount: 0,
      },
    };
  }

  const sql = getSql();
  const dialed = [];
  const skipped = [];

  for (const target of targets) {
    if (!force && (await recentlyCalledOwner(sql, target.store.id))) {
      skipped.push({
        storeId: target.store.id,
        reason: "cooldown",
        message: `Owner already dialed for ${target.store.name} within cooldown`,
        breachSummary: summarizeBreach(target),
      });
      continue;
    }

    try {
      const result = await placeOwnerCall({
        storeId: target.store.id,
        storeName: target.store.name,
        caseId:
          caseId ||
          target.store.activeCase?.caseId ||
          `SPC-${target.store.id}-${Date.now().toString(36).toUpperCase()}`,
        flags: target.alertFlags,
        summary: summarizeBreach(target),
        order:
          order ||
          (target.store.activeCase
            ? {
                qty: target.store.activeCase.qty,
                when: target.store.activeCase.when,
                where: target.store.activeCase.where,
                item: target.store.activeCase.item,
                caseId: target.store.activeCase.caseId,
              }
            : null),
        toNumber,
        reason,
        force: true, // already verified OOC
      });
      dialed.push(result);
    } catch (err) {
      skipped.push({
        storeId: target.store.id,
        reason: err.code || "dial_failed",
        message: err.message,
      });
    }
  }

  return {
    ok: true,
    dialed,
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

function maskPhone(phone) {
  const s = String(phone);
  if (s.length < 4) return "****";
  return `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}
