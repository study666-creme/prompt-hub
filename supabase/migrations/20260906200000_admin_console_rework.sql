-- Admin console rework 2026-09 (non-destructive, corrected 2026-09-07).
-- 背景：现网已存在另一会话建的 payment_orders(status)/payment_events 支付模型。
-- 本 migration 不 drop 任何既有表，只为后台订单页补齐它需要的列，并新建审计表与封禁列。
-- 两套支付实现（status vs state）的正式合并留作后续单独决策。

-- 1) 给既有 payment_orders 补后台代码需要的列（若表不存在则先建最小版）。
create table if not exists public.payment_orders (
  order_no text primary key,
  user_id uuid not null,
  product_kind text,
  product_id text,
  amount_cents integer,
  payment_method text,
  provider_trade_no text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table public.payment_orders add column if not exists state text not null default 'pending';
alter table public.payment_orders add column if not exists credits numeric not null default 0;
alter table public.payment_orders add column if not exists membership_tier text;
alter table public.payment_orders add column if not exists membership_days integer;
alter table public.payment_orders add column if not exists credit_grant_mode text;
-- 若已有 status 值而 state 仍是默认，回填一次（空表无影响）
update public.payment_orders set state = status where status is not null and state = 'pending';
create index if not exists payment_orders_state_created_idx on public.payment_orders (state, created_at desc);
create index if not exists payment_orders_user_created_idx on public.payment_orders (user_id, created_at desc);
grant select, insert, update, delete on public.payment_orders to service_role;

-- 2) 后台写操作审计。
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
create index if not exists admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_target_idx on public.admin_audit_logs (target_type, target_id);
grant select, insert on public.admin_audit_logs to service_role;

-- 3) 封禁（不删数据）。
alter table public.profiles add column if not exists banned_at timestamptz;
alter table public.profiles add column if not exists ban_reason text;
