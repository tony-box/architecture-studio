// Freezes the drawing sets of the examples that predate site plans and curved geometry. Site
// features and curves are additive: a model that uses neither must draw exactly as it did.
//
//   UPDATE_GOLDEN=1 node --test tests/legacy-output.test.mjs   # rewrite after an intended change
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildDrawingSet } from '../scripts/export-drawings.mjs';

const skillRoot = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(skillRoot, 'assets', 'studio-template.html'), 'utf8');
const goldenPath = path.join(import.meta.dirname, 'golden', 'legacy-drawing-sets.json');
const LEGACY_EXAMPLES = ['lakeside-barn-residence', 'compact-metric-studio', 'mixed-material-workshop', 'mixed-material-workshop-metric'];
const sha = text => crypto.createHash('sha256').update(text).digest('hex');

function digest(name) {
  const model = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', name, 'building.json'), 'utf8'));
  const { sheets, manifest, errors } = buildDrawingSet(html, model);
  assert.equal(errors.length, 0, `${name} has model errors`);
  return {
    manifest: sha(JSON.stringify(manifest)),
    sheets: Object.fromEntries(sheets.map(sheet => [sheet.path, sha(sheet.svg)]))
  };
}

test('drawing sets of models without site features or curves are unchanged', () => {
  const actual = Object.fromEntries(LEGACY_EXAMPLES.map(name => [name, digest(name)]));
  if (process.env.UPDATE_GOLDEN) {
    fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
    fs.writeFileSync(goldenPath, `${JSON.stringify(actual, null, 2)}\n`);
  }
  const expected = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  for (const name of LEGACY_EXAMPLES) {
    assert.deepEqual(Object.keys(actual[name].sheets), Object.keys(expected[name].sheets), `${name}: sheet list changed`);
    for (const [file, hash] of Object.entries(expected[name].sheets)) assert.equal(actual[name].sheets[file], hash, `${name}: ${file} changed`);
    assert.equal(actual[name].manifest, expected[name].manifest, `${name}: manifest changed`);
  }
});
