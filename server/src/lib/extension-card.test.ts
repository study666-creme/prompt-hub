import { describe, expect, it } from 'vitest';
import { appendQuickCard, extensionCardFromRecord } from './extension-card';

describe('Prompt Hub card projection for Canvas', () => {
  it('projects only the fields Canvas needs without exposing custom metadata', () => {
    const card = extensionCardFromRecord({
      id: 'card_123',
      title: '标题',
      prompt: '提示词',
      image: 'storage://card-images/user/generated/job.png',
      tags: ['#产品'],
      group: '灵感',
      genJobId: '11111111-1111-4111-8111-111111111111',
      customFields: { privateNote: 'must-not-leak' },
      updatedAt: 123
    });

    expect(card).toEqual({
      id: 'card_123',
      title: '标题',
      prompt: '提示词',
      imageRef: 'storage://card-images/user/generated/job.png',
      imageRefs: [],
      hasImage: true,
      tags: ['#产品'],
      group: '灵感',
      genJobId: '11111111-1111-4111-8111-111111111111',
      isMidjourney: false,
      updatedAt: 123
    });
    expect(card).not.toHaveProperty('customFields');
  });

  it('exposes the full gallery refs so Canvas can collect every image', () => {
    const cover = 'storage://card-images/user/generated/a.png';
    const second = 'storage://card-images/user/generated/b.png';
    const third = 'storage://card-images/user/generated/c.png';

    const mj = extensionCardFromRecord({
      id: 'card_mj',
      title: 'MJ 四图',
      prompt: 'p',
      isMidjourney: true,
      mjCompositeUrl: cover,
      mjGridUrls: [second, third],
      updatedAt: 5
    });
    expect(mj).toMatchObject({ imageRef: cover, imageRefs: [second, third] });

    const gallery = extensionCardFromRecord({
      id: 'card_gallery',
      title: '多图画廊',
      prompt: 'p',
      image: cover,
      cardImages: [cover, second, third, ''],
      updatedAt: 6
    });
    expect(gallery).toMatchObject({ imageRef: cover, imageRefs: [second, third] });
  });

  it('rejects empty records instead of creating unusable deep-link payloads', () => {
    expect(extensionCardFromRecord({ id: 'empty' })).toBeNull();
    expect(extensionCardFromRecord({ prompt: 'missing id' })).toBeNull();
  });

  it('replays the same Canvas result without adding a duplicate card', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    let payload: Record<string, unknown> = { cards: [], schemaVersion: 2 };
    let writes = 0;
    const admin = {
      from(table: string) {
        if (table !== 'user_data') throw new Error(`unexpected table ${table}`);
        const query = {
          select() { return query; },
          eq() { return query; },
          async maybeSingle() { return { data: { data: payload }, error: null }; },
          async upsert(row: { data: Record<string, unknown> }) {
            payload = row.data;
            writes += 1;
            return { error: null };
          }
        };
        return query;
      }
    };
    const input = {
      prompt: '一只玻璃茶壶',
      imageRef: `storage://card-images/${userId}/generated/job.png`,
      cardId: 'canvas_job_1',
      sourceKey: 'canvas-result:job-1:0',
      genJobId: 'job-1',
      tags: ['图片生成', '无限画布'],
      publishToCommunity: false
    };

    const first = await appendQuickCard(admin as never, userId, { storage_bytes: 0 } as never, input);
    const second = await appendQuickCard(admin as never, userId, { storage_bytes: 0 } as never, input);

    expect(first).toMatchObject({ cardId: 'canvas_job_1', cardCount: 1, replayed: false });
    expect(second).toMatchObject({ cardId: 'canvas_job_1', cardCount: 1, replayed: true });
    expect((payload.cards as unknown[])).toHaveLength(1);
    expect(writes).toBe(1);
  });

  it('replays a legacy generated card by job id even when it has no Canvas source key', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const existing = {
      id: 'legacy_generated_card',
      prompt: '旧版自动入库结果',
      image: `storage://card-images/${userId}/generated/job.png`,
      genJobId: 'job-legacy#0',
      customFields: {}
    };
    let writes = 0;
    const admin = {
      from(table: string) {
        if (table !== 'user_data') throw new Error(`unexpected table ${table}`);
        const query = {
          select() { return query; },
          eq() { return query; },
          async maybeSingle() { return { data: { data: { cards: [existing] } }, error: null }; },
          async upsert() {
            writes += 1;
            return { error: null };
          }
        };
        return query;
      }
    };

    const result = await appendQuickCard(
      admin as never,
      userId,
      { storage_bytes: 0 } as never,
      {
        prompt: '同一个任务',
        imageRef: `storage://card-images/${userId}/generated/job.png`,
        sourceKey: 'canvas-result:job-legacy:0',
        genJobId: 'job-legacy',
        publishToCommunity: false
      }
    );

    expect(result).toMatchObject({ cardId: 'legacy_generated_card', cardCount: 1, replayed: true });
    expect(writes).toBe(0);
  });
});
