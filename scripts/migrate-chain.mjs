import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ws from "ws";
import { neonConfig, Pool } from "@neondatabase/serverless";

neonConfig.webSocketConstructor = ws;

const __dirname = dirname(fileURLToPath(import.meta.url));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const schema = readFileSync(join(__dirname, "../db/chain.sql"), "utf8");

const client = await pool.connect();
try {
  await client.query(schema);
  console.log("Migrated chain_receipts (Solana anchors).");
} finally {
  client.release();
  await pool.end();
}
