import fs from 'node:fs';
import path from 'node:path';
import { MARKER_FILE } from './init.mjs';
import { isMain, parseArgs, skillVersion } from './lib.mjs';

// Installations track main; this repository does not currently publish tagged releases.
export const VERSION_URL = 'https://raw.githubusercontent.com/tony-box/architecture-studio/main/package.json';
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

function parseVersion(value) {
  const match = typeof value === 'string' && value.match(VERSION);
  if (!match) throw new Error(`Invalid semantic version: ${JSON.stringify(value)}`);
  return { core: match.slice(1, 4).map(BigInt), pre: match[4]?.split('.') ?? [] };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  }
  if (!a.pre.length || !b.pre.length) return Number(!a.pre.length) - Number(!b.pre.length);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i += 1) {
    if (a.pre[i] === b.pre[i]) continue;
    if (a.pre[i] === undefined) return -1;
    if (b.pre[i] === undefined) return 1;
    const aNumeric = /^\d+$/.test(a.pre[i]);
    const bNumeric = /^\d+$/.test(b.pre[i]);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    const x = aNumeric ? BigInt(a.pre[i]) : a.pre[i];
    const y = bNumeric ? BigInt(b.pre[i]) : b.pre[i];
    return x > y ? 1 : -1;
  }
  return 0;
}

function status(current, target) {
  const comparison = compareVersions(current, target);
  return comparison < 0 ? 'available' : comparison > 0 ? 'ahead' : 'current';
}

export async function checkUpdates({ projectDir, offline = false, installedVersion = skillVersion(), fetchImpl = fetch } = {}) {
  const result = {
    installedVersion,
    skill: { status: offline ? 'skipped' : 'unknown', latestVersion: null },
    project: { status: projectDir ? 'unknown' : 'not-requested', viewerVersion: null },
    warnings: []
  };
  try {
    parseVersion(installedVersion);
  } catch (error) {
    result.warnings.push(`Cannot determine installed skill version: ${error.message}`);
    return result;
  }
  if (projectDir) {
    try {
      const marker = JSON.parse(fs.readFileSync(path.join(path.resolve(projectDir), MARKER_FILE), 'utf8'));
      if (marker.tool !== 'architecture-studio') throw new Error('Unrecognized project marker.');
      result.project.status = status(marker.skillVersion, installedVersion);
      result.project.viewerVersion = marker.skillVersion;
    } catch (error) {
      result.warnings.push(`Cannot determine project viewer version: ${error.message}`);
    }
  }
  if (!offline) {
    try {
      const response = await fetchImpl(VERSION_URL, {
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`Version endpoint returned HTTP ${response.status}.`);
      const metadata = await response.json();
      if (metadata?.name !== 'architecture-studio') throw new Error('Unrecognized skill metadata.');
      result.skill.status = status(installedVersion, metadata.version);
      result.skill.latestVersion = metadata.version;
    } catch (error) {
      result.warnings.push(`Cannot check for a newer skill: ${error.message}`);
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node <skill>/scripts/check-updates.mjs [--project <dir>] [--offline] [--json]');
    return;
  }
  const target = args.project ?? args._[0];
  if (target !== undefined && typeof target !== 'string') {
    console.error('Expected a project directory.');
    process.exitCode = 1;
    return;
  }
  const result = await checkUpdates({ projectDir: target, offline: Boolean(args.offline) });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Installed skill: ${result.installedVersion}`);
    console.log(`Skill update: ${result.skill.status}${result.skill.latestVersion ? ` (upstream ${result.skill.latestVersion})` : ''}`);
    console.log(`Project viewer update: ${result.project.status}${result.project.viewerVersion ? ` (viewer ${result.project.viewerVersion})` : ''}`);
    for (const warning of result.warnings) console.error(`Warning: ${warning}`);
    if (result.skill.status === 'available' || result.project.status === 'available') {
      console.log('An upgrade is available. Ask the user before updating the installation or replacing project files.');
    }
  }
  if (result.warnings.length) process.exitCode = 1;
}

if (isMain(import.meta)) await main();
