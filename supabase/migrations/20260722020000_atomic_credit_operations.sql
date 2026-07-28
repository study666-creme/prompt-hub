-- Serialize wallet mutations and make retries safe for concurrent requests.
-- Run after the numeric-credit migrations (20260602210000/211000).

create index if not exists credit_ledger_user_reason_ref_idx
  on public.credit_ledger (user_id, reason, ref_id)
  where ref_id is not null;

create or replace function public.consume_user_credits(
  p_user_id uuid,
  p_amount numeric(12, 1),
  p_reason text,
  p_ref_id text,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_existing public.credit_ledger;
  v_amount numeric(12, 1) := round(coalesce(p_amount, 0), 1);
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_daily_available numeric(12, 1) := 0;
  v_from_daily numeric(12, 1) := 0;
  v_from_permanent numeric(12, 1) := 0;
  v_daily_after numeric(12, 1) := 0;
  v_spendable_after numeric(12, 1) := 0;
  v_meta jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required';
  end if;
  if coalesce(btrim(p_ref_id), '') = '' then
    raise exception 'ref_id_required';
  end if;
  if v_amount <= 0 then
    raise exception 'amount_must_be_positive';
  end if;

  insert into public.profiles (user_id, credits)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  -- Every wallet operation for a user takes this lock. The idempotency lookup
  -- therefore remains correct even when two Worker requests arrive together.
  select * into v_profile
    from public.profiles
    where user_id = p_user_id
    for update;

  select * into v_existing
    from public.credit_ledger
    where user_id = p_user_id
      and reason = p_reason
      and ref_id = p_ref_id
    order by created_at asc, id asc
    limit 1;

  if found then
    return jsonb_build_object(
      'profile', to_jsonb(v_profile),
      'split', jsonb_build_object(
        'fromDaily', coalesce(nullif(v_existing.meta->>'fromDaily', '')::numeric, 0),
        'fromPermanent', coalesce(nullif(v_existing.meta->>'fromPermanent', '')::numeric, 0)
      ),
      'replayed', true
    );
  end if;

  if v_profile.daily_credits_date = v_today then
    v_daily_available := greatest(coalesce(v_profile.daily_credits, 0), 0);
  end if;
  if coalesce(v_profile.credits, 0) + v_daily_available < v_amount then
    raise exception 'insufficient_credits';
  end if;

  v_from_daily := least(v_daily_available, v_amount);
  v_from_permanent := v_amount - v_from_daily;
  v_daily_after := v_daily_available - v_from_daily;

  update public.profiles
    set credits = credits - v_from_permanent,
        daily_credits = case
          when daily_credits_date = v_today then v_daily_after
          else daily_credits
        end,
        lifetime_credits_spent = coalesce(lifetime_credits_spent, 0) + v_amount
    where user_id = p_user_id
    returning * into v_profile;

  v_spendable_after := v_profile.credits + case
    when v_profile.daily_credits_date = v_today
      then greatest(coalesce(v_profile.daily_credits, 0), 0)
    else 0
  end;
  v_meta := coalesce(p_meta, '{}'::jsonb) || jsonb_build_object(
    'fromDaily', v_from_daily,
    'fromPermanent', v_from_permanent,
    'operation', 'debit'
  );

  insert into public.credit_ledger (
    user_id, delta, balance_after, reason, ref_id, meta
  ) values (
    p_user_id, -v_amount, v_spendable_after, p_reason, p_ref_id, v_meta
  );

  return jsonb_build_object(
    'profile', to_jsonb(v_profile),
    'split', jsonb_build_object(
      'fromDaily', v_from_daily,
      'fromPermanent', v_from_permanent
    ),
    'replayed', false
  );
end;
$$;

create or replace function public.refund_user_credits(
  p_user_id uuid,
  p_amount numeric(12, 1),
  p_reason text,
  p_ref_id text,
  p_from_daily numeric(12, 1) default 0,
  p_from_permanent numeric(12, 1) default 0,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_existing public.credit_ledger;
  v_amount numeric(12, 1) := round(coalesce(p_amount, 0), 1);
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_from_daily numeric(12, 1) := greatest(round(coalesce(p_from_daily, 0), 1), 0);
  v_from_permanent numeric(12, 1) := greatest(round(coalesce(p_from_permanent, 0), 1), 0);
  v_daily_before numeric(12, 1) := 0;
  v_daily_after numeric(12, 1) := 0;
  v_spendable_after numeric(12, 1) := 0;
  v_meta jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required';
  end if;
  if coalesce(btrim(p_ref_id), '') = '' then
    raise exception 'ref_id_required';
  end if;
  if v_amount <= 0 then
    raise exception 'amount_must_be_positive';
  end if;

  insert into public.profiles (user_id, credits)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select * into v_profile
    from public.profiles
    where user_id = p_user_id
    for update;

  select * into v_existing
    from public.credit_ledger
    where user_id = p_user_id
      and reason = p_reason
      and ref_id = p_ref_id
    order by created_at asc, id asc
    limit 1;

  if found then
    return jsonb_build_object(
      'profile', to_jsonb(v_profile),
      'replayed', true
    );
  end if;

  if v_from_daily + v_from_permanent > v_amount then
    raise exception 'invalid_refund_split';
  end if;
  -- A missing split is treated as a permanent-credit refund for compatibility
  -- with old jobs whose debit metadata was not written before a failure.
  if v_from_daily + v_from_permanent < v_amount then
    v_from_permanent := v_amount - v_from_daily;
  end if;

  if v_profile.daily_credits_date = v_today then
    v_daily_before := greatest(coalesce(v_profile.daily_credits, 0), 0);
  end if;
  v_daily_after := v_daily_before + v_from_daily;

  update public.profiles
    set credits = credits + v_from_permanent,
        daily_credits = case
          when v_from_daily > 0 then v_daily_after
          else daily_credits
        end,
        daily_credits_date = case
          when v_from_daily > 0 then v_today
          else daily_credits_date
        end
    where user_id = p_user_id
    returning * into v_profile;

  v_spendable_after := v_profile.credits + case
    when v_profile.daily_credits_date = v_today
      then greatest(coalesce(v_profile.daily_credits, 0), 0)
    else 0
  end;
  v_meta := coalesce(p_meta, '{}'::jsonb) || jsonb_build_object(
    'refundDaily', v_from_daily,
    'refundPermanent', v_from_permanent,
    'operation', 'refund'
  );

  insert into public.credit_ledger (
    user_id, delta, balance_after, reason, ref_id, meta
  ) values (
    p_user_id, v_amount, v_spendable_after, p_reason, p_ref_id, v_meta
  );

  return jsonb_build_object(
    'profile', to_jsonb(v_profile),
    'replayed', false
  );
end;
$$;

-- Kept for compatibility with older callers that update the milestone counter
-- separately from a wallet operation. The row lock prevents lost increments.
create or replace function public.increment_lifetime_credits_spent(
  p_user_id uuid,
  p_amount numeric(12, 1)
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_amount numeric(12, 1) := round(coalesce(p_amount, 0), 1);
begin
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;
  if v_amount < 0 then
    raise exception 'amount_must_be_nonnegative';
  end if;

  insert into public.profiles (user_id, credits)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select * into v_profile
    from public.profiles
    where user_id = p_user_id
    for update;

  if v_amount = 0 then
    return v_profile;
  end if;

  update public.profiles
    set lifetime_credits_spent = coalesce(lifetime_credits_spent, 0) + v_amount
    where user_id = p_user_id
    returning * into v_profile;
  return v_profile;
end;
$$;

-- Daily-credit writers must use the same profile row lock as debits.  The
-- `floor` behavior is intentional: task rewards and the member claim restore
-- the allowance to at least today's configured amount, matching the legacy
-- application behavior while preventing stale absolute updates from undoing a
-- concurrent debit.
create or replace function public.grant_user_daily_credits(
  p_user_id uuid,
  p_amount numeric(12, 1),
  p_mode text default 'universal'
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_amount numeric(12, 1) := round(coalesce(p_amount, 0), 1);
  v_mode text := lower(coalesce(p_mode, 'universal'));
  v_current numeric(12, 1) := 0;
begin
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;
  if v_amount <= 0 then
    raise exception 'amount_must_be_positive';
  end if;
  if v_mode not in ('universal', 'member') then
    raise exception 'daily_credit_mode_invalid';
  end if;

  insert into public.profiles (user_id, credits)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select * into v_profile
    from public.profiles
    where user_id = p_user_id
    for update;

  if v_mode = 'member' then
    if v_profile.membership_tier is null
      or (
        v_profile.membership_until is not null
        and v_profile.membership_until <= now()
        and not (
          v_profile.membership_queued_tier is not null
          and v_profile.membership_queued_until is not null
          and v_profile.membership_queued_until > now()
        )
      ) then
      raise exception 'membership_inactive';
    end if;
    if v_profile.credit_grant_mode <> 'daily' then
      raise exception 'credit_mode_not_daily';
    end if;
  end if;

  if v_profile.daily_credits_date = v_today then
    v_current := greatest(coalesce(v_profile.daily_credits, 0), 0);
  end if;

  update public.profiles
    set daily_credits = greatest(v_current, v_amount),
        daily_credits_date = v_today
    where user_id = p_user_id
    returning * into v_profile;

  return v_profile;
end;
$$;

-- Refresh is different from a task claim: once today's allowance has already
-- been initialized, a stale caller must not refill it after a debit.
create or replace function public.refresh_user_daily_credits(
  p_user_id uuid,
  p_amount numeric(12, 1)
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_amount numeric(12, 1) := round(coalesce(p_amount, 0), 1);
begin
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;
  if v_amount <= 0 then
    raise exception 'amount_must_be_positive';
  end if;

  insert into public.profiles (user_id, credits)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select * into v_profile
    from public.profiles
    where user_id = p_user_id
    for update;

  if v_profile.membership_tier is null
    or v_profile.credit_grant_mode <> 'daily'
    or (
      v_profile.membership_until is not null
      and v_profile.membership_until <= now()
      and not (
        v_profile.membership_queued_tier is not null
        and v_profile.membership_queued_until is not null
        and v_profile.membership_queued_until > now()
      )
    ) then
    return v_profile;
  end if;

  if v_profile.daily_credits_date = v_today then
    return v_profile;
  end if;

  update public.profiles
    set daily_credits = v_amount,
        daily_credits_date = v_today
    where user_id = p_user_id
    returning * into v_profile;

  return v_profile;
end;
$$;

-- Bundle grants update the permanent balance, idempotency ledger, and marker
-- in one transaction.  The marker alone cannot represent an open-ended
-- membership, so the ledger ref is also checked for that case.
create or replace function public.grant_membership_bundle(
  p_user_id uuid,
  p_amount numeric(12, 1),
  p_reason text,
  p_ref_id text,
  p_period_until timestamptz default null,
  p_meta jsonb default '{}'::jsonb
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_existing public.credit_ledger;
  v_amount numeric(12, 1) := round(coalesce(p_amount, 0), 1);
  v_meta jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required';
  end if;
  if coalesce(btrim(p_ref_id), '') = '' then
    raise exception 'ref_id_required';
  end if;
  if v_amount <= 0 then
    raise exception 'amount_must_be_positive';
  end if;

  insert into public.profiles (user_id, credits)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select * into v_profile
    from public.profiles
    where user_id = p_user_id
    for update;

  select * into v_existing
    from public.credit_ledger
    where user_id = p_user_id
      and reason = p_reason
      and ref_id = p_ref_id
    order by created_at asc, id asc
    limit 1;
  if found then
    return v_profile;
  end if;

  if v_profile.membership_tier is null
    or v_profile.credit_grant_mode <> 'bundle'
    or (
      v_profile.membership_until is not null
      and v_profile.membership_until <= now()
      and not (
        v_profile.membership_queued_tier is not null
        and v_profile.membership_queued_until is not null
        and v_profile.membership_queued_until > now()
      )
    ) then
    raise exception 'membership_inactive';
  end if;

  if p_period_until is not null and v_profile.bundle_granted_until = p_period_until then
    return v_profile;
  end if;

  update public.profiles
    set credits = credits + v_amount,
        bundle_granted_until = case
          when p_period_until is not null then p_period_until
          else bundle_granted_until
        end
    where user_id = p_user_id
    returning * into v_profile;

  v_meta := coalesce(p_meta, '{}'::jsonb) || jsonb_build_object(
    'operation', 'bundle_grant'
  );
  insert into public.credit_ledger (
    user_id, delta, balance_after, reason, ref_id, meta
  ) values (
    p_user_id, v_amount, v_profile.credits, p_reason, p_ref_id, v_meta
  );

  return v_profile;
end;
$$;

-- Trial activation initializes a daily wallet and membership state together.
-- Rechecking under the row lock prevents two simultaneous trial claims from
-- both refilling the daily allowance.
create or replace function public.claim_trial_membership(
  p_user_id uuid,
  p_membership_until timestamptz,
  p_daily_amount numeric(12, 1)
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_amount numeric(12, 1) := round(coalesce(p_daily_amount, 0), 1);
begin
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;
  if p_membership_until is null then
    raise exception 'membership_until_required';
  end if;
  if v_amount <= 0 then
    raise exception 'amount_must_be_positive';
  end if;

  insert into public.profiles (user_id, credits)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select * into v_profile
    from public.profiles
    where user_id = p_user_id
    for update;

  if coalesce(v_profile.trial_free_used, false) then
    raise exception 'trial_used';
  end if;
  if v_profile.membership_tier is not null
    and (
      v_profile.membership_until is null
      or v_profile.membership_until > now()
      or (
        v_profile.membership_queued_tier is not null
        and v_profile.membership_queued_until is not null
        and v_profile.membership_queued_until > now()
      )
    ) then
    raise exception 'already_member';
  end if;

  update public.profiles
    set membership_tier = 'basic',
        membership_until = p_membership_until,
        credit_grant_mode = 'daily',
        daily_credits = v_amount,
        daily_credits_date = v_today,
        bundle_granted_until = null,
        trial_free_used = true
    where user_id = p_user_id
    returning * into v_profile;

  return v_profile;
end;
$$;

-- Switching credit modes must also serialize with debits/refunds.  Daily
-- credits are deliberately cleared when entering bundle mode, matching the
-- existing route behavior; switching to daily preserves any current-day
-- allowance and only resets the bundle marker.
create or replace function public.set_membership_credit_mode(
  p_user_id uuid,
  p_mode text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_mode text := lower(coalesce(p_mode, ''));
begin
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;
  if v_mode not in ('daily', 'bundle') then
    raise exception 'credit_mode_invalid';
  end if;

  insert into public.profiles (user_id, credits)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select * into v_profile
    from public.profiles
    where user_id = p_user_id
    for update;

  if v_profile.membership_tier is null
    or (
      v_profile.membership_until is not null
      and v_profile.membership_until <= now()
      and not (
        v_profile.membership_queued_tier is not null
        and v_profile.membership_queued_until is not null
        and v_profile.membership_queued_until > now()
      )
    ) then
    raise exception 'membership_inactive';
  end if;
  if v_profile.membership_tier = 'lite' and v_mode = 'bundle' then
    raise exception 'lite_daily_only';
  end if;
  if v_profile.credit_grant_mode = v_mode then
    return v_profile;
  end if;

  update public.profiles
    set credit_grant_mode = v_mode,
        bundle_granted_until = case
          when v_mode = 'daily' then null
          else bundle_granted_until
        end,
        daily_credits = case
          when v_mode = 'bundle' then 0
          else daily_credits
        end,
        daily_credits_date = case
          when v_mode = 'bundle' then null
          else daily_credits_date
        end
    where user_id = p_user_id
    returning * into v_profile;

  return v_profile;
end;
$$;

-- CREATE OR REPLACE preserves existing ACLs. Revoke both inherited PUBLIC
-- access and any direct grants before exposing these definer functions.
revoke all on function public.consume_user_credits(uuid, numeric, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.refund_user_credits(uuid, numeric, text, text, numeric, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.increment_lifetime_credits_spent(uuid, numeric) from public, anon, authenticated;
revoke all on function public.grant_user_daily_credits(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.refresh_user_daily_credits(uuid, numeric) from public, anon, authenticated;
revoke all on function public.grant_membership_bundle(uuid, numeric, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.claim_trial_membership(uuid, timestamptz, numeric) from public, anon, authenticated;
revoke all on function public.set_membership_credit_mode(uuid, text) from public, anon, authenticated;

-- The decimal-credit migrations recreated this SECURITY DEFINER function
-- without first revoking PostgreSQL's default PUBLIC execute privilege.
revoke all on function public.apply_credit_delta(uuid, numeric, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.consume_user_credits(uuid, numeric, text, text, jsonb) to service_role;
grant execute on function public.refund_user_credits(uuid, numeric, text, text, numeric, numeric, jsonb) to service_role;
grant execute on function public.increment_lifetime_credits_spent(uuid, numeric) to service_role;
grant execute on function public.grant_user_daily_credits(uuid, numeric, text) to service_role;
grant execute on function public.refresh_user_daily_credits(uuid, numeric) to service_role;
grant execute on function public.grant_membership_bundle(uuid, numeric, text, text, timestamptz, jsonb) to service_role;
grant execute on function public.claim_trial_membership(uuid, timestamptz, numeric) to service_role;
grant execute on function public.set_membership_credit_mode(uuid, text) to service_role;
grant execute on function public.apply_credit_delta(uuid, numeric, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
