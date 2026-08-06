-- Additive migration: Solana order receipts (safe on existing DBs)

CREATE TABLE IF NOT EXISTS chain_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES pos_orders(id) ON DELETE CASCADE,
  payload_hash TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'anchored', 'signed', 'failed')),
  signature TEXT,
  slot BIGINT,
  explorer_url TEXT,
  cluster TEXT NOT NULL DEFAULT 'devnet',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  anchored_at TIMESTAMPTZ
);

-- Widen status check if table already existed without 'signed'
ALTER TABLE chain_receipts DROP CONSTRAINT IF EXISTS chain_receipts_status_check;
ALTER TABLE chain_receipts ADD CONSTRAINT chain_receipts_status_check
  CHECK (status IN ('pending', 'anchored', 'signed', 'failed'));

CREATE INDEX IF NOT EXISTS idx_chain_status_created
  ON chain_receipts (status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_chain_order
  ON chain_receipts (order_id);
