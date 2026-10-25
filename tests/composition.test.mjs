import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadStudioApi } from '../scripts/export-drawings.mjs';
import { compose } from '../scripts/compose.mjs';

const skillRoot = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(skillRoot, 'assets', 'studio-template.html'), 'utf8');
const ev = { source: 'generated', confidence: 1, status: 'accepted', note: 'Composition fixture.' };

// A 9 m square single-storey shop. The north wall runs east to west, like a wall drawn clockwise.
function shop(openings, extra = {}) {
  const wall = (id, start, end, kind = 'exterior', heightMm = 5000, thicknessMm = 200) => ({ id, levelId: 'level-1', start, end, thicknessMm, heightMm, kind, evidence: ev });
  return {
    schemaVersion: '1.0.0',
    project: {
      id: 'composition-fixture', name: 'Composition fixture', status: 'study',
      coordinates: { unit: 'mm', origin: { x: 0, y: 0, z: 0 }, siteDatumMm: 0, trueNorthDeg: 0, toleranceMm: 3, displayUnits: 'metric' },
      jurisdiction: { country: 'US', stateOrRegion: 'Example', locality: 'Example', codeReviewStatus: 'unavailable' }
    },
    levels: [{ id: 'level-1', name: 'Floor', elevationMm: 0, floorToFloorMm: 5000, evidence: ev }],
    spaces: [{ id: 'space-shop', name: 'Shop', levelId: 'level-1', use: 'shop', boundary: [{ x: 100, y: 100 }, { x: 8900, y: 100 }, { x: 8900, y: 8900 }, { x: 100, y: 8900 }], evidence: ev }],
    walls: [
      wall('wall-south', { x: 0, y: 0 }, { x: 9000, y: 0 }),
      wall('wall-east', { x: 9000, y: 0 }, { x: 9000, y: 9000 }),
      wall('wall-north', { x: 9000, y: 9000 }, { x: 0, y: 9000 }),
      wall('wall-west', { x: 0, y: 9000 }, { x: 0, y: 0 }),
      ...(extra.walls ?? []).map(item => wall(item.id, item.start, item.end, 'interior', item.heightMm ?? 3000, 140))
    ],
    openings: openings.map(item => ({ kind: 'window', heightMm: 1200, sillMm: 1200, evidence: ev, ...item })),
    slabs: [], roofs: [], stairs: [], fixtures: extra.fixtures ?? [], equipment: [], systems: extra.systems ?? [], assumptions: [],
    ...(extra.composition ? { composition: extra.composition } : {})
  };
}
const win = (id, wallId, offsetMm, more = {}) => ({ id, wallId, offsetMm, widthMm: 1200, ...more });

const plain = value => JSON.parse(JSON.stringify(value));
function report(model) {
  const { api } = loadStudioApi(html);
  api.state.model = model;
  const errors = api.validateModel(model).filter(item => item.severity === 'error');
  assert.equal(errors.length, 0, `fixture must be valid: ${JSON.stringify(errors)}`);
  return { api, ...plain(api.compositionReport(model)) };
}
// Applies every proposal entry to a copy of the model, as an agent would.
function apply(model, proposal) {
  const next = structuredClone(model);
  for (const entry of proposal) {
    const target = next.openings.find(item => item.id === entry.entityId) ?? next.fixtures.find(item => item.id === entry.entityId)
      ?? next.systems.flatMap(system => system.nodes).find(item => item.id === entry.entityId);
    if (entry.field === 'position') target.position = entry.to; else target[entry.field] = entry.to;
  }
  return next;
}
const centreX = (model, id) => {
  const opening = model.openings.find(item => item.id === id), wall = model.walls.find(item => item.id === opening.wallId);
  const dir = Math.sign(wall.end.x - wall.start.x);
  return wall.start.x + dir * (opening.offsetMm + opening.widthMm / 2);
};
const suggested = findings => findings.filter(item => item.suggestion);

test('symmetric facades mirror windows about the centreline, including a wall drawn right to left', () => {
  const model = shop([win('window-n1', 'wall-north', 1100), win('window-n2', 'wall-north', 3600)]);
  const first = report(model);
  const codes = first.findings.filter(item => item.entityId?.startsWith('window-n')).map(item => item.code);
  assert.ok(codes.includes('composition.symmetry'), 'the asymmetric pair is reported');
  const fixed = apply(model, first.proposal);
  const [a, b] = ['window-n1', 'window-n2'].map(id => centreX(fixed, id));
  assert.ok(Math.abs((a + b) / 2 - 4500) <= 1, `pair centred on the facade: ${a}, ${b}`);
  assert.deepEqual(suggested(report(fixed).findings), [], 'applying the proposal leaves nothing to suggest');
});

test('a single opening centres, stacked rows align, and opposite facades line up in plan', () => {
  const model = shop([
    win('window-s1', 'wall-south', 1500), win('window-s2', 'wall-south', 6000),
    win('clere-s1', 'wall-south', 1200, { widthMm: 2400, heightMm: 600, sillMm: 3400 }), win('clere-s2', 'wall-south', 5500, { widthMm: 2400, heightMm: 600, sillMm: 3400 }),
    win('window-n1', 'wall-north', 1000), win('window-n2', 'wall-north', 5900),
    win('clere-n1', 'wall-north', 900, { widthMm: 2400, heightMm: 600, sillMm: 3400 }), win('clere-n2', 'wall-north', 5000, { widthMm: 2400, heightMm: 600, sillMm: 3400 }),
    win('window-w1', 'wall-west', 1000)
  ]);
  const first = report(model);
  const codes = new Set(first.findings.map(item => item.code));
  for (const code of ['composition.symmetry', 'composition.stacking']) assert.ok(codes.has(code), `${code} reported`);
  const fixed = apply(model, first.proposal);
  assert.deepEqual(suggested(report(fixed).findings), []);
  const xs = id => centreX(fixed, id);
  for (const [lower, upper] of [['window-s1', 'clere-s1'], ['window-s2', 'clere-s2'], ['window-n1', 'clere-n1'], ['window-n2', 'clere-n2']]) assert.ok(Math.abs(xs(lower) - xs(upper)) <= 1, `${upper} stacks over ${lower}`);
  assert.ok(Math.abs(xs('window-s1') - Math.min(xs('window-n1'), xs('window-n2'))) <= 1, 'south and north windows share plan positions');
  const west = fixed.openings.find(item => item.id === 'window-w1');
  assert.equal(west.offsetMm + west.widthMm / 2, 4500, 'the lone west window sits on the centreline');
});

test('fixed openings stay put, others keep clear of them, and heads follow the door', () => {
  const door = { id: 'door-entry', wallId: 'wall-south', kind: 'door', offsetMm: 900, widthMm: 900, heightMm: 2100, sillMm: 0, swing: 'left' };
  const windows = [win('window-s1', 'wall-south', 2600, { sillMm: 1200 }), win('window-s2', 'wall-south', 6100, { sillMm: 1200 })];
  const composition = { exceptions: [{ entityId: 'door-entry', reason: 'Faces the house.' }] };
  const first = report(shop([door, ...windows], { composition }));
  assert.ok(!first.findings.some(item => item.entityId === 'door-entry'), 'a fixed door raises nothing');
  const head = first.findings.filter(item => item.code === 'composition.head-alignment');
  assert.equal(head.length, 2);
  assert.equal(head[0].suggestion.value, 900, 'window head moves to the 2100 mm door head');
  const fixed = apply(shop([door, ...windows], { composition }), first.proposal);
  assert.equal(fixed.openings.find(item => item.id === 'door-entry').offsetMm, 900);
  const s1 = fixed.openings.find(item => item.id === 'window-s1');
  assert.ok(s1.offsetMm >= 900 + 900 + 400, 'the window keeps the minimum gap from the fixed door');

  const exempt = report(shop([door, ...windows], { composition: { exceptions: [...composition.exceptions, ...windows.map(item => ({ entityId: item.id, rules: ['head-alignment'], reason: 'Sill above benches.' }))] } }));
  assert.ok(!exempt.findings.some(item => item.code === 'composition.head-alignment'), 'an exception for one rule skips only that rule');
  assert.ok(exempt.proposal.every(item => item.field !== 'sillMm'));
});

test('partition junctions inside an opening warn, but not above the partition', () => {
  const walls = [{ id: 'wall-bath', start: { x: 2000, y: 8900 }, end: { x: 2000, y: 6000 }, heightMm: 3000 }];
  const blocked = report(shop([win('window-n1', 'wall-north', 6400)], { walls }));
  assert.ok(blocked.findings.some(item => item.code === 'composition.partition-conflict' && item.severity === 'warning' && item.entityId === 'window-n1'));
  const high = report(shop([win('clere-n1', 'wall-north', 6000, { widthMm: 2400, heightMm: 600, sillMm: 3400 })], { walls }));
  assert.ok(!high.findings.some(item => item.code === 'composition.partition-conflict'), 'a clerestory above the partition top is clear');
  // A symmetric proposal never lands on the partition: the centred window would straddle x 4500 only.
  const centred = report(shop([win('window-n1', 'wall-north', 3000)], { walls: [{ id: 'wall-mid', start: { x: 4500, y: 9000 }, end: { x: 4500, y: 6000 } }] }));
  assert.ok(centred.proposal.every(item => item.entityId !== 'window-n1'), 'no proposal places the window across the partition');
  assert.ok(centred.findings.some(item => item.code === 'composition.symmetry' && !item.suggestion));
});

test('balanced facades use the centre and third lines; rhythm facades use the bay grid', () => {
  const balanced = report(shop([win('window-e1', 'wall-east', 5600)], { composition: { facades: { east: { strategy: 'balanced' } } } }));
  const thirds = balanced.findings.find(item => item.code === 'composition.thirds');
  assert.ok(thirds, 'an opening off every line is reported');
  assert.equal(thirds.suggestion.value + 600, 6000, 'it moves to the nearest third line');

  const rhythm = report(shop([win('window-s1', 'wall-south', 700), win('window-s2', 'wall-south', 4300)], { composition: { strategy: 'rhythm', bayMm: 3000 } }));
  const fixed = apply(shop([win('window-s1', 'wall-south', 700), win('window-s2', 'wall-south', 4300)], { composition: { strategy: 'rhythm', bayMm: 3000 } }), rhythm.proposal);
  for (const id of ['window-s1', 'window-s2']) assert.equal(centreX(fixed, id) % 3000, 1500, `${id} centres in a bay`);
});

test('sinks centre on the window above, and ceiling lights take an even grid', () => {
  const fixtures = [{ id: 'fixture-sink', name: 'Sink', kind: 'utility-sink', levelId: 'level-1', position: { x: 2900, y: 400, z: 0 }, rotationDeg: 0, size: { x: 600, y: 600, z: 900 }, evidence: ev }];
  const node = (id, x, y) => ({ id, kind: 'light-ceiling', levelId: 'level-1', position: { x, y, z: 4000 }, evidence: ev });
  const nodes = [node('light-1', 2000, 2400), node('light-2', 7100, 2000), node('light-3', 2400, 6900), node('light-4', 6700, 6600), { id: 'panel', kind: 'panel', levelId: 'level-1', position: { x: 300, y: 300, z: 1500 }, evidence: ev }];
  const edges = nodes.slice(0, 4).map((item, i) => ({ id: `edge-${i}`, from: 'panel', to: item.id, path: [nodes[4].position, item.position], evidence: ev }));
  const systems = [{ id: 'electrical', discipline: 'electrical', name: 'Electrical', status: 'concept', nodes, edges, evidence: ev }];
  const model = shop([win('window-s1', 'wall-south', 3000)], { fixtures, systems });
  const result = report(model);
  const sink = result.findings.find(item => item.code === 'composition.fixture-centering');
  assert.deepEqual(sink.suggestion.value, { x: 3600, y: 400, z: 0 });
  const lights = result.proposal.filter(item => item.rules.includes('light-grid'));
  assert.deepEqual(lights.map(item => [item.entityId, item.to.x, item.to.y]).sort(), [['light-1', 2300, 2300], ['light-2', 6700, 2300], ['light-3', 2300, 6700], ['light-4', 6700, 6700]].sort());
});

test('exceptions are validated and none turns composition off', () => {
  const { api } = loadStudioApi(html);
  const model = shop([win('window-n1', 'wall-north', 1100)], { composition: { exceptions: [{ entityId: 'missing', reason: 'Gone.' }, { entityId: 'window-n1', rules: ['vibes'], reason: 'x' }] } });
  api.state.model = model;
  const findings = api.validateModel(model);
  assert.ok(findings.some(item => item.code === 'composition.exception' && item.severity === 'error'), 'an unknown rule is an error');
  model.composition.exceptions.pop();
  assert.ok(api.validateModel(model).some(item => item.code === 'composition.exception' && item.severity === 'warning'), 'an unknown entity is a warning');
  const off = report(shop([win('window-n1', 'wall-north', 1100)], { composition: { strategy: 'none' } }));
  assert.deepEqual(off.findings, []);
});

test('stacked openings validate, cut once in plan, and stay open in sections and 3D', () => {
  const stacked = [win('window-s1', 'wall-south', 3900), win('clere-s1', 'wall-south', 3300, { widthMm: 2400, heightMm: 600, sillMm: 3400 })];
  const { api } = loadStudioApi(html);
  const model = shop(stacked);
  model.slabs = [{ id: 'slab', levelId: 'level-1', boundary: [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 9000 }, { x: 0, y: 9000 }], thicknessMm: 100, evidence: ev }];
  model.sections = [{ id: 'section-a', name: 'Section A', start: { x: 4500, y: -1000 }, end: { x: 4500, y: 10000 }, lookDirection: 'left', evidence: ev }];
  api.state.model = model;
  assert.ok(!api.validateModel(model).some(item => item.severity === 'error'), 'a clerestory over a window is valid');
  const clash = structuredClone(model); clash.openings[1].sillMm = 2000;
  assert.ok(api.validateModel(clash).some(item => item.code === 'opening.overlap'), 'openings that overlap in height still clash');

  const plan = api.renderPlanSheet(model, 'level-1').svg;
  const clere = plan.match(/<g data-entity="clere-s1">([\s\S]*?)<\/g>/)[1];
  assert.match(clere, /stroke-dasharray="3 1.5"/, 'the overhead clerestory draws hidden in plan');

  const cut = plain(api.sectionGeometry(model, model.sections[0]).cut).filter(item => item.id === 'wall-south');
  assert.deepEqual(cut.map(item => [item.z0, item.z1]), [[0, 1200], [2400, 3400], [4000, 5000]], 'the section cuts wall below, between, and above both openings');

  const scene = { triangles: [], lines: [] };
  api.buildScene(scene);
  const withBoth = scene.triangles.length;
  api.state.model = shop([stacked[0]]);
  api.buildScene(scene);
  assert.ok(withBoth > scene.triangles.length, 'the clerestory adds wall pieces around its own hole in 3D');
});

test('review regressions: blocked groups, storeys, rule exceptions, and mixed bay grids', () => {
  // A centred middle window blocked by a partition keeps its place, and the mirrored pair never lands on it.
  const blocked = shop([win('w1', 'wall-south', 2400), win('m', 'wall-south', 5400), win('w2', 'wall-south', 7400)], { walls: [{ id: 'wall-mid', start: { x: 4500, y: 100 }, end: { x: 4500, y: 4000 } }] });
  const applied = apply(blocked, report(blocked).proposal);
  const { api } = loadStudioApi(html);
  api.state.model = applied;
  assert.ok(!api.validateModel(applied).some(item => item.severity === 'error'), 'applying the proposal keeps the model valid');

  // An upper-storey partition protects the upper-storey wall, not the one below.
  const twoStorey = shop([win('upper', 'wall-south-2', 2000)]);
  twoStorey.levels.push({ id: 'level-2', name: 'Upper', elevationMm: 5000, floorToFloorMm: 3000, evidence: ev });
  for (const wall of twoStorey.walls.filter(item => item.kind === 'exterior')) twoStorey.walls.push({ ...wall, id: `${wall.id}-2`, levelId: 'level-2', heightMm: 3000 });
  twoStorey.walls.push({ id: 'wall-upper-mid', levelId: 'level-2', start: { x: 4500, y: 100 }, end: { x: 4500, y: 4000 }, thicknessMm: 140, heightMm: 3000, kind: 'interior', evidence: ev });
  const upper = report(twoStorey);
  assert.ok(!upper.proposal.some(item => item.entityId === 'upper'), 'the upper window is not centred onto the upper partition');

  // Exceptions for thirds and rhythm are honoured.
  const thirds = report(shop([win('e1', 'wall-east', 5600)], { composition: { facades: { east: { strategy: 'balanced' } }, exceptions: [{ entityId: 'e1', rules: ['thirds'], reason: 'Owner choice.' }] } }));
  assert.ok(!thirds.findings.some(item => item.code === 'composition.thirds'));
  const rhythm = report(shop([win('s1', 'wall-south', 700)], { composition: { strategy: 'rhythm', bayMm: 3000, exceptions: [{ entityId: 's1', rules: ['rhythm'], reason: 'Owner choice.' }] } }));
  assert.ok(!rhythm.findings.some(item => item.code === 'composition.rhythm'));

  // Opposite facades on different bay grids are not tied together.
  const mixed = shop([win('sw', 'wall-south', 900), win('nw', 'wall-north', 900)], { composition: { strategy: 'rhythm', bayMm: 3000, facades: { north: { strategy: 'rhythm', bayMm: 4000 } } } });
  const placed = apply(mixed, report(mixed).proposal);
  assert.equal(centreX(placed, 'sw') % 3000, 1500, 'the south window stays on the south grid');
});

test('compose.mjs reports facades as seen and a proposal without writing the model', () => {
  const model = shop([win('window-n1', 'wall-north', 1100), win('window-n2', 'wall-north', 3600)]);
  const direct = plain(compose(html, model));
  const north = direct.facades.find(item => item.side === 'north');
  assert.equal(north.centreFromLeftMm, 4500);
  assert.deepEqual(north.openings.map(item => item.id), ['window-n1', 'window-n2'], 'seen from the north, the east end is on the left');
  assert.ok(north.openings.every((item, i, list) => i === 0 || item.centreFromLeftMm >= list[i - 1].centreFromLeftMm), 'openings read left to right as seen');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-'));
  try {
    fs.mkdirSync(path.join(dir, 'models'));
    const file = path.join(dir, 'models', 'building.json');
    fs.writeFileSync(file, JSON.stringify(model));
    const before = fs.readFileSync(file, 'utf8');
    const out = JSON.parse(execFileSync(process.execPath, [path.join(skillRoot, 'scripts', 'compose.mjs'), '--project', dir, '--page', path.join(skillRoot, 'assets', 'studio-template.html'), '--json'], { encoding: 'utf8' }));
    assert.deepEqual(out.proposal, direct.proposal);
    assert.ok(out.proposal.some(item => item.field === 'offsetMm' && item.wallId === 'wall-north'));
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'the model is untouched');
    const text = execFileSync(process.execPath, [path.join(skillRoot, 'scripts', 'compose.mjs'), '--project', dir, '--page', path.join(skillRoot, 'assets', 'studio-template.html')], { encoding: 'utf8' });
    assert.match(text, /North facade \(symmetric\)/);
    assert.match(text, /Proposed layout/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
