// @ts-expect-error Vitest uses Node; the production Worker tsconfig excludes Node types.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const wranglerConfig = readFileSync(
  new URL('../wrangler.toml', (import.meta as { url: string }).url),
  'utf8'
);

describe('production runtime configuration', () => {
  it('routes New API through the stable service hostname', () => {
    const configuredOrigin = wranglerConfig.match(
      /^NEWAPI_API_BASE_URL\s*=\s*"([^"]+)"/m
    )?.[1];

    expect(configuredOrigin).toBe('https://newapi.prompt-hubs.com');
    expect(new URL(configuredOrigin!).hostname).not.toMatch(/(?:sslip\.io|^\d+(?:\.\d+){3}$)/i);
  });
});
