/**
 * MediaCache - 媒体 URL 缓存
 * 统一的缓存策略，替代分散的缓存逻辑
 */

type MediaRef = string;
type MediaVariant = 'grid' | 'list' | 'full';

export interface CacheEntry {
  url: string;
  timestamp: number;
  variant: MediaVariant;
}

export class MediaCache {
  private cache = new Map<string, CacheEntry>();
  private readonly TTL = 3600 * 1000; // 1小时

  /**
   * 生成缓存键
   */
  private key(ref: MediaRef, variant: MediaVariant): string {
    return `${ref}::${variant}`;
  }

  /**
   * 获取缓存
   */
  get(ref: MediaRef, variant: MediaVariant): string | null {
    const k = this.key(ref, variant);
    const entry = this.cache.get(k);

    if (!entry) return null;

    // 检查是否过期
    const now = Date.now();
    if (now - entry.timestamp > this.TTL) {
      this.cache.delete(k);
      return null;
    }

    return entry.url;
  }

  /**
   * 设置缓存
   */
  set(ref: MediaRef, url: string, variant: MediaVariant): void {
    const k = this.key(ref, variant);
    this.cache.set(k, {
      url,
      timestamp: Date.now(),
      variant,
    });
  }

  /**
   * 检查是否有缓存
   */
  has(ref: MediaRef, variant: MediaVariant): boolean {
    return this.get(ref, variant) !== null;
  }

  /**
   * 清除缓存
   */
  clear(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }

    // 模式匹配清除
    const regex = new RegExp(pattern);
    const keysToDelete: string[] = [];

    this.cache.forEach((_, key) => {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => this.cache.delete(key));
  }

  /**
   * 获取缓存统计
   */
  stats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}
