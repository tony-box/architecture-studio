// Writes the drafted drawing set for an Architecture Studio project.
//
//   node <skill>/scripts/export-drawings.mjs --project <dir>
//
// The renderer is the inline script of the studio page (index.html in a project, or
// assets/studio-template.html in this skill), executed in node:vm. The viewer and the
// exported files therefore come from the same code. Output is deterministic: the same
// model always produces byte-identical sheets and manifest.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { isMain, parseArgs, printFindings, readJson, resolveStudioPage } from './lib.mjs';

const DRAWING_DIRS = ['site', 'plans', 'elevations', 'sections', 'systems'];
const HANDOFF_ARTIFACTS = ['brief.json', 'models/building.json', 'ASSUMPTIONS.md', 'HANDOFF.md', 'reviews/code-findings.json', 'reviews/code-review.md', 'sources/sources.json'];

export function extractStudioScript(html) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('The studio page does not contain its inline renderer script.');
  return script;
}

// Runs the studio script with a minimal document stub and returns its API.
export function loadStudioApi(html) {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) {
      elements.set(selector, { innerHTML: '', textContent: '', classList: { toggle() {} }, setAttribute() {}, querySelectorAll() { return []; } });
    }
    return elements.get(selector);
  };
  let api;
  const context = vm.createContext({
    console,
    structuredClone,
    TextEncoder,
    document: { querySelector: element, querySelectorAll() { return []; } },
    __ARCHITECTURE_STUDIO_API__(value) { api = value; }
  });
  vm.runInContext(extractStudioScript(html), context);
  if (!api) throw new Error('The studio script did not expose its API.');
  return { api, elements };
}

// Returns the model's validation findings, split so callers can refuse to write on errors.
export function validateWithStudio(html, model) {
  const { api } = loadStudioApi(html);
  api.state.model = model;
  const findings = api.validateModel(model);
  return { api, findings, errors: findings.filter(item => item.severity === 'error') };
}

export function buildDrawingSet(html, model, projectDir) {
  const { api, errors } = validateWithStudio(html, model);
  if (errors.length) return { errors, sheets: [], manifest: null };
  const sheets = api.renderDrawingSet(model);
  const manifest = {
    schemaVersion: '1.0.0',
    projectId: model.project.id,
    modelFingerprint: api.modelFingerprint(model),
    profile: api.profileFor(model).label,
    files: sheets.map(sheet => ({ path: sheet.path, view: sheet.view, sheet: sheet.sheetId, title: sheet.title, scale: sheet.scaleLabel })),
    artifacts: projectDir ? HANDOFF_ARTIFACTS.filter(file => fs.existsSync(path.join(projectDir, file))).map(file => ({ path: file })) : [],
    warnings: sheets.flatMap(sheet => sheet.warnings.map(({ code, message, entityId }) => ({ code, message, entityId })))
  };
  return { errors, sheets, manifest };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node <skill>/scripts/export-drawings.mjs [--project <dir>] [--page <index.html>] [--model <models/building.json>] [--json]');
    return;
  }
  const projectDir = path.resolve(String(args.project ?? args._[0] ?? '.'));
  const page = resolveStudioPage(projectDir, args.page ? String(args.page) : undefined);
  const model = readJson(path.resolve(projectDir, String(args.model ?? 'models/building.json')));
  const { errors, sheets, manifest } = buildDrawingSet(fs.readFileSync(page, 'utf8'), model, projectDir);
  if (errors.length || !manifest) {
    console.error(`Model has ${errors.length} error(s); no drawings were written.`);
    printFindings(errors);
    process.exitCode = 1;
    return;
  }
  const exportsDir = path.join(projectDir, 'exports');
  for (const dir of DRAWING_DIRS) {
    const full = path.join(exportsDir, dir);
    if (fs.existsSync(full)) for (const file of fs.readdirSync(full)) if (file.endsWith('.svg')) fs.rmSync(path.join(full, file));
  }
  for (const sheet of sheets) {
    const target = path.join(projectDir, sheet.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `<?xml version="1.0" encoding="UTF-8"?>\n${sheet.svg}\n`);
  }
  fs.writeFileSync(path.join(exportsDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (args.json) console.log(JSON.stringify(manifest, null, 2));
  else {
    console.log(`Wrote ${sheets.length} sheets and exports/manifest.json using ${path.relative(projectDir, page) || page}.`);
    for (const file of manifest.files) console.log(`  ${file.sheet}  ${file.path}  (${file.scale})`);
    for (const warning of manifest.warnings) console.log(`  warning ${warning.code}: ${warning.message}`);
  }
}

if (isMain(import.meta)) main();
