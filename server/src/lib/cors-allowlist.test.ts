import { describe, expect, it } from 'vitest';
import { isAllowedCorsOrigin } from './cors-headers';

// CORS 白名单收紧回归：任意 *.vercel.app 子域和任意 chrome-extension://
// origin 曾被通配放行（credentials: true 下任何第三方页面/扩展都能借已登录
// 身份调 API）。这些分支已删除，这里防止它们被无声加回。
const allowlist = [
  'https://prompt-hubs.com',
  'https://www.prompt-hubs.com',
  'https://infinite-canvas-jay.vercel.app',
  'https://kachang-canvas-next.vercel.app'
];

describe('isAllowedCorsOrigin', () => {
  it('放行白名单内的精确 origin', () => {
    for (const o of allowlist) {
      expect(isAllowedCorsOrigin(o, allowlist)).toBe(true);
    }
  });

  it('放行自有正式域与 pages.dev 预览域', () => {
    expect(isAllowedCorsOrigin('https://prompt-hubs.com', [])).toBe(true);
    expect(isAllowedCorsOrigin('https://www.prompt-hub.cn', [])).toBe(true);
    expect(isAllowedCorsOrigin('https://prod.prompt-hub-hub.pages.dev', [])).toBe(true);
  });

  it('拒绝任意第三方 vercel.app 子域', () => {
    expect(isAllowedCorsOrigin('https://attacker.vercel.app', allowlist)).toBe(false);
    expect(isAllowedCorsOrigin('https://infinite-canvas-jay.evil.vercel.app', allowlist)).toBe(false);
  });

  it('拒绝任意 chrome-extension:// origin（扩展走 host_permissions，不经 CORS）', () => {
    expect(isAllowedCorsOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop/', allowlist)).toBe(false);
    expect(isAllowedCorsOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop/', [])).toBe(false);
  });

  it('拒绝非 https、无效 origin 与不相关域', () => {
    expect(isAllowedCorsOrigin('http://prompt-hubs.com', [])).toBe(false);
    expect(isAllowedCorsOrigin('https://evil.example.com', allowlist)).toBe(false);
    expect(isAllowedCorsOrigin('not a url', allowlist)).toBe(false);
    expect(isAllowedCorsOrigin(undefined, allowlist)).toBe(false);
  });

  it('本机开发地址仅允许 http/https', () => {
    expect(isAllowedCorsOrigin('http://localhost:5500', [])).toBe(true);
    expect(isAllowedCorsOrigin('https://127.0.0.1:5500', [])).toBe(true);
    expect(isAllowedCorsOrigin('ftp://localhost', [])).toBe(false);
  });
});
