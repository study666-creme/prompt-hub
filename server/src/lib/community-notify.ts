import type { SupabaseClient } from '@supabase/supabase-js';

export type CommunityNotifyInput = {
  targetUserId: string;
  type: string;
  postId?: string | null;
  postTitle?: string | null;
  message?: string | null;
};

export type CommunityNotifyItem = {
  id: string;
  type: string;
  actorId: string | null;
  actorName: string | null;
  postId: string | null;
  postTitle: string | null;
  message: string | null;
  read: boolean;
  createdAt: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function pushCommunityNotification(
  admin: SupabaseClient,
  actorId: string,
  actorName: string,
  input: CommunityNotifyInput
): Promise<void> {
  const target = String(input.targetUserId || '').trim();
  if (!UUID_RE.test(target) || target === actorId) return;
  const type = String(input.type || '').trim().slice(0, 32);
  if (!type) return;
  const { error } = await admin.from('community_notifications').insert({
    user_id: target,
    type,
    actor_id: actorId,
    actor_name: (actorName || '用户').slice(0, 80),
    post_id: input.postId ? String(input.postId).slice(0, 120) : null,
    post_title: input.postTitle ? String(input.postTitle).slice(0, 120) : null,
    message: input.message ? String(input.message).slice(0, 240) : null,
    read: false
  });
  if (error) throw error;
}

export async function listCommunityNotifications(
  admin: SupabaseClient,
  userId: string,
  limit = 40
): Promise<CommunityNotifyItem[]> {
  const cap = Math.min(80, Math.max(1, limit));
  const { data, error } = await admin
    .from('community_notifications')
    .select('id, type, actor_id, actor_name, post_id, post_title, message, read, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(cap);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: String(row.id),
    type: row.type || '',
    actorId: row.actor_id ? String(row.actor_id) : null,
    actorName: row.actor_name || null,
    postId: row.post_id || null,
    postTitle: row.post_title || null,
    message: row.message || null,
    read: !!row.read,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
  }));
}
