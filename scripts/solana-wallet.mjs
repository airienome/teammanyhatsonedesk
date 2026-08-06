import "dotenv/config";
import { writeFileSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * Generate (or reuse) a Solana demo wallet, print pubkey, optional airdrop.
 *
 *   node scripts/solana-wallet.mjs
 *   node scripts/solana-wallet.mjs --airdrop
 */
const wantAirdrop = process.argv.includes("--airdrop");
const rpc =
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const cluster = process.env.SOLANA_CLUSTER || "devnet";

let keypair;
if (process.env.SOLANA_SECRET_KEY?.trim()) {
  const raw = process.env.SOLANA_SECRET_KEY.trim();
  const secret = raw.startsWith("[")
    ? Uint8Array.from(JSON.parse(raw))
    : bs58.decode(raw);
  keypair = Keypair.fromSecretKey(secret);
  console.log("Using existing SOLANA_SECRET_KEY from env.");
} else {
  keypair = Keypair.generate();
  const secretB58 = bs58.encode(keypair.secretKey);
  const line = `\n# Solana (OwnerRadar order anchors)\nSOLANA_CLUSTER=${cluster}\nSOLANA_RPC_URL=${rpc}\nSOLANA_SECRET_KEY=${secretB58}\n`;

  if (existsSync(".env")) {
    const env = readFileSync(".env", "utf8");
    if (!env.includes("SOLANA_SECRET_KEY=")) {
      appendFileSync(".env", line);
      console.log("Appended SOLANA_SECRET_KEY to .env");
    } else {
      console.log("SOLANA_SECRET_KEY already present in .env — not overwriting.");
    }
  } else {
    writeFileSync(".env", line.trimStart());
    console.log("Wrote .env with SOLANA_SECRET_KEY");
  }

  console.log("\nSecret (base58) — keep private:");
  console.log(secretB58);
}

console.log("\nPublic key:", keypair.publicKey.toBase58());
console.log("Cluster:", cluster);
console.log("RPC:", rpc);
console.log(
  `Explorer: https://explorer.solana.com/address/${keypair.publicKey.toBase58()}?cluster=${cluster}`
);

if (wantAirdrop) {
  const connection = new Connection(rpc, "confirmed");
  console.log("\nRequesting 2 SOL airdrop on devnet…");
  const sig = await connection.requestAirdrop(
    keypair.publicKey,
    2 * LAMPORTS_PER_SOL
  );
  await connection.confirmTransaction(sig, "confirmed");
  const bal = await connection.getBalance(keypair.publicKey);
  console.log("Airdrop sig:", sig);
  console.log("Balance:", bal / LAMPORTS_PER_SOL, "SOL");
} else {
  console.log("\nFund the wallet with: npm run solana:airdrop");
}
