import { describe, expect, it } from 'vitest';
import {
  isGrsaiMaintenanceMessage,
  noteGrsaiSubmitOutcome,
  overlayGrsaiUpstreamStatus,
  parseGrsaiModelStatusesFromHtml
} from './grsai-upstream-status';
import type { ImageModelPricingSettings, ResolvedImageModel } from './image-model-settings';

describe('GrsAI upstream status', () => {
  it('detects maintenance messages', () => {
    expect(isGrsaiMaintenanceMessage('模型维护中，请稍后再试')).toBe(true);
    expect(isGrsaiMaintenanceMessage('upstream_failed')).toBe(false);
  });

  it('parses public model page html', () => {
    const html = `
      gpt-image-2-vip
      维护中
      积分消耗
      gpt-image-2
      可用
    `;
    const statuses = parseGrsaiModelStatusesFromHtml(html);
    expect(statuses['gpt-image-2-vip']).toBe('maintenance');
    expect(statuses['gpt-image-2']).toBe('active');
  });

  it('overlays maintenance when upstream is down and admin is active', () => {
    noteGrsaiSubmitOutcome('gpt-image-2-vip', 'maintenance');
    const base = {
      id: 'gpt-image-2-vip',
      provider: 'grsai' as const,
      upstream: 'gpt-image-2-vip',
      label: 'VIP',
      displayLabel: 'VIP',
      status: 'active' as const,
      statusNotice: null,
      enabled: true,
      visible: true,
      followUpstreamMaintenance: true,
      creditsPerCall: 14,
      creditsByResolution: null,
      effectiveCreditsByResolution: null,
      pricingByResolution: false,
      discountPercent: 100,
      effectiveBaseCredits: 14,
      fixedPrice: false,
      memberDiscountCapPercent: null,
      refundOnViolation: true,
      violationNotice: null,
      group: 'classic' as const,
      uiFamily: 'gim2' as const,
      description: '',
      upstreamPoints: 1300,
      resolutions: ['1k', '2k', '4k'] as const,
      defaultCredits: 14,
      sortOrder: 1
    } satisfies ResolvedImageModel;
    const settings: ImageModelPricingSettings = { globalDiscountPercent: 100, models: {} };
    const out = overlayGrsaiUpstreamStatus(base, settings);
    expect(out.status).toBe('maintenance');
    expect(out.enabled).toBe(false);
  });
});
