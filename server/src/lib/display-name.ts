/** 社区显示名：注册可选填，未填则在首次 /me 时自动生成 */
export function defaultDisplayName(userId: string): string {
  return '用户_' + userId.replace(/-/g, '').slice(0, 8);
}

export function normalizeDisplayName(input: unknown): string | null {
  const s = String(input ?? '').trim();
  if (s.length < 2 || s.length > 20) return null;
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_\-]+$/.test(s)) return null;
  return s;
}

export function resolveDisplayName(
  profile: { display_name?: string | null; user_id: string }
): string {
  const name = String(profile.display_name || '').trim();
  return name || defaultDisplayName(profile.user_id);
}
