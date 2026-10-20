// Creates an Architecture Studio project folder, or refreshes the viewer of an existing one.
//
//   node <skill>/scripts/init.mjs <project-dir>            # create
//   node <skill>/scripts/init.mjs <project-dir> --update   # replace index.html with this skill's viewer
//
// A project is self-contained: it carries its own copy of the viewer, so the folder can be
// zipped, shared, or served without the skill installed.
import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATE_PATH, isMain, parseArgs, skillVersion } from './lib.mjs';

export const MARKER_FILE = 'architecture-studio.json';
export const PROJECT_DIRS = ['models/variants', 'exports', 'reviews', 'sources'];

export function initProject(projectDir, { update = false } = {}) {
  const root = path.resolve(projectDir);
  const markerPath = path.join(root, MARKER_FILE);
  const indexPath = path.join(root, 'index.html');
  const isProject = fs.existsSync(markerPath) || fs.existsSync(indexPath);
  if (isProject && !update) return { status: 'exists', root };
  for (const dir of PROJECT_DIRS) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.copyFileSync(TEMPLATE_PATH, indexPath);
  const marker = { tool: 'architecture-studio', skillVersion: skillVersion() };
  fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
  return { status: isProject ? 'updated' : 'created', root };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args._[0] ?? args.project;
  if (args.help || !target) {
    console.log('Usage: node <skill>/scripts/init.mjs <project-dir> [--update]');
    if (!args.help) process.exitCode = 1;
    return;
  }
  const { status, root } = initProject(String(target), { update: Boolean(args.update) });
  if (status === 'exists') {
    console.log(`${root} is already an Architecture Studio project. Pass --update to replace its viewer with this skill's version.`);
    return;
  }
  console.log(`${status === 'created' ? 'Created' : 'Updated'} Architecture Studio project at ${root}`);
  if (status === 'created') {
    console.log('Next: gather the brief (references/intake.md), write brief.json, then models/building.json.');
  }
}

if (isMain(import.meta)) main();
