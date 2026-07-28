-- Keep legacy reward and payment callers retry-safe. All wallet writers lock
-- the profile row, so checking the ledger under the same lock serializes two
-- requests that carry the same operation reference.
create or replace function public.apply_credit_delta(
  p_user_id uuid,
  p_delta numeric(12, 1),
  p_reason text,
  p_ref_id text default null,
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
  v_delta numeric(12, 1) := round(coalesce(p_delta, 0), 1);
  v_new_balance numeric(12, 1);
begin
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required';
  end if;
  if v_delta = 0 then
    raise exception 'delta_cannot_be_zero';
  end if;

  insert into public.profiles (user_id, credits)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select * into v_profile
    from public.profiles
    where user_id = p_user_id
    for update;

  if p_ref_id is not null then
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
  end if;

  v_new_balance := coalesce(v_profile.credits, 0) + v_delta;
  if v_new_balance < 0 then
    raise exception 'insufficient_credits';
  end if;

  update public.profiles
    set credits = v_new_balance
    where user_id = p_user_id
    returning * into v_profile;

  insert into public.credit_ledger (
    user_id, delta, balance_after, reason, ref_id, meta
  ) values (
    p_user_id, v_delta, v_new_balance, p_reason, p_ref_id, coalesce(p_meta, '{}'::jsonb)
  );

  return v_profile;
end;
$$;

revoke all on function public.apply_credit_delta(uuid, numeric, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_credit_delta(uuid, numeric, text, text, jsonb)
  to service_role;

notify pgrst, 'reload schema';
