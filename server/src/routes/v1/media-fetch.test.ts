import { describe, expect, it } from 'vitest';
import { isAllowedRemoteUrl } from './media';

describe('media remote fetch allowlist', () => {
  it('allows the New API generated-image content host', () => {
    expect(isAllowedRemoteUrl(
      'https://newapi.prompt-hubs.com/v1/images/content?token=TEMP_TOKEN'
    )).toBe(true);
  });

  it('still requires HTTPS for image fetches', () => {
    expect(isAllowedRemoteUrl(
      'http://newapi.prompt-hubs.com/v1/images/content?token=TEMP_TOKEN'
    )).toBe(false);
  });
});
