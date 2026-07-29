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

function stripPrivateOperations(source, entry) {
  const startPrefix = '/* __PROMPT_HUB_PRIVATE_OPS_START__ ';
  const endPrefix = '/* __PROMPT_HUB_PRIVATE_OPS_END__ ';
  let output = '';
  let cursor = 0;
  let removed = 0;

  while (true) {
    const start = source.indexOf(startPrefix, cursor);
    if (start < 0) {
      output += source.slice(cursor);
      break;
    }
    output += source.slice(cursor, start);
    const startLabelEnd = source.indexOf(' */', start + startPrefix.length);
    if (startLabelEnd < 0) throw new Error(`${entry} has an unterminated private operations start marker`);
    const label = source.slice(start + startPrefix.length, startLabelEnd);
    const endMarker = `${endPrefix}${label} */`;
    const end = source.indexOf(endMarker, startLabelEnd + 3);
    if (end < 0) throw new Error(`${entry} is missing private operations end marker for ${label}`);
    cursor = end + endMarker.length;
    removed += 1;
  }

  if (output.includes(startPrefix) || output.includes(endPrefix)) {
    throw new Error(`${entry} still contains private operations markers after filtering`);
  }
  return { source: output, removed };
}

async function bundleJavaScript(entry, relativeDir) {
  const { dir, files } = await partFiles(relativeDir, 'js');
  const sources = await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')));
  const filtered = stripPrivateOperations(sources.join('\n'), entry);
  const output = [
    `/* __PROMPT_HUB_DEPLOY_BUNDLE__ ${entry} */`,
    filtered.source,
    `//# sourceURL=${entry}.pages-runtime.js`,
    ''
  ].join('\n');
  const expectedPrivateBlocks = entry === 'script.js' ? 3 : 0;
  if (filtered.removed !== expectedPrivateBlocks) {
    throw new Error(`${entry} removed ${filtered.removed} private operations blocks; expected ${expectedPrivateBlocks}`);
  }
  if (entry === 'script.js') {
    for (const privateToken of [
      'planApimartRecovery',
      'importApimartRecoveryFromPlan',
      'runServerApimartImport'
    ]) {
      if (output.includes(privateToken)) {
        throw new Error(`${entry} public deployment bundle still contains private operation ${privateToken}`);
      }
    }
  }
  try {
    new Function(output);
  } catch (error) {
    error.message = `${entry} deployment bundle parse failed: ${error.message}`;
    throw error;
  }
  await writeFile(join(staging, entry), output, 'utf8');
  return { entry, parts: files.length, bytes: Buffer.byteLength(output), privateBlocksRemoved: filtered.removed };
}

async function bundleCss(entry, relativeDir) {
  const { dir, files } = await partFiles(relativeDir, 'css');
  const sources = await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')));
  const output = [
    `/* __PROMPT_HUB_DEPLOY_BUNDLE__ ${entry} */`,
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
results.push(await bundleJavaScript('admin.js', 'legacy/admin'));
results.push(await bundleJavaScript('asset-studio.js', 'legacy/asset-studio'));
results.push(await bundleJavaScript('features-assets.js', 'legacy/features-assets'));
results.push(await bundleJavaScript('supabase-sync.js', 'legacy/supabase-sync'));
results.push(await bundleJavaScript('script.js', 'legacy/script'));
results.push(await bundleJavaScript('features-draft.js', 'legacy/features-draft'));
results.push(await bundleCss('styles.css', 'styles/base'));
results.push(await bundleCss('styles-features.css', 'styles/features'));
results.push(await inlineIndexBody());

for (const result of results) {
  const privateNote = result.privateBlocksRemoved
    ? `, ${result.privateBlocksRemoved} private operations blocks removed`
    : '';
  console.log(
    `pages-runtime: ${result.entry} <= ${result.parts} parts (${Math.round(result.bytes / 1024)} KiB${privateNote})`
  );
}
