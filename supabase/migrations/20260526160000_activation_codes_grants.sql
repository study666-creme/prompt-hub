-- service_role / secret key 需能读写激活码（运营造码、API 核销）
grant select, insert, update on public.activation_codes to service_role;
grant select, insert on public.code_redemptions to service_role;
