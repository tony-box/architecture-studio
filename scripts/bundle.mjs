// Writes a single self-contained HTML file for sharing a project. The model and the advisory
// code findings are embedded, so the file opens with a double-click and needs no server.
//
//   node <skill>/scripts/bundle.mjs [project-dir] [--out <file>]
//
// The shared file is a viewer: it renders every sheet and the 3D model, but it cannot package
// the exported drawing set. Share the exports/ folder (or the viewer's ZIP) for the drawings.
// Source images (sources/) are not embedded; the bundle names the ones it leaves out.
import fs from 'node:fs';
import path from 'node:path';
import { validateWithStudio } from './export-drawings.mjs';
import { embedData, isMain, parseArgs, printFindings, readJson, resolveStudioPage } from './lib.mjs';

// The images in sources/sources.json, which the single-file bundle does not carry.
export function omittedSources(projectDir) {
  try {
    const manifest = readJson(path.join(path.resolve(projectDir), 'sources', 'sources.json'));
    return Array.isArray(manifest.sources) ? manifest.sources.map(source => ({ id: String(source.id), path: String(source.path) })) : [];
  } catch {
    return [];
  }
}

export function bundleProject(projectDir) {
  const root = path.resolve(projectDir);
  const html = fs.readFileSync(resolveStudioPage(root), 'utf8');
  const model = readJson(path.join(root, 'models', 'building.json'));
  const { errors } = validateWithStudio(html, model);
  if (errors.length) return { errors, html: null, model };
  const codePath = path.join(root, 'reviews', 'code-findings.json');
  const codeFindings = fs.existsSync(codePath) ? readJson(codePath) : undefined;
  return { errors, html: embedData(html, { model, codeFindings }), model, omittedSources: omittedSources(root) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node <skill>/scripts/bundle.mjs [project-dir] [--out <file>]');
    return;
  }
  const projectDir = path.resolve(String(args._[0] ?? args.project ?? '.'));
  const { errors, html, model, omittedSources: omitted } = bundleProject(projectDir);
  if (!html) {
    console.error(`Model has ${errors.length} error(s); no bundle was written.`);
    printFindings(errors);
    process.exitCode = 1;
    return;
  }
  const out = path.resolve(String(args.out ?? path.join(projectDir, 'exports', `${model.project.id}-studio.html`)));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`Wrote ${out}`);
  if (omitted.length) {
    console.log(`Note: the bundle does not include the ${omitted.length} source image(s), so it shows no image underlays: ${omitted.map(source => `${source.id} (${source.path})`).join(', ')}. Share the sources/ folder with it, or the whole project folder, if they are needed.`);
  }
}

if (isMain(import.meta)) main();
