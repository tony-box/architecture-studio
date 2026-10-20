// Regenerates preview/index.html from the studio template with the example model embedded,
// so the demo preview is the real studio rather than a drawing of it.
//
//   node scripts/build-preview.mjs          # write
//   node scripts/build-preview.mjs --check  # fail if stale
import fs from 'node:fs';
import path from 'node:path';
import { SKILL_ROOT, TEMPLATE_PATH, embedData, isMain, readJson } from './lib.mjs';

const PREVIEW_PATH = path.join(SKILL_ROOT, 'preview', 'index.html');

export function expectedPreview() {
  const model = readJson(path.join(SKILL_ROOT, 'examples', 'lakeside-barn-residence', 'building.json'));
  return embedData(fs.readFileSync(TEMPLATE_PATH, 'utf8'), { model });
}

function main() {
  const next = expectedPreview();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(PREVIEW_PATH) ? fs.readFileSync(PREVIEW_PATH, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== next.replace(/\r\n/g, '\n')) {
      console.error('preview/index.html is stale. Run scripts/build-preview.mjs to regenerate it.');
      process.exitCode = 1;
      return;
    }
    console.log('preview/index.html is up to date.');
    return;
  }
  fs.writeFileSync(PREVIEW_PATH, next);
  console.log(`Wrote ${path.relative(SKILL_ROOT, PREVIEW_PATH)}.`);
}

if (isMain(import.meta)) main();