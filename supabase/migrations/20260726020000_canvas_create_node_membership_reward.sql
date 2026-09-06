-- Canvas first-node reward. The claim marker and membership update must commit
-- together so a retry can never double-grant or leave an unpaid claim behind.

create or replace function public.grant_canvas_create_node_reward(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_claim_id uuid;
  v_now timestamptz := now();
  v_reward_end timestamptz := now() + interval '1 day';
  v_remaining interval;
begin
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;

  insert into public.profiles (user_id, credits)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select * into v_profile
    from public.profiles
    where user_id = p_user_id
    for update;

  if v_profile.membership_tier is not null
    and v_profile.membership_until is not null
    and v_profile.membership_until <= v_now then
    if v_profile.membership_queued_tier is not null
      and v_profile.membership_queued_until is not null
      and v_profile.membership_queued_until > v_now then
      update public.profiles
        set membership_tier = v_profile.membership_queued_tier,
            membership_until = v_profile.membership_queued_until,
            membership_queued_tier = null,
            membership_queued_until = null
        where user_id = p_user_id
        returning * into v_profile;
    else
      update public.profiles
        set membership_tier = null,
            membership_until = null,
            membership_queued_tier = null,
            membership_queued_until = null
        where user_id = p_user_id
        returning * into v_profile;
    end if;
  end if;

  insert into public.membership_task_claims (
    user_id, task_key, reward_days, reward_credits, meta
  ) values (
    p_user_id,
    'canvas_create_node',
    1,
    0,
    jsonb_build_object('title', '在画布创建一个节点', 'source', 'canvas')
  )
  on conflict (user_id, task_key) do nothing
  returning id into v_claim_id;

  if v_claim_id is null then
    update public.profiles
      set membership_task_flags = coalesce(membership_task_flags, '{}'::jsonb)
        || jsonb_build_object('canvas_node_created', true)
      where user_id = p_user_id;
    return jsonb_build_object('granted', false);
  end if;

  if v_profile.membership_tier is null then
    update public.profiles
      set membership_tier = 'basic',
          membership_until = v_reward_end,
          membership_queued_tier = null,
          membership_queued_until = null,
          credit_grant_mode = 'daily',
          bundle_granted_until = null,
          membership_task_flags = coalesce(membership_task_flags, '{}'::jsonb)
            || jsonb_build_object('canvas_node_created', true)
      where user_id = p_user_id;
  elsif v_profile.membership_until is null then
    update public.profiles
      set membership_task_flags = coalesce(membership_task_flags, '{}'::jsonb)
        || jsonb_build_object('canvas_node_created', true)
      where user_id = p_user_id;
  elsif v_profile.membership_tier = 'lite' then
    v_remaining := greatest(v_profile.membership_until - v_now, interval '0 seconds');
    update public.profiles
      set membership_tier = 'basic',
          membership_until = v_reward_end,
          membership_queued_tier = 'lite',
          membership_queued_until = v_reward_end + v_remaining,
          membership_task_flags = coalesce(membership_task_flags, '{}'::jsonb)
            || jsonb_build_object('canvas_node_created', true)
      where user_id = p_user_id;
  elsif v_profile.membership_tier = 'basic' then
    update public.profiles
      set membership_until = v_profile.membership_until + interval '1 day',
          membership_queued_until = case
            when v_profile.membership_queued_tier is not null
              and v_profile.membership_queued_until is not null
              then v_profile.membership_queued_until + interval '1 day'
            else v_profile.membership_queued_until
          end,
          membership_task_flags = coalesce(membership_task_flags, '{}'::jsonb)
            || jsonb_build_object('canvas_node_created', true)
      where user_id = p_user_id;
  elsif v_profile.membership_queued_tier is null
    or v_profile.membership_queued_until is null
    or v_profile.membership_queued_until <= v_profile.membership_until then
    update public.profiles
      set membership_queued_tier = 'basic',
          membership_queued_until = v_profile.membership_until + interval '1 day',
          membership_task_flags = coalesce(membership_task_flags, '{}'::jsonb)
            || jsonb_build_object('canvas_node_created', true)
      where user_id = p_user_id;
  else
    update public.profiles
      set membership_queued_until = v_profile.membership_queued_until + interval '1 day',
          membership_task_flags = coalesce(membership_task_flags, '{}'::jsonb)
            || jsonb_build_object('canvas_node_created', true)
      where user_id = p_user_id;
  end if;

  return jsonb_build_object('granted', true);
end;
$$;

revoke all on function public.grant_canvas_create_node_reward(uuid) from public, anon, authenticated;
grant execute on function public.grant_canvas_create_node_reward(uuid) to service_role;

comment on function public.grant_canvas_create_node_reward(uuid) is
  'Atomically grants the once-only Canvas first-node reward to one account.';
