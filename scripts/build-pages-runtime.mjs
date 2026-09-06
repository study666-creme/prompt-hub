import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const staging = resolve(process.argv[2] || '');
const expectedStaging = resolve(join(root, '.pages-deploy'));

if (!process.argv[2] || staging !== expectedStaging) {
  throw new Error(`Expected Pages staging directory: ${expectedStaging}`);
}
if (!existsSync(join(staging, 'index.html'))) {
  throw new Error(`Pages staging is incomplete: ${staging}`);
}

async function partFiles(relativeDir, extension) {
  const dir = join(staging, relativeDir);
  const pattern = new RegExp(`^part-\\d+\\.${extension}$`);
  const files = (await readdir(dir)).filter((name) => pattern.test(name)).sort();
  if (!files.length) throw new Error(`No runtime parts found in ${relativeDir}`);
  return { dir, files };
}

async function bundleJavaScript(entry, relativeDir) {
  const { dir, files } = await partFiles(relativeDir, 'js');
  const sources = await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')));
  const output = [
    `/* __PROMPT_HUB_DEPLOY_BUNDLE__ ${entry} from ${relativeDir} */`,
    ...sources,
    `//# sourceURL=${entry}.pages-runtime.js`,
    ''
  ].join('\n');
  try {
    new Function(output);
  } catch (error) {
    error.message = `${entry} deployment bundle parse failed: ${error.message}`;
    throw error;
  }
  await writeFile(join(staging, entry), output, 'utf8');
  return { entry, parts: files.length, bytes: Buffer.byteLength(output) };
}

async function bundleCss(entry, relativeDir) {
  const { dir, files } = await partFiles(relativeDir, 'css');
  const sources = await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')));
  const output = [
    `/* __PROMPT_HUB_DEPLOY_BUNDLE__ ${entry} from ${relativeDir} */`,
    ...sources,
    ''
  ].join('\n');
  await writeFile(join(staging, entry), output, 'utf8');
  return { entry, parts: files.length, bytes: Buffer.byteLength(output) };
}

async function inlineIndexBody() {
  const indexPath = join(staging, 'index.html');
  const index = await readFile(indexPath, 'utf8');
  const { dir, files } = await partFiles('partials/index-body', 'html');
  const body = (await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))).join('');
  const loaderPattern = /[ \t]*<script>\s*window\.__PROMPT_HUB_INDEX_BODY_PARTIAL__\s*=\s*true;[\s\S]*?<\/script>/g;
  const matches = [...index.matchAll(loaderPattern)];
  if (matches.length !== 1) {
    throw new Error(`Expected one index body loader, found ${matches.length}`);
  }
  const marker = `\n  <!-- __PROMPT_HUB_DEPLOY_BODY__ ${files.length} inlined parts -->\n`;
  const output = index.replace(loaderPattern, `${marker}${body}`);
  await writeFile(indexPath, output, 'utf8');
  return { entry: basename(indexPath), parts: files.length, bytes: Buffer.byteLength(output) };
}

const results = [];
results.push(await bundleJavaScript('supabase-sync.js', 'legacy/supabase-sync'));
results.push(await bundleJavaScript('script.js', 'legacy/script'));
results.push(await bundleJavaScript('features-draft.js', 'legacy/features-draft'));
results.push(await bundleCss('styles.css', 'styles/base'));
results.push(await bundleCss('styles-features.css', 'styles/features'));
results.push(await inlineIndexBody());

for (const result of results) {
  console.log(
    `pages-runtime: ${result.entry} <= ${result.parts} parts (${Math.round(result.bytes / 1024)} KiB)`
  );
}
