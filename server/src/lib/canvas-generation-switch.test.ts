import { describe, expect, it } from 'vitest';
import { assertCanvasGenerationEnabled } from './canvas-generation-switch';

describe('canvas generation kill switch', () => {
  it('rejects canvas submissions when the switch is on, before any pricing or debit', () => {
    expect(() => assertCanvasGenerationEnabled(
      { CANVAS_GENERATION_DISABLED: 'true' },
      'canvas'
    )).toThrowError(expect.objectContaining({
      status: 503,
      code: 'GENERATION_DISABLED'
    }));
  });

  it('keeps prompt-hub-native submissions working while the switch is on', () => {
    expect(() => assertCanvasGenerationEnabled({ CANVAS_GENERATION_DISABLED: 'true' }, undefined)).not.toThrow();
    expect(() => assertCanvasGenerationEnabled({ CANVAS_GENERATION_DISABLED: 'true' }, 'hub')).not.toThrow();
  });

  it('does nothing when the switch is off', () => {
    expect(() => assertCanvasGenerationEnabled({}, 'canvas')).not.toThrow();
    expect(() => assertCanvasGenerationEnabled({ CANVAS_GENERATION_DISABLED: 'false' }, 'canvas')).not.toThrow();
  });
});
