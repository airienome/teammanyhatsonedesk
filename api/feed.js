import { getSql } from "../lib/snapshot.mjs";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  try {
    const sql = getSql();
    const storeId = req.query?.storeId;
    const events = storeId
      ? await sql`
          SELECT * FROM store_events
          WHERE store_id = ${storeId}
          ORDER BY occurred_at DESC
          LIMIT 50
        `
      : await sql`
          SELECT * FROM store_events
          ORDER BY occurred_at DESC
          LIMIT 50
        `;
    const calls = await sql`
      SELECT * FROM phone_calls
      ORDER BY occurred_at DESC
      LIMIT 30
    `;
    const clocks = await sql`
      SELECT c.*, e.display_name, e.role
      FROM clock_events c
      JOIN employees e ON e.id = c.employee_id
      ORDER BY c.occurred_at DESC
      LIMIT 30
    `;
    res.status(200).json({ events, calls, clocks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to load feed" });
  }
}
