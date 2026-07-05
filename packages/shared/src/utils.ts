/**
 * 共享工具函数
 */

/**
 * 检查是否为可显示的图片 URL
 */
export function isDisplayableImage(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith('http') || url.startsWith('storage://') || url.startsWith('data:');
}

/**
 * 规范化生图任务 ID（去掉槽位后缀）
 * 例如：mj-123#2 -> mj-123
 */
export function normalizeGenJobBaseId(jobId: string | null | undefined): string | null {
  if (!jobId) return null;
  return String(jobId).replace(/#\d+$/, '');
}

/**
 * 从 Storage 路径提取用户 UUID
 * 例如：storage://card-images/abc-123/card.jpg -> abc-123
 */
export function extractUuidFromStoragePath(path: string): string | null {
  const match = path.match(/storage:\/\/card-images\/([^\/]+)/);
  return match ? match[1] : null;
}

/**
 * 检查是否为 Storage 路径
 */
export function isStoragePath(ref: string): boolean {
  return ref.startsWith('storage://');
}

/**
 * 构建 Storage 路径
 */
export function buildStoragePath(userId: string, filename: string): string {
  return `storage://card-images/${userId}/${filename}`;
}

/**
 * 从邮箱提取显示名
 * 例如：user@example.com -> user
 */
export function extractDisplayName(email: string): string {
  return email.split('@')[0];
}