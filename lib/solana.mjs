/** Solana Memo program — stores opaque bytes in an on-chain tx. */
export const MEMO_PROGRAM_ID_STR =
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

let _web3 = null;
let _bs58 = null;

async function loadWeb3() {
  if (!_web3) {
    _web3 = await import("@solana/web3.js");
  }
  return _web3;
}

async function loadBs58() {
  if (!_bs58) {
    const mod = await import("bs58");
    _bs58 = mod.default || mod;
  }
  return _bs58;
}

export function solanaConfigured() {
  return Boolean(process.env.SOLANA_SECRET_KEY?.trim());
}

export function getCluster() {
  return (process.env.SOLANA_CLUSTER || "devnet").toLowerCase();
}

export function getRpcUrl() {
  return (
    process.env.SOLANA_RPC_URL ||
    (getCluster() === "mainnet-beta"
      ? "https://api.mainnet-beta.solana.com"
      : getCluster() === "testnet"
        ? "https://api.testnet.solana.com"
        : "https://api.devnet.solana.com")
  );
}

export function explorerTxUrl(signature, cluster = getCluster()) {
  const c = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${c}`;
}

async function parseSecretKey(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new Error("SOLANA_SECRET_KEY is empty");

  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed);
    return Uint8Array.from(arr);
  }

  const bs58 = await loadBs58();
  return bs58.decode(trimmed);
}

export async function loadKeypair() {
  const { Keypair } = await loadWeb3();
  const secret = await parseSecretKey(process.env.SOLANA_SECRET_KEY);
  return Keypair.fromSecretKey(secret);
}

export async function getConnection() {
  const { Connection } = await loadWeb3();
  return new Connection(getRpcUrl(), {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });
}

export async function getWalletBalanceLamports() {
  if (!solanaConfigured()) return 0;
  const connection = await getConnection();
  const kp = await loadKeypair();
  return connection.getBalance(kp.publicKey);
}

/**
 * Anchor an opaque UTF-8 memo (typically a JSON receipt) on Solana.
 * Returns signature + explorer URL.
 */
export async function sendMemo(memoText) {
  if (!solanaConfigured()) {
    throw new Error("SOLANA_SECRET_KEY not configured");
  }

  const {
    PublicKey,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
  } = await loadWeb3();

  const payer = await loadKeypair();
  const connection = await getConnection();
  const data = Buffer.from(String(memoText), "utf8");
  if (data.length > 566) {
    throw new Error(`Memo too large (${data.length} bytes; max 566)`);
  }

  const ix = new TransactionInstruction({
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }],
    programId: new PublicKey(MEMO_PROGRAM_ID_STR),
    data,
  });

  const tx = new Transaction().add(ix);
  const signature = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
    skipPreflight: false,
  });

  let slot = null;
  try {
    const status = await connection.getSignatureStatuses([signature]);
    slot = status?.value?.[0]?.slot ?? null;
  } catch {
    /* optional */
  }

  return {
    signature,
    slot,
    cluster: getCluster(),
    rpcUrl: getRpcUrl(),
    payer: payer.publicKey.toBase58(),
    explorerUrl: explorerTxUrl(signature),
  };
}
