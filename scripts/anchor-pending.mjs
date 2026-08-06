import "dotenv/config";
import { flushPendingAnchors } from "../lib/chain.mjs";
import { solanaConfigured, loadKeypair, getRpcUrl, getCluster } from "../lib/solana.mjs";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * Flush pending order hashes to Solana.
 *   node scripts/anchor-pending.mjs
 */
if (!solanaConfigured()) {
  console.error("Set SOLANA_SECRET_KEY first (npm run solana:wallet).");
  process.exit(1);
}

const kp = loadKeypair();
const connection = new Connection(getRpcUrl(), "confirmed");
const bal = await connection.getBalance(kp.publicKey);
console.log(`Wallet ${kp.publicKey.toBase58()} · ${getCluster()} · ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

const result = await flushPendingAnchors({ limit: 40 });
console.log(JSON.stringify(result, null, 2));
