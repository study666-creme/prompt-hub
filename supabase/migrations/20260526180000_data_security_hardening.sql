-- 数据安全加固：收回 anon 权限、禁止客户端篡改积分/流水/激活码/生图记录

revoke all on public.profiles from anon;
revoke all on public.credit_ledger from anon;
revoke all on public.activation_codes from anon;
revoke all on public.code_redemptions from anon;
revoke all on public.generation_requests from anon;
revoke all on public.user_data from anon;

-- user_data：仅本人可读写（重申，并移除误开的公开读策略）
alter table public.user_data enable row level security;

drop policy if exists "Enable read access for all users" on public.user_data;
drop policy if exists "Public read access" on public.user_data;
drop policy if exists "user_data_select_own" on public.user_data;
drop policy if exists "user_data_insert_own" on public.user_data;
drop policy if exists "user_data_update_own" on public.user_data;
drop policy if exists "user_data_delete_own" on public.user_data;
drop policy if exists "user_data_owner_all" on public.user_data;

create policy "user_data_owner_all"
  on public.user_data
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.user_data to authenticated;

-- profiles：客户端只读自己的行，禁止直接改积分/会员
drop policy if exists "profiles_insert_deny" on public.profiles;
create policy "profiles_insert_deny"
  on public.profiles for insert to authenticated
  with check (false);

drop policy if exists "profiles_update_deny_client" on public.profiles;
create policy "profiles_update_deny_client"
  on public.profiles for update to authenticated
  using (false);

-- 流水、生图、兑换记录：仅服务端写入
drop policy if exists "credit_ledger_insert_deny" on public.credit_ledger;
create policy "credit_ledger_insert_deny"
  on public.credit_ledger for insert to authenticated
  with check (false);

drop policy if exists "generation_requests_insert_deny" on public.generation_requests;
create policy "generation_requests_insert_deny"
  on public.generation_requests for insert to authenticated
  with check (false);

drop policy if exists "code_redemptions_insert_deny" on public.code_redemptions;
create policy "code_redemptions_insert_deny"
  on public.code_redemptions for insert to authenticated
  with check (false);

-- 激活码表：客户端完全不可见
drop policy if exists "activation_codes_deny_all" on public.activation_codes;
create policy "activation_codes_deny_all"
  on public.activation_codes for all
  using (false);
