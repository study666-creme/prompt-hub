-- 生图任务扩展字段 + 支付 webhook 幂等表

alter table public.generation_requests
  add column if not exists quality text not null default 'standard'
    check (quality in ('standard', 'high', 'ultra')),
  add column if not exists size_label text,
  add column if not exists meta jsonb not null default '{}'::jsonb;

create table if not exists public.payment_webhook_events (
  event_id text primary key,
  event_type text not null,
  user_id uuid references auth.users (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now()
);

alter table public.payment_webhook_events enable row level security;
drop policy if exists "payment_webhook_events_deny_all" on public.payment_webhook_events;
create policy "payment_webhook_events_deny_all"
  on public.payment_webhook_events for all using (false);
