import { buildEnrichmentSms, sendOwnerSms } from "../lib/sms.mjs";

/**
 * OwnerRadar TextOwner tool — SMS Pablo LinkedIn + public event info.
 *
 * POST /api/text-owner
 *
 * Body (all optional — defaults to demo organizer enrichment):
 * {
 *   "name": "Alex Rivera",
 *   "role": "Head of Partnerships · Cursor Miami Hackathon",
 *   "linkedin": "https://…",
 *   "notes": ["…"],
 *   "body": "full custom SMS",   // overrides structured fields
 *   "to": "+1…"                  // override OWNER_PHONE
 * }
 */
function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return {};
    }
  }
  return req.body;
}

const DEFAULT_ORGANIZER = {
  name: "Alex Rivera",
  role: "Head of Partnerships · Cursor Miami Hackathon",
  linkedin: "https://www.linkedin.com/in/example-alex-rivera-hackathon",
  publicNotes: [
    "Public event listing: Cursor Miami hackathon — multi-day builder event at the Wynwood dock venue.",
    "Likely recurring catering need across demo days and closing party.",
  ],
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  try {
    const body = parseBody(req);
    const args = body.args || body.arguments || body;

    const smsBody =
      args.body ||
      args.message ||
      args.text ||
      buildEnrichmentSms({
        name: args.name || DEFAULT_ORGANIZER.name,
        role: args.role || DEFAULT_ORGANIZER.role,
        linkedin: args.linkedin || args.linkedIn || DEFAULT_ORGANIZER.linkedin,
        publicNotes:
          args.notes ||
          args.publicNotes ||
          args.public_notes ||
          DEFAULT_ORGANIZER.publicNotes,
      });

    const result = await sendOwnerSms({
      body: smsBody,
      toNumber: args.to || args.to_number || args.phone || args.ownerPhone || null,
    });

    res.status(200).json({
      ok: true,
      status: "sent",
      message: "Enrichment SMS queued to owner.",
      sid: result.sid,
      twilioStatus: result.status,
      toMasked: result.toMasked,
      fromMasked: result.fromMasked,
      bodyPreview: result.bodyPreview,
    });
  } catch (err) {
    console.error(err);
    const status =
      err.code === "NO_OWNER_PHONE" ||
      err.code === "NO_TWILIO_CREDS" ||
      err.code === "NO_TWILIO_FROM"
        ? 503
        : err.code === "NO_BODY"
          ? 400
          : 500;
    res.status(status).json({
      ok: false,
      status: "error",
      error: err.message || "Failed to text owner",
      code: err.code || "TEXT_OWNER_FAILED",
    });
  }
}
