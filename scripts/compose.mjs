// Reports how a model's visible layout composes, as numbers an agent can apply: every facade as seen
// from outside (centreline, third lines, each opening's centre from the left corner), every
// composition finding, and one proposed layout with exact model values. It never writes the model.
//
//   node <skill>/scripts/compose.mjs --project <dir>          # readable report
//   node <skill>/scripts/compose.mjs --project <dir> --json   # the same report as JSON
//
// Lengths are millimetres. Apply each proposal entry to models/building.json (offsetMm and sillMm on
// the named opening; position on a fixture or system node, with the ends of its routes), then rerun
// this script and export-drawings.mjs. See references/composition-guide.md.
import fs from 'node:fs';
import path from 'node:path';
import { loadStudioApi } from './export-drawings.mjs';
import { isMain, parseArgs, printFindings, readJson, resolveStudioPage } from './lib.mjs';

export function compose(html, model) {
  const { api } = loadStudioApi(html);
  if (typeof api.compositionReport !== 'function') throw new Error('This studio page predates compose.mjs. Run scripts/init.mjs <project> --update.');
  api.state.model = model;
  const errors = api.validateModel(model).filter(item => item.severity === 'error');
  if (errors.length) return { errors };
  const report = api.compositionReport(model);
  return {
    errors: [],
    settings: report.settings,
    facades: report.facades,
    findings: report.findings.map(({ severity, code, message, entityId, suggestion }) => ({ severity, code, entityId, message, ...(suggestion ? { suggestion } : {}) })),
    proposal: report.proposal
  };
}

function formatReport(result, units, api) {
  const L = mm => api.formatLength(mm, units), lines = [];
  lines.push(`Composition: ${result.settings.strategy} by default, tolerance ${L(result.settings.toleranceMm)}, min gap ${L(result.settings.minGapMm)}, corner return ${L(result.settings.cornerReturnMm)}.`);
  for (const facade of result.facades) {
    lines.push('', `${facade.label} facade (${facade.strategy}), ${L(facade.lengthMm)} long, centreline ${L(facade.centreFromLeftMm)} and third lines ${facade.thirdsFromLeftMm.map(L).join(' and ')} from the left corner as seen.`);
    if (!facade.openings.length) lines.push('  No openings.');
    for (const item of facade.openings) lines.push(`  ${item.id} (${item.kind}${item.fixed ? ', fixed' : ''}): centre ${L(item.centreFromLeftMm)} from left, ${L(item.widthMm)} wide, sill ${L(item.sillMm)}, head ${L(item.headMm)}; ${item.wallId} offsetMm ${item.offsetMm}`);
  }
  lines.push('', result.findings.length ? 'Findings:' : 'Findings: none.');
  for (const item of result.findings) lines.push(`  ${item.severity} ${item.code}: ${item.message}`);
  lines.push('', result.proposal.length ? 'Proposed layout (apply to models/building.json):' : 'Proposed layout: nothing to change.');
  for (const item of result.proposal) lines.push(`  ${item.entityId}.${item.field}: ${JSON.stringify(item.from)} -> ${JSON.stringify(item.to)}  (${item.rules.join(', ')})`);
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node <skill>/scripts/compose.mjs [--project <dir>] [--page <index.html>] [--model <models/building.json>] [--json]');
    return;
  }
  const projectDir = path.resolve(String(args.project ?? args._[0] ?? '.'));
  const page = resolveStudioPage(projectDir, args.page ? String(args.page) : undefined);
  const html = fs.readFileSync(page, 'utf8');
  const model = readJson(path.resolve(projectDir, String(args.model ?? 'models/building.json')));
  try {
    const result = compose(html, model);
    if (result.errors.length) {
      console.error(`Model has ${result.errors.length} error(s); fix them before composing.`);
      printFindings(result.errors);
      process.exitCode = 1;
      return;
    }
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(formatReport(result, model.project.coordinates.displayUnits, loadStudioApi(html).api));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (isMain(import.meta)) main();
