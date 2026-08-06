-- Joe's Pizza ops schema for OwnerRadar hackathon demo

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS website_hits CASCADE;
DROP TABLE IF EXISTS phone_calls CASCADE;
DROP TABLE IF EXISTS utility_readings CASCADE;
DROP TABLE IF EXISTS inventory_ledger CASCADE;
DROP TABLE IF EXISTS inventory_items CASCADE;
DROP TABLE IF EXISTS pos_orders CASCADE;
DROP TABLE IF EXISTS clock_events CASCADE;
DROP TABLE IF EXISTS shifts CASCADE;
DROP TABLE IF EXISTS employees CASCADE;
DROP TABLE IF EXISTS kpi_snapshots CASCADE;
DROP TABLE IF EXISTS store_events CASCADE;
DROP TABLE IF EXISTS stores CASCADE;

CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  neighborhood TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT,
  city TEXT NOT NULL,
  capacity_pizzas INTEGER NOT NULL DEFAULT 100,
  van_available BOOLEAN NOT NULL DEFAULT FALSE,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  hourly_rate NUMERIC(8,2),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE clock_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('clock_in', 'clock_out')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'simulator'
);

CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  label TEXT NOT NULL,
  unit TEXT NOT NULL,
  par_level NUMERIC(12,2) NOT NULL DEFAULT 0,
  UNIQUE (store_id, sku)
);

CREATE TABLE inventory_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  delta NUMERIC(12,3) NOT NULL,
  balance NUMERIC(12,3) NOT NULL,
  reason TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE utility_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  water_gallons NUMERIC(12,2) NOT NULL DEFAULT 0,
  gas_therms NUMERIC(12,2) NOT NULL DEFAULT 0,
  electric_kwh NUMERIC(12,2) NOT NULL DEFAULT 0,
  dough_lbs_produced NUMERIC(12,2) NOT NULL DEFAULT 0,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE phone_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  duration_sec INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL,
  caller_label TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE website_hits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sessions INTEGER NOT NULL DEFAULT 0,
  pageviews INTEGER NOT NULL DEFAULT 0,
  orders_started INTEGER NOT NULL DEFAULT 0,
  orders_completed INTEGER NOT NULL DEFAULT 0,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE pos_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  pizza_count INTEGER NOT NULL DEFAULT 1,
  ticket_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE kpi_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  revenue_cents INTEGER NOT NULL DEFAULT 0,
  orders INTEGER NOT NULL DEFAULT 0,
  avg_ticket_cents INTEGER NOT NULL DEFAULT 0,
  capacity_util NUMERIC(6,2) NOT NULL DEFAULT 0,
  refund_rate NUMERIC(6,2) NOT NULL DEFAULT 0,
  discount_rate NUMERIC(6,2) NOT NULL DEFAULT 0,
  delivery_eta_min NUMERIC(6,2) NOT NULL DEFAULT 0,
  staffing_fill NUMERIC(6,2) NOT NULL DEFAULT 0,
  inventory_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  water_gallons_today NUMERIC(12,2) NOT NULL DEFAULT 0,
  dough_lbs_today NUMERIC(12,2) NOT NULL DEFAULT 0,
  phone_calls_today INTEGER NOT NULL DEFAULT 0,
  web_sessions_today INTEGER NOT NULL DEFAULT 0,
  employees_on_clock INTEGER NOT NULL DEFAULT 0,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE store_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clock_store_time ON clock_events (store_id, occurred_at DESC);
CREATE INDEX idx_inventory_store_time ON inventory_ledger (store_id, occurred_at DESC);
CREATE INDEX idx_utility_store_time ON utility_readings (store_id, occurred_at DESC);
CREATE INDEX idx_calls_store_time ON phone_calls (store_id, occurred_at DESC);
CREATE INDEX idx_web_store_time ON website_hits (store_id, occurred_at DESC);
CREATE INDEX idx_orders_store_time ON pos_orders (store_id, occurred_at DESC);
CREATE INDEX idx_kpi_store_time ON kpi_snapshots (store_id, occurred_at DESC);
CREATE INDEX idx_events_store_time ON store_events (store_id, occurred_at DESC);
CREATE INDEX idx_shifts_store_time ON shifts (store_id, starts_at);
