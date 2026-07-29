-- Durable payment orders for Canvas collaboration seats. Active seat capacity
-- is derived from Canvas' append-only canvas_collaboration_seat_purchases
-- ledger; no second mutable entitlement balance is maintained here.

create table if not exists public.payment_orders (
  order_no text primary key,
  user_id uuid not null references auth.users (id) on delete restrict,
  provider text not null check (provider in ('epay')),
  product_kind text not null check (product_kind in ('collaboration_seat')),
  product_id text not null check (product_id = 'canvas-collaboration-seat-1'),
  quantity integer not null check (quantity = 1),
  unit_amount_cents integer not null check (unit_amount_cents = 1500),
  amount_cents integer not null check (amount_cents = unit_amount_cents * quantity),
  payment_method text not null check (payment_method in ('alipay', 'wxpay')),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'partially_refunded', 'refunded')),
  provider_trade_no text,
  return_url text not null check (char_length(return_url) between 1 and 500),
  product_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(product_snapshot) = 'object'),
  refunded_quantity integer not null default 0 check (refunded_quantity between 0 and quantity),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  failed_at timestamptz,
  check (provider_trade_no is null or char_length(provider_trade_no) between 1 and 80),
  check ((status in ('paid', 'partially_refunded', 'refunded')) = (paid_at is not null)),
  check ((status = 'failed') = (failed_at is not null))
);

create unique index if not exists payment_orders_provider_trade_unique_idx
  on public.payment_orders (provider, provider_trade_no)
  where provider_trade_no is not null;

create index if not exists payment_orders_user_created_idx
  on public.payment_orders (user_id, created_at desc);

create table if not exists public.payment_events (
  provider text not null,
  event_id text not null,
  event_type text not null check (event_type in ('payment.settled', 'payment.refunded')),
  order_no text not null references public.payment_orders (order_no) on delete restrict,
  provider_trade_no text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  processed_at timestamptz not null default now(),
  primary key (provider, event_id),
  check (char_length(event_id) between 1 and 128),
  check (char_length(provider_trade_no) between 1 and 80)
);

create unique index if not exists payment_events_provider_trade_type_unique_idx
  on public.payment_events (provider, event_type, provider_trade_no);

alter table public.payment_orders enable row level security;
alter table public.payment_events enable row level security;

revoke all privileges on table public.payment_orders from public;
revoke all privileges on table public.payment_events from public;
grant select, insert, update on table public.payment_orders to service_role;
grant select, insert on table public.payment_events to service_role;

create or replace function public.set_payment_orders_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payment_orders_updated_at on public.payment_orders;
create trigger payment_orders_updated_at
  before update on public.payment_orders
  for each row execute function public.set_payment_orders_updated_at();

create or replace function public.settle_canvas_seat_payment(
  p_order_no text,
  p_provider_trade_no text,
  p_payment_method text,
  p_amount_cents integer,
  p_event_id text,
  p_event_payload jsonb default '{}'::jsonb
)
returns table (duplicate boolean, purchased_seats bigint)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.payment_orders%rowtype;
  v_event public.payment_events%rowtype;
  v_active_seats bigint;
begin
  if p_order_no is null
    or char_length(p_order_no) > 80
    or p_order_no !~ '^PAY[A-Z0-9]+$' then
    raise exception 'invalid_order_no';
  end if;
  if p_provider_trade_no is null or char_length(p_provider_trade_no) not between 1 and 80 then
    raise exception 'invalid_provider_trade_no';
  end if;
  if p_event_id is null or char_length(p_event_id) not between 1 and 128 then
    raise exception 'invalid_event_id';
  end if;
  if jsonb_typeof(coalesce(p_event_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_event_payload';
  end if;

  select * into v_order
  from public.payment_orders
  where order_no = p_order_no
  for update;
  if not found then raise exception 'payment_order_not_found'; end if;

  -- Revalidate immutable order fields even for a replayed provider event.
  -- Correct retries remain idempotent, while a conflicting signed callback
  -- cannot be acknowledged as successful merely because its event id exists.
  if v_order.product_kind <> 'collaboration_seat'
    or v_order.product_id <> 'canvas-collaboration-seat-1'
    or v_order.quantity <> 1
    or v_order.unit_amount_cents <> 1500
    or v_order.amount_cents <> 1500 then
    raise exception 'payment_product_mismatch';
  end if;
  if v_order.payment_method is distinct from p_payment_method then
    raise exception 'payment_method_mismatch';
  end if;
  if v_order.amount_cents is distinct from p_amount_cents then
    raise exception 'payment_amount_mismatch';
  end if;
  if v_order.provider_trade_no is not null
    and v_order.provider_trade_no <> p_provider_trade_no then
    raise exception 'provider_trade_mismatch';
  end if;

  select * into v_event
  from public.payment_events
  where provider = 'epay' and event_id = p_event_id;
  if found then
    if v_event.event_type <> 'payment.settled'
      or v_event.order_no <> p_order_no
      or v_event.provider_trade_no <> p_provider_trade_no then
      raise exception 'payment_event_conflict';
    end if;
    select coalesce(sum(seat_count), 0)::bigint into v_active_seats
    from public.canvas_collaboration_seat_purchases
    where owner_id = v_order.user_id::text and revoked_at is null;
    return query select true, v_active_seats;
    return;
  end if;

  if v_order.status not in ('pending', 'paid') then
    raise exception 'payment_order_not_pending';
  end if;

  select public.canvas_grant_collaboration_seats(
    v_order.user_id::text,
    v_order.order_no,
    v_order.quantity,
    v_order.amount_cents,
    p_provider_trade_no
  ) into v_active_seats;

  insert into public.payment_events (
    provider, event_id, event_type, order_no, provider_trade_no, payload
  ) values (
    'epay', p_event_id, 'payment.settled', p_order_no, p_provider_trade_no,
    coalesce(p_event_payload, '{}'::jsonb)
  );

  update public.payment_orders
  set status = 'paid', provider_trade_no = p_provider_trade_no,
      paid_at = coalesce(paid_at, now()), failed_at = null
  where order_no = p_order_no;

  return query select (v_order.status = 'paid'), v_active_seats;
end;
$$;

create or replace function public.refund_canvas_seat_payment(
  p_order_no text,
  p_provider_refund_no text,
  p_event_id text,
  p_event_payload jsonb default '{}'::jsonb
)
returns table (duplicate boolean, purchased_seats bigint)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.payment_orders%rowtype;
  v_event public.payment_events%rowtype;
  v_active_seats bigint;
begin
  if p_order_no is null
    or char_length(p_order_no) > 80
    or p_order_no !~ '^PAY[A-Z0-9]+$' then
    raise exception 'invalid_order_no';
  end if;
  if p_provider_refund_no is null or char_length(p_provider_refund_no) not between 1 and 80 then
    raise exception 'invalid_provider_refund_no';
  end if;
  if p_event_id is null or char_length(p_event_id) not between 1 and 128 then
    raise exception 'invalid_event_id';
  end if;
  if jsonb_typeof(coalesce(p_event_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_event_payload';
  end if;

  select * into v_order
  from public.payment_orders
  where order_no = p_order_no
  for update;
  if not found then raise exception 'payment_order_not_found'; end if;

  select * into v_event
  from public.payment_events
  where provider = 'epay' and event_id = p_event_id;
  if found then
    if v_event.event_type <> 'payment.refunded'
      or v_event.order_no <> p_order_no
      or v_event.provider_trade_no <> p_provider_refund_no then
      raise exception 'payment_event_conflict';
    end if;
    select coalesce(sum(seat_count), 0)::bigint into v_active_seats
    from public.canvas_collaboration_seat_purchases
    where owner_id = v_order.user_id::text and revoked_at is null;
    return query select true, v_active_seats;
    return;
  end if;

  if v_order.status not in ('paid', 'partially_refunded') or v_order.refunded_quantity <> 0 then
    raise exception 'payment_order_not_refundable';
  end if;

  select public.canvas_revoke_collaboration_seats(
    v_order.user_id::text,
    v_order.order_no,
    'payment_refund:' || p_provider_refund_no
  ) into v_active_seats;

  insert into public.payment_events (
    provider, event_id, event_type, order_no, provider_trade_no, payload
  ) values (
    'epay', p_event_id, 'payment.refunded', p_order_no, p_provider_refund_no,
    coalesce(p_event_payload, '{}'::jsonb)
  );

  update public.payment_orders
  set refunded_quantity = quantity, status = 'refunded'
  where order_no = p_order_no;

  return query select false, v_active_seats;
end;
$$;

revoke all on function public.settle_canvas_seat_payment(text, text, text, integer, text, jsonb) from public;
revoke all on function public.refund_canvas_seat_payment(text, text, text, jsonb) from public;
grant execute on function public.settle_canvas_seat_payment(text, text, text, integer, text, jsonb) to service_role;
grant execute on function public.refund_canvas_seat_payment(text, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
