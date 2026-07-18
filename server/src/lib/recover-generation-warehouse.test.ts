import { describe, expect, it } from 'vitest';
import { filterWarehouseRepairCardsByJobIds } from './recover-generation-warehouse';

describe('filterWarehouseRepairCardsByJobIds', () => {
  const cards = [
    { id: 'first', genJobId: 'job-aaaaaaaa' },
    { id: 'slot', genJobId: 'job-bbbbbbbb#2' },
    { id: 'text-only' },
    { id: 'last', genJobId: 'job-cccccccc' }
  ];

  it('keeps the normal repair scan unchanged when no job ids are provided', () => {
    expect(filterWarehouseRepairCardsByJobIds(cards)).toBe(cards);
  });

  it('selects the requested job even when its card is not at the start of the payload', () => {
    expect(filterWarehouseRepairCardsByJobIds(cards, ['job-cccccccc'])).toEqual([
      { id: 'last', genJobId: 'job-cccccccc' }
    ]);
  });

  it('matches gallery slot job ids by their base id', () => {
    expect(filterWarehouseRepairCardsByJobIds(cards, ['job-bbbbbbbb'])).toEqual([
      { id: 'slot', genJobId: 'job-bbbbbbbb#2' }
    ]);
  });
});
