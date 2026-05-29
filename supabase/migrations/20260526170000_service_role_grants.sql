-- Worker (service_role) 兑换/扣费所需表权限
grant select, insert, update on public.profiles to service_role;
grant select, insert on public.credit_ledger to service_role;
grant select, insert, update on public.activation_codes to service_role;
grant select, insert on public.code_redemptions to service_role;
grant select, insert, update on public.generation_requests to service_role;
grant select, insert on public.membership_task_claims to service_role;

grant execute on function public.apply_credit_delta(uuid, integer, text, text, jsonb) to service_role;
