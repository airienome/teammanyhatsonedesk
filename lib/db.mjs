import "dotenv/config";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export const sql = neon(process.env.DATABASE_URL);

export async function query(strings, ...values) {
  return sql(strings, ...values);
}
