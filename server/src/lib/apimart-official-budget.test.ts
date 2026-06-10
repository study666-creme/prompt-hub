import { describe, expect, it } from 'vitest';
import {
  buildApimartOfficialBudgetRequestBody,
  isApimartOfficialBudgetUpstream,
  mapApimartOfficialBudgetRatio
} from './apimart-official-budget';

describe('apimart official budget', () => {
  it('detects gpt-image-2-official upstream', () => {
    expect(isApimartOfficialBudgetUpstream('gpt-image-2-official')).toBe(true);
    expect(isApimartOfficialBudgetUpstream('gpt-image-2')).toBe(false);
  });

  it('maps ratio without 1:1 square', () => {
    expect(mapApimartOfficialBudgetRatio('16:9')).toBe('16:9');
    expect(mapApimartOfficialBudgetRatio('1:1')).toBe('16:9');
  });

  it('sends ratio + resolution + quality low (not pixel size)', () => {
    const body = buildApimartOfficialBudgetRequestBody({
      prompt: 'test',
      resolution: '4k',
      size: '16:9'
    });
    expect(body).toEqual({
      model: 'gpt-image-2-official',
      prompt: 'test',
      size: '16:9',
      resolution: '4k',
      quality: 'low',
      n: 1
    });
    expect(String(body.size)).not.toMatch(/x/i);
  });
});
