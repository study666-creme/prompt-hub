-- Worker (service_role) 读写任务领取记录
grant select, insert on public.membership_task_claims to service_role;
