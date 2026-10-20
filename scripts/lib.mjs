// Helpers shared by the Architecture Studio scripts. Node built-ins only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATE_PATH = path.join(SKILL_ROOT, 'assets', 'studio-template.html');

// Parses `--key value` and bare `--flag` arguments. Positional arguments land in `_`.
export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) { args._.push(key); continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key.slice(2)] = true;
    else { args[key.slice(2)] = next; i += 1; }
  }
  return args;
}

export function isMain(meta) {
  return Boolean(process.argv[1]) && meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

export function skillVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'package.json'), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// The project's own index.html wins so a project keeps rendering with the viewer it was created with.
export function resolveStudioPage(projectDir, explicitPage) {
  const candidates = [explicitPage ? path.resolve(explicitPage) : null, path.join(projectDir, 'index.html'), TEMPLATE_PATH].filter(Boolean);
  const page = candidates.find(candidate => fs.existsSync(candidate));
  if (!page) throw new Error(`No studio page found. Run scripts/init.mjs on ${projectDir} first.`);
  return page;
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function printFindings(findings, stream = console.error) {
  for (const finding of findings) stream(`- ${finding.code}: ${finding.message}${finding.entityId ? ` (${finding.entityId})` : ''}`);
}

const SLOTS = {
  model: '<script type="application/json" id="embedded-model"></script>',
  codeFindings: '<script type="application/json" id="embedded-code-findings"></script>'
};

// Fills the studio page's empty JSON slots so it renders without fetching anything.
export function embedData(html, data) {
  let out = html;
  for (const [key, slot] of Object.entries(SLOTS)) {
    if (data[key] === undefined) continue;
    const occurrences = out.split(slot).length - 1;
    if (occurrences !== 1) throw new Error(`Expected exactly one ${key} slot in the studio page, found ${occurrences}.`);
    // Escaping "<" keeps the JSON from closing its script element.
    const json = JSON.stringify(data[key]).replace(/</g, '\\u003c');
    const filled = `${slot.slice(0, -'</script>'.length)}${json}</script>`;
    // A replacer function keeps "$" sequences in the JSON from being read as replacement patterns.
    out = out.replace(slot, () => filled);
  }
  return out;
}
