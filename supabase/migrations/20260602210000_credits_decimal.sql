-- 积分支持 0.1 精度（会员 95/90/85 折：10 积分 → 9.5 / 9.0 / 8.5）
-- 在 Supabase SQL 编辑器执行本文件（已上线环境执行一次即可）

drop function if exists public.apply_credit_delta(uuid, integer, text, text, jsonb);

alter table public.profiles
  alter column credits type numeric(12, 1) using credits::numeric(12, 1),
  alter column daily_credits type numeric(12, 1) using daily_credits::numeric(12, 1),
  alter column lifetime_credits_spent type numeric(12, 1) using lifetime_credits_spent::numeric(12, 1);

alter table public.credit_ledger
  alter column delta type numeric(12, 1) using delta::numeric(12, 1),
  alter column balance_after type numeric(12, 1) using balance_after::numeric(12, 1);

alter table public.generation_requests
  alter column credits_charged type numeric(12, 1) using credits_charged::numeric(12, 1);

alter table public.activation_codes
  alter column credits type numeric(12, 1) using credits::numeric(12, 1);

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
  v_new_balance numeric(12, 1);
begin
  if p_delta = 0 then
    raise exception 'delta cannot be zero';
  end if;

  insert into public.profiles (user_id, credits)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select * into v_profile from public.profiles where user_id = p_user_id for update;

  v_new_balance := v_profile.credits + p_delta;
  if v_new_balance < 0 then
    raise exception 'insufficient_credits';
  end if;

  update public.profiles
  set credits = v_new_balance
  where user_id = p_user_id
  returning * into v_profile;

  insert into public.credit_ledger (user_id, delta, balance_after, reason, ref_id, meta)
  values (p_user_id, p_delta, v_new_balance, p_reason, p_ref_id, p_meta);

  return v_profile;
end;
$$;

grant execute on function public.apply_credit_delta(uuid, numeric, text, text, jsonb) to service_role;
