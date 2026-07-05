/**
 * Phase 3 集成测试（针对 pack-media-client.js 生产桥接）
 */
import assert from 'assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const build = spawnSync(process.execPath, ['scripts/build-media-client-bundle.mjs'], {
  cwd: root,
  stdio: 'inherit'
});
if (build.status !== 0) process.exit(build.status || 1);

console.log('🧪 Testing Phase 3 Integration...\n');

let passedTests = 0;
let totalTests = 0;

function runBundleInSandbox(extraWindow = {}) {
  const code = readFileSync(join(root, 'pack-media-client.js'), 'utf8');
  const sandbox = {
    window: { ...extraWindow },
    console,
    setTimeout,
    clearTimeout,
    Map,
    Promise,
    AbortSignal: globalThis.AbortSignal
  };
  vm.runInNewContext(code, sandbox, { filename: 'pack-media-client.js' });
  return sandbox.window;
}

// 测试 1: PromptHubMedia 已挂载
totalTests++;
try {
  const w = runBundleInSandbox();
  assert.ok(w.PromptHubMedia, 'PromptHubMedia should exist');
  assert.strictEqual(w.PromptHubMedia.phase, '2-complete');
  assert.ok(typeof w.PromptHubMedia.prefetchWarehouseCards === 'function');
  assert.ok(typeof w.PromptHubMedia.resolveCardRefs === 'function');
  assert.ok(typeof w.PromptHubMedia.resolveListUrl === 'function');
  assert.ok(typeof w.PromptHubMedia.exportPipeline === 'function');
  assert.ok(typeof w.PromptHubMedia.clearMediaCache === 'function');
  console.log('✅ Test 1 passed: PromptHubMedia boot');
  passedTests++;
} catch (error) {
  console.error('❌ Test 1 failed:', error.message);
}

// 测试 2: prefetch 委托 SupabaseSync
totalTests++;
try {
  let called = false;
  const w = runBundleInSandbox({
    SupabaseSync: {
      isLoggedIn: () => true,
      prefetchCardsImages: async (cards, capMs) => {
        called = true;
        assert.ok(Array.isArray(cards));
        assert.ok(capMs >= 800);
      }
    }
  });
  const r = await w.PromptHubMedia.prefetchWarehouseCards([{ id: 'c1', image: 'storage://x/y.jpg' }], { capMs: 2000 });
  assert.ok(called, 'should call SupabaseSync.prefetchCardsImages');
  assert.strictEqual(r.ok, true);
  console.log('✅ Test 2 passed: prefetch delegates to SupabaseSync');
  passedTests++;
} catch (error) {
  console.error('❌ Test 2 failed:', error.message);
}

// 测试 3: resolveCardRefs 返回 Map
totalTests++;
try {
  const w = runBundleInSandbox({
    SupabaseSync: {
      isLoggedIn: () => true,
      prefetchCardsImages: async () => {},
      getListDisplayImageSrc: (ref) => (ref === 'storage://u/a.jpg' ? 'https://cdn/a_grid.jpg' : ''),
      getCachedDisplayUrl: () => ''
    }
  });
  const map = await w.PromptHubMedia.resolveCardRefs([
    { id: 'c1', image: 'storage://u/a.jpg', prompt: 'test' }
  ]);
  assert.ok(map instanceof Map);
  assert.strictEqual(map.get('storage://u/a.jpg')?.url, 'https://cdn/a_grid.jpg');
  console.log('✅ Test 3 passed: resolveCardRefs');
  passedTests++;
} catch (error) {
  console.error('❌ Test 3 failed:', error.message);
}

// 测试 4: MediaCache
totalTests++;
try {
  const w = runBundleInSandbox();
  const cache = new w.PromptHubMedia.MediaCache();
  cache.set('storage://test.jpg', 'https://signed.url', 'grid');
  assert.strictEqual(cache.get('storage://test.jpg', 'grid'), 'https://signed.url');
  cache.clear();
  assert.ok(!cache.has('storage://test.jpg', 'grid'));
  console.log('✅ Test 4 passed: MediaCache');
  passedTests++;
} catch (error) {
  console.error('❌ Test 4 failed:', error.message);
}

// 测试 5: 工具函数
totalTests++;
try {
  const w = runBundleInSandbox();
  const { isDisplayableImage, normalizeGenJobBaseId } = w.PromptHubMedia;
  assert.ok(isDisplayableImage('https://example.com/image.jpg'));
  assert.ok(isDisplayableImage('storage://test.jpg'));
  assert.ok(!isDisplayableImage(''));
  assert.strictEqual(normalizeGenJobBaseId('mj-123#2'), 'mj-123');
  assert.strictEqual(normalizeGenJobBaseId('job-456_v2'), 'job-456_v2');
  console.log('✅ Test 5 passed: Utility functions');
  passedTests++;
} catch (error) {
  console.error('❌ Test 5 failed:', error.message);
}

// 测试 6: CardSchema
totalTests++;
try {
  const w = runBundleInSandbox();
  const result = w.PromptHubMedia.CardSchema.safeParse({
    id: 'test-1',
    prompt: 'A beautiful landscape'
  });
  assert.ok(result.success);
  console.log('✅ Test 6 passed: CardSchema');
  passedTests++;
} catch (error) {
  console.error('❌ Test 6 failed:', error.message);
}

// 测试 7: exportPipeline / ingestSignedBatch
totalTests++;
try {
  const w = runBundleInSandbox();
  w.PromptHubMedia.ingestSignedBatch({ 'user/a.jpg': 'https://cdn/a_grid.jpg' }, 'grid');
  const cache = w.PromptHubMedia.facade.cache;
  assert.strictEqual(
    cache.get('storage://card-images/user/a.jpg', 'grid'),
    'https://cdn/a_grid.jpg'
  );
  const pipe = w.PromptHubMedia.exportPipeline();
  assert.strictEqual(pipe.VARIANT_LIST, 'grid');
  assert.ok(typeof pipe.resolveListUrl === 'function');
  console.log('✅ Test 7 passed: exportPipeline + ingestSignedBatch');
  passedTests++;
} catch (error) {
  console.error('❌ Test 7 failed:', error.message);
}

if (passedTests === totalTests) {
  console.log('🎉 All tests passed!\n');
  process.exit(0);
} else {
  console.log('⚠️  Some tests failed!\n');
  process.exit(1);
}
