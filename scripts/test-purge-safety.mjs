/**
 * 测试 purgeCreationMedia 的安全性
 * 模拟多设备场景
 *
 * 使用方法：
 * node scripts/test-purge-safety.mjs
 */

import assert from 'assert';

// Mock 全局环境
global.window = {
  __promptHubCards: [],
  __PURGE_DRY_RUN: true,
};

// Mock 函数
function normalizeGenJobBaseId(jobId) {
  if (!jobId) return null;
  return jobId.split('#')[0].split('_')[0];
}

function isDisplayableImage(url) {
  if (!url) return false;
  return url.startsWith('http') || url.startsWith('storage://') || url.startsWith('data:');
}

// 实现 checkCloudCardReferences（待集成到 features-draft.js）
async function checkCloudCardReferences(creation) {
  // 如果未登录，保守起见不删除
  if (!global.window.SupabaseSync?.user) {
    return { hasReferences: true, reason: 'not_logged_in' };
  }

  const base = normalizeGenJobBaseId(creation.jobId);
  if (!base) return { hasReferences: false };

  try {
    // 从云端 user_data.cards 查询
    const cloudData = await global.window.SupabaseSync.pullCloudData();
    const cards = cloudData?.cards || [];

    // 检查是否有卡片引用这个 jobId
    const referenced = cards.some((c) => {
      const cBase = normalizeGenJobBaseId(c.genJobId);
      if (cBase !== base) return false;
      return !!(c.image && isDisplayableImage(c.image));
    });

    if (referenced) {
      return {
        hasReferences: true,
        reason: 'cloud_card_exists',
        details: { jobId: base }
      };
    }

    // 检查是否有卡片通过 storage path 引用
    const refs = new Set();
    [creation.image, creation.mjCompositeUrl, ...(creation.mjGridUrls || [])]
      .forEach(u => { if (u && isDisplayableImage(u)) refs.add(u); });

    for (const ref of refs) {
      const storageReferenced = cards.some(c =>
        c.image === ref ||
        (c.cardImages || []).some(img => img.url === ref || img.path === ref)
      );

      if (storageReferenced) {
        return {
          hasReferences: true,
          reason: 'cloud_storage_path',
          details: { ref }
        };
      }
    }

    return { hasReferences: false };
  } catch (error) {
    console.error('[purge] Cloud check failed:', error);
    // 网络错误时保守处理：不删除
    return { hasReferences: true, reason: 'check_failed', error };
  }
}

// 测试用例
async function runTests() {
  console.log('🧪 Testing purge safety...\n');

  let passedTests = 0;
  let totalTests = 0;

  // 测试 1: 云端有引用（通过 genJobId）
  totalTests++;
  try {
    global.window.SupabaseSync = {
      user: { id: 'test-user' },
      async pullCloudData() {
        return {
          cards: [
            {
              id: 'card-1',
              genJobId: 'job-123#2',
              image: 'storage://card-images/test-user/card-1.jpg'
            }
          ]
        };
      }
    };

    const creation = {
      id: 'creation-1',
      jobId: 'job-123',
      image: 'storage://card-images/test-user/card-1.jpg'
    };

    const result = await checkCloudCardReferences(creation);
    assert.strictEqual(result.hasReferences, true, 'Should detect cloud reference via jobId');
    assert.strictEqual(result.reason, 'cloud_card_exists');

    console.log('✅ Test 1 passed: Cloud reference via genJobId detected');
    passedTests++;
  } catch (error) {
    console.error('❌ Test 1 failed:', error.message);
  }

  // 测试 2: 云端有引用（通过 storage path）
  totalTests++;
  try {
    global.window.SupabaseSync = {
      user: { id: 'test-user' },
      async pullCloudData() {
        return {
          cards: [
            {
              id: 'card-2',
              image: 'storage://card-images/test-user/shared-image.jpg'
            }
          ]
        };
      }
    };

    const creation = {
      id: 'creation-2',
      jobId: 'job-999',
      image: 'storage://card-images/test-user/shared-image.jpg'
    };

    const result = await checkCloudCardReferences(creation);
    assert.strictEqual(result.hasReferences, true, 'Should detect cloud reference via storage path');
    assert.strictEqual(result.reason, 'cloud_storage_path');

    console.log('✅ Test 2 passed: Cloud reference via storage path detected');
    passedTests++;
  } catch (error) {
    console.error('❌ Test 2 failed:', error.message);
  }

  // 测试 3: 无任何引用（可以安全删除）
  totalTests++;
  try {
    global.window.SupabaseSync = {
      user: { id: 'test-user' },
      async pullCloudData() {
        return {
          cards: [
            {
              id: 'card-3',
              genJobId: 'job-456',
              image: 'storage://card-images/test-user/other.jpg'
            }
          ]
        };
      }
    };

    const orphanCreation = {
      id: 'creation-3',
      jobId: 'job-orphan',
      image: 'storage://card-images/test-user/orphan.jpg'
    };

    const result = await checkCloudCardReferences(orphanCreation);
    assert.strictEqual(result.hasReferences, false, 'Should allow deletion of orphan');

    console.log('✅ Test 3 passed: Orphan creation can be safely deleted');
    passedTests++;
  } catch (error) {
    console.error('❌ Test 3 failed:', error.message);
  }

  // 测试 4: 未登录场景（保守处理）
  totalTests++;
  try {
    global.window.SupabaseSync = {
      user: null, // 未登录
      async pullCloudData() {
        throw new Error('Not authenticated');
      }
    };

    const creation = {
      id: 'creation-4',
      jobId: 'job-123',
      image: 'storage://card-images/test-user/card.jpg'
    };

    const result = await checkCloudCardReferences(creation);
    assert.strictEqual(result.hasReferences, true, 'Should be conservative when not logged in');
    assert.strictEqual(result.reason, 'not_logged_in');

    console.log('✅ Test 4 passed: Conservative when not logged in');
    passedTests++;
  } catch (error) {
    console.error('❌ Test 4 failed:', error.message);
  }

  // 测试 5: 网络错误场景（保守处理）
  totalTests++;
  try {
    global.window.SupabaseSync = {
      user: { id: 'test-user' },
      async pullCloudData() {
        throw new Error('Network error');
      }
    };

    const creation = {
      id: 'creation-5',
      jobId: 'job-123',
      image: 'storage://card-images/test-user/card.jpg'
    };

    const result = await checkCloudCardReferences(creation);
    assert.strictEqual(result.hasReferences, true, 'Should be conservative on network error');
    assert.strictEqual(result.reason, 'check_failed');

    console.log('✅ Test 5 passed: Conservative on network error');
    passedTests++;
  } catch (error) {
    console.error('❌ Test 5 failed:', error.message);
  }

  // 测试 6: MJ 多图场景
  totalTests++;
  try {
    global.window.SupabaseSync = {
      user: { id: 'test-user' },
      async pullCloudData() {
        return {
          cards: [
            {
              id: 'card-mj',
              genJobId: 'mj-123#2',
              cardImages: [
                { url: 'storage://card-images/test-user/mj-123-2.jpg' }
              ]
            }
          ]
        };
      }
    };

    const creation = {
      id: 'creation-mj',
      jobId: 'mj-123',
      mjGridUrls: ['storage://card-images/test-user/mj-123-2.jpg']
    };

    const result = await checkCloudCardReferences(creation);
    assert.strictEqual(result.hasReferences, true, 'Should detect MJ grid reference');

    console.log('✅ Test 6 passed: MJ multi-image reference detected');
    passedTests++;
  } catch (error) {
    console.error('❌ Test 6 failed:', error.message);
  }

  // 总结
  console.log(`\n📊 Test Results: ${passedTests}/${totalTests} passed`);

  if (passedTests === totalTests) {
    console.log('🎉 All tests passed!\n');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed!\n');
    process.exit(1);
  }
}

// 运行测试
runTests().catch(error => {
  console.error('💥 Test suite crashed:', error);
  process.exit(1);
});