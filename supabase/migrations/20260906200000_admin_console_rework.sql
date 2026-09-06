-- Admin console rework 2026-09: payment orders leave activation_codes.note,
-- admin writes get an audit trail, and profiles gain ban columns so the
-- console can suspend an account without deleting it.

-- 1) Real payment order table. Epay flow writes here first and keeps the
--    activation_codes.note copy for one compatibility window.
create table if not exists public.payment_orders (
  order_no text primary key,
  user_id uuid not null,
  product_kind text not null check (product_kind in ('credits', 'membership')),
  product_id text not null,
  amount_cents integer not null check (amount_cents >= 0),
  credits numeric not null default 0,
  membership_tier text,
  membership_days integer,
  credit_grant_mode text,
  payment_method text not null default 'alipay',
  state text not null default 'pending'
    check (state in ('pending', 'processing', 'paid', 'failed', 'refunded')),
  provider_trade_no text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_orders_user_created_idx
  on public.payment_orders (user_id, created_at desc);
create index if not exists payment_orders_state_created_idx
  on public.payment_orders (state, created_at desc);

grant select, insert, update, delete on public.payment_orders to service_role;

-- 2) Audit trail for every admin write. The console has no per-admin
--    accounts yet, so actor is the fingerprint of whichever secret was used.
create table if not exists public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_fingerprint text not null default 'unknown',
  action text not null,
  target_type text not null,
  target_id text,
  before jsonb,
  after jsonb,
  detail jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_target_idx
  on public.admin_audit_logs (target_type, target_id);

grant select, insert on public.admin_audit_logs to service_role;

-- 3) Suspend without delete.
alter table public.profiles
  add column if not exists banned_at timestamptz,
  add column if not exists ban_reason text;

-- 4) Ledger idempotency: refunds and manual grants key on ref_id so a retry
--    can never double-credit.
create unique index if not exists credit_ledger_reason_ref_uidx
  on public.credit_ledger (reason, ref_id)
  where ref_id is not null;
