-- Admin console rework 2026-09 (corrected 2026-09-07).
-- payment_orders leaves activation_codes.note; admin writes get an audit trail;
-- profiles gain ban columns.
--
-- 修正说明：
--  1) 早期遗留了一张空的 payment_orders（列名 status、无消费者），先 drop 再按 state 建。
--  2) 去掉 credit_ledger (reason, ref_id) 唯一索引——现网存在合法的多次退款/发放重复，
--     加了会失败且破坏数据；幂等由应用层唯一 refId 保证。

-- 1) 真实订单表（替换 note-JSON 方案）。
drop table if exists public.payment_orders;
create table public.payment_orders (
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
create index payment_orders_user_created_idx
  on public.payment_orders (user_id, created_at desc);
create index payment_orders_state_created_idx
  on public.payment_orders (state, created_at desc);
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
create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_target_idx
  on public.admin_audit_logs (target_type, target_id);
grant select, insert on public.admin_audit_logs to service_role;

-- 3) 封禁（不删数据）。
alter table public.profiles
  add column if not exists banned_at timestamptz,
  add column if not exists ban_reason text;
