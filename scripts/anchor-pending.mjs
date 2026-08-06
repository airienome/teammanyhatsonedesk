import "dotenv/config";
import { backfillOrderAnchors, flushPendingAnchors } from "../lib/chain.mjs";
import { solanaConfigured, loadKeypair, getRpcUrl, getCluster } from "../lib/solana.mjs";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * Backfill chain receipts for existing orders, then flush to Solana.
 *   node scripts/anchor-pending.mjs
 *   node scripts/anchor-pending.mjs --backfill
 */
const doBackfill = process.argv.includes("--backfill");

if (doBackfill) {
  const bf = await backfillOrderAnchors({ limit: 300 });
  console.log("Backfill:", bf);
}

if (!solanaConfigured()) {
  console.error("Set SOLANA_SECRET_KEY first (npm run solana:wallet).");
  console.log("Hashes can still queue as pending without a wallet.");
  process.exit(doBackfill ? 0 : 1);
}

const kp = await loadKeypair();
const connection = new Connection(getRpcUrl(), "confirmed");
const bal = await connection.getBalance(kp.publicKey);
console.log(
  `Wallet ${kp.publicKey.toBase58()} · ${getCluster()} · ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`
);

if (bal < 5_000_000) {
  console.warn(
    "Low balance — fund via https://faucet.solana.com (devnet) then re-run npm run solana:flush"
  );
}

const result = await flushPendingAnchors({ limit: 40 });
console.log(JSON.stringify(result, null, 2));
