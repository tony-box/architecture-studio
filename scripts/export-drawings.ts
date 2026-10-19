// Writes the drafted drawing set for an Architecture Studio project.
//
//   node --experimental-strip-types scripts/export-drawings.ts --project <dir>
//
// The renderer is the inline script of the studio page (index.html in a project, or
// assets/studio-template.html in this plugin), executed in node:vm. The viewer and the
// exported files therefore come from the same code. Output is deterministic: the same
// model always produces byte-identical sheets and manifest.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

type StudioApi = Record<string, any>;

interface DrawingFile { path: string; view: string; sheet: string; title: string; scale: string }

interface Manifest {
  schemaVersion: '1.0.0';
  projectId: string;
  modelFingerprint: string;
  profile: string;
  files: DrawingFile[];
  artifacts: { path: string }[];
  warnings: { code: string; message: string; entityId?: string }[];
}

const DRAWING_DIRS = ['plans', 'elevations', 'sections', 'systems'];
const HANDOFF_ARTIFACTS = ['models/building.json', 'ASSUMPTIONS.md', 'HANDOFF.md', 'reviews/code-findings.json', 'reviews/code-review.md'];

export function extractStudioScript(html: string): string {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('The studio page does not contain its inline renderer script.');
  return script;
}

// Runs the studio script with a minimal document stub and returns its API.
export function loadStudioApi(html: string): { api: StudioApi; elements: Map<string, Record<string, any>> } {
  const elements = new Map<string, Record<string, any>>();
  const element = (selector: string) => {
    if (!elements.has(selector)) {
      elements.set(selector, { innerHTML: '', textContent: '', classList: { toggle() {} }, setAttribute() {}, querySelectorAll() { return []; } });
    }
    return elements.get(selector)!;
  };
  let api: StudioApi | undefined;
  const context = vm.createContext({
    console,
    structuredClone,
    TextEncoder,
    document: { querySelector: element, querySelectorAll() { return []; } },
    __OD_STUDIO_TEST__(value: StudioApi) { api = value; }
  });
  vm.runInContext(extractStudioScript(html), context);
  if (!api) throw new Error('The studio script did not expose its API.');
  return { api, elements };
}

export function buildDrawingSet(html: string, model: unknown, projectDir?: string) {
  const { api } = loadStudioApi(html);
  api.state.model = model;
  const findings = api.validateModel(model) as { severity: string; code: string; message: string; entityId?: string }[];
  const errors = findings.filter(item => item.severity === 'error');
  if (errors.length) return { errors, sheets: [], manifest: null };
  const sheets = api.renderDrawingSet(model) as (DrawingFile & { svg: string; sheetId: string; scaleLabel: string; warnings: Manifest['warnings'] })[];
  const manifest: Manifest = {
    schemaVersion: '1.0.0',
    projectId: (model as { project: { id: string } }).project.id,
    modelFingerprint: api.modelFingerprint(model),
    profile: api.profileFor(model).label,
    files: sheets.map(sheet => ({ path: sheet.path, view: sheet.view, sheet: sheet.sheetId, title: sheet.title, scale: sheet.scaleLabel })),
    artifacts: projectDir ? HANDOFF_ARTIFACTS.filter(file => fs.existsSync(path.join(projectDir, file))).map(file => ({ path: file })) : [],
    warnings: sheets.flatMap(sheet => sheet.warnings.map(({ code, message, entityId }) => ({ code, message, entityId })))
  };
  return { errors, sheets, manifest };
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key.slice(2)] = true;
    else { args[key.slice(2)] = next; i += 1; }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node --experimental-strip-types export-drawings.ts [--project <dir>] [--page <index.html>] [--model <models/building.json>] [--json]');
    return;
  }
  const projectDir = path.resolve(String(args.project ?? '.'));
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const pageCandidates = [args.page ? path.resolve(String(args.page)) : null, path.join(projectDir, 'index.html'), path.join(scriptDir, '..', 'assets', 'studio-template.html')].filter(Boolean) as string[];
  const page = pageCandidates.find(candidate => fs.existsSync(candidate));
  if (!page) throw new Error('No studio page found. Copy assets/studio-template.html to index.html first.');
  const modelPath = path.resolve(projectDir, String(args.model ?? 'models/building.json'));
  const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  const { errors, sheets, manifest } = buildDrawingSet(fs.readFileSync(page, 'utf8'), model, projectDir);
  if (errors.length || !manifest) {
    console.error(`Model has ${errors.length} error(s); no drawings were written.`);
    for (const error of errors) console.error(`- ${error.code}: ${error.message}${error.entityId ? ` (${error.entityId})` : ''}`);
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
