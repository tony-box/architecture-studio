// Regenerates preview/index.html from the studio template with the example model embedded,
// so the marketplace preview is the real studio rather than a drawing of it.
//
//   node --experimental-strip-types scripts/build-preview.ts          # write
//   node --experimental-strip-types scripts/build-preview.ts --check  # fail if stale
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMBED_SLOT = '<script type="application/json" id="embedded-model"></script>';

export function buildPreview(template: string, model: unknown): string {
  const occurrences = template.split(EMBED_SLOT).length - 1;
  if (occurrences !== 1) throw new Error(`Expected exactly one embedded-model slot in the template, found ${occurrences}.`);
  // Escaping "<" keeps the JSON from closing its script element.
  const json = JSON.stringify(model).replace(/</g, '\\u003c');
  return template.replace(EMBED_SLOT, `<script type="application/json" id="embedded-model">${json}</script>`);
}

export function expectedPreview(): string {
  const template = fs.readFileSync(path.join(pluginRoot, 'assets', 'studio-template.html'), 'utf8');
  const model = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'examples', 'lakeside-barn-residence', 'building.json'), 'utf8'));
  return buildPreview(template, model);
}

function main() {
  const target = path.join(pluginRoot, 'preview', 'index.html');
  const next = expectedPreview();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== next.replace(/\r\n/g, '\n')) {
      console.error('preview/index.html is stale. Run scripts/build-preview.ts to regenerate it.');
      process.exitCode = 1;
      return;
    }
    console.log('preview/index.html is up to date.');
    return;
  }
  fs.writeFileSync(target, next);
  console.log(`Wrote ${path.relative(pluginRoot, target)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
