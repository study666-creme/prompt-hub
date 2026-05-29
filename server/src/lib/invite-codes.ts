import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from './supabase';
import { getOrCreateProfile } from './supabase';
import { extendMembershipDays } from './membership-tasks';
import { syncMembershipCredits } from './membership-credits';

export function generateInviteCode(userId: string, salt = ''): string {
  const raw = `${userId}${salt}`.replace(/-/g, '').toUpperCase();
  let mix = 0;
  for (let i = 0; i < raw.length; i++) {
    mix = (mix * 33 + raw.charCodeAt(i)) >>> 0;
  }
  const tail = mix.toString(36).toUpperCase().padStart(4, '0').slice(0, 4);
  return `PH${raw.slice(0, 2)}${tail}`.slice(0, 8);
}

export async function ensureInviteCode(
  admin: SupabaseClient,
  profile: Profile
): Promise<string> {
  const existing = (profile as Profile & { invite_code?: string | null }).invite_code;
  if (existing && String(existing).trim()) return String(existing).trim().toUpperCase();

  let code = generateInviteCode(profile.user_id);
  for (let i = 0; i < 5; i++) {
    const { error } = await admin
      .from('profiles')
      .update({ invite_code: code })
      .eq('user_id', profile.user_id)
      .is('invite_code', null);
    if (!error) return code;
    if (error.code !== '23505') throw error;
    code = generateInviteCode(`${profile.user_id}:${i}`);
  }
  const refreshed = await getOrCreateProfile(admin, profile.user_id);
  const finalCode = (refreshed as Profile & { invite_code?: string | null }).invite_code;
  return finalCode ? String(finalCode).toUpperCase() : code;
}

export async function findProfileByInviteCode(
  admin: SupabaseClient,
  rawCode: string
): Promise<(Profile & { invite_code?: string | null }) | null> {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return null;
  const { data, error } = await admin
    .from('profiles')
    .select('*')
    .eq('invite_code', code)
    .maybeSingle();
  if (error) throw error;
  return data as (Profile & { invite_code?: string | null }) | null;
}

export async function redeemInviteCode(
  admin: SupabaseClient,
  inviteeId: string,
  rawCode: string
): Promise<{ message: string; profile: Profile }> {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) throw new Error('invalid_code');

  let invitee = await getOrCreateProfile(admin, inviteeId);
  const referredBy = (invitee as Profile & { referred_by?: string | null }).referred_by;
  if (referredBy) throw new Error('already_redeemed');

  const inviter = await findProfileByInviteCode(admin, code);
  if (!inviter) throw new Error('invalid_code');
  if (inviter.user_id === inviteeId) throw new Error('self_invite');

  const { error: insErr } = await admin.from('invite_redemptions').insert({
    inviter_id: inviter.user_id,
    invitee_id: inviteeId,
    invite_code: code
  });
  if (insErr) {
    if (insErr.code === '23505') throw new Error('already_redeemed');
    throw insErr;
  }

  await admin
    .from('profiles')
    .update({ referred_by: inviter.user_id })
    .eq('user_id', inviteeId);

  const rewardCredits = 50;
  const rewardDays = 1;

  for (const uid of [inviteeId, inviter.user_id]) {
    let p = await getOrCreateProfile(admin, uid);
    p = await extendMembershipDays(admin, p, rewardDays, 'basic');
    if (rewardCredits > 0) {
      const { error: creditErr } = await admin.rpc('apply_credit_delta', {
        p_user_id: uid,
        p_delta: rewardCredits,
        p_reason: 'invite_redeem',
        p_ref_id: `${inviteeId}:${inviter.user_id}`,
        p_meta: { code, role: uid === inviteeId ? 'invitee' : 'inviter' }
      });
      if (creditErr) throw creditErr;
    }
  }

  const { error: claimErr } = await admin.from('membership_task_claims').insert({
    user_id: inviteeId,
    task_key: 'redeem_invite_code',
    reward_days: rewardDays,
    reward_credits: rewardCredits,
    meta: { code, inviterId: inviter.user_id }
  });
  if (claimErr && claimErr.code !== '23505') throw claimErr;

  invitee = await syncMembershipCredits(admin, inviteeId);
  return {
    message: `邀请成功！你与邀请人各获得 ${rewardDays} 天基础会员 + ${rewardCredits} 积分`,
    profile: invitee
  };
}
