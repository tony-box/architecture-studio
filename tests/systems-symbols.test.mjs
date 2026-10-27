// Systems symbols: device nodes draw standard symbols on M-1xx sheets, oriented to their host wall,
// equipment carries tags, and the symbol key lists exactly what the sheet draws.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadStudioApi } from '../scripts/export-drawings.mjs';

const skillRoot = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(skillRoot, 'assets', 'studio-template.html'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'lakeside-barn-residence', 'building.json'), 'utf8'));
const ALL = new Set(['plumbing', 'electrical', 'mechanical']);
const evidence = { source: 'generated', confidence: 0.5, status: 'needs-review', note: 'Test device.' };

// Adds a device node to the fixture's system for `discipline` on the upper level.
function withDevices(devices) {
  const model = structuredClone(fixture);
  // Keep each symbol test independent of the demo's growing device vocabulary.
  for (const system of model.systems) for (const node of system.nodes) node.kind = 'circuit-end';
  for (const [discipline, kind, x, y, height = 300] of devices) {
    const elevation = model.levels.find(level => level.id === 'level-upper').elevationMm;
    model.systems.find(system => system.discipline === discipline).nodes.push({ id: `test-${kind}-${x}-${y}`, kind, levelId: 'level-upper', position: { x, y, z: elevation + height }, evidence });
  }
  return model;
}
const group = (svg, id) => svg.match(new RegExp(`<g data-entity="${id}"[^>]*>(.*?)</g>`))?.[0] ?? null;
const lines = fragment => [...fragment.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)].map(m => m.slice(1).map(Number));
const circles = fragment => [...fragment.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/g)].map(m => m.slice(1).map(Number));

test('every device kind draws its own symbol and keys it', () => {
  const { api } = loadStudioApi(html);
  const kinds = Object.keys(api.SYSTEM_SYMBOLS);
  const model = withDevices(kinds.map((kind, i) => ['electrical', kind, 1000 + (i % 8) * 1000, 1500 + Math.floor(i / 8) * 1200, 2400]));
  const sheet = api.renderPlanSheet(model, 'level-upper', { systems: ALL });
  for (const kind of kinds) assert.match(sheet.svg, new RegExp(`data-symbol="${kind}"`), kind);
  const keyed = [...sheet.svg.matchAll(/data-legend-symbol="([^"]+)"/g)].map(m => m[1]);
  const overflow = sheet.warnings.filter(item => item.code === 'symbol.key-overflow');
  assert.ok(keyed.length >= 30, 'the key wraps into two columns before it overflows');
  const counted = overflow.length ? Number(sheet.svg.match(/\+(\d+) drawn but not keyed/)[1]) : 0;
  assert.equal(keyed.length + counted, kinds.length, 'every drawn kind is keyed or counted');
});

test('the symbol key lists exactly the symbols and tags a sheet draws', () => {
  const { api } = loadStudioApi(html);
  const model = withDevices([['electrical', 'receptacle-gfci', 5000, 100], ['electrical', 'switch-3way', 3000, 100, 1100], ['mechanical', 'supply-register', 6000, 3000, 2400]]);
  const upper = api.renderPlanSheet(model, 'level-upper', { systems: ALL }).svg;
  assert.deepEqual([...upper.matchAll(/data-legend-symbol="([^"]+)"/g)].map(m => m[1]), ['receptacle-gfci', 'switch-3way', 'supply-register']);
  assert.match(upper, />GFCI RECEPTACLE</);

  const ground = api.renderPlanSheet(model, 'level-ground', { systems: ALL });
  assert.deepEqual([...ground.svg.matchAll(/data-legend-symbol="([^"]+)"/g)].map(m => m[1]), ['electrical-panel', 'water-heater', 'heat-pump']);
  assert.match(ground.svg, /data-symbol="electrical-panel"><polygon[^>]*fill="#9c2f8f"[^>]*\/><text[^>]*>EP</, 'the panel takes the panelboard symbol and its tag');
  assert.match(ground.svg, /data-symbol="heat-pump"><text[^>]*>HP</);
  assert.ok(!ground.warnings.some(item => item.code === 'symbol.key-overflow'));

  const plumbingOnly = api.renderPlanSheet(model, 'level-ground', { systems: new Set(['plumbing']) }).svg;
  assert.deepEqual([...plumbingOnly.matchAll(/data-legend-symbol="([^"]+)"/g)].map(m => m[1]), ['water-heater'], 'tags follow the shown disciplines');
  assert.deepEqual([...new Set([...plumbingOnly.matchAll(/data-symbol="([^"]+)"/g)].map(m => m[1]))], ['water-heater'], 'hidden disciplines draw neither symbols nor tags');
  const floorPlan = api.renderPlanSheet(model, 'level-upper').svg;
  assert.doesNotMatch(floorPlan, /data-symbol=|data-legend-symbol=/, 'floor plans draw no device symbols');
});

test('wall devices sit square to their host wall and grow into the room', () => {
  const { api } = loadStudioApi(html);
  // North wall face at y = 100 (sheet bottom, room above); west wall face at x = 100 (room to the right).
  const model = withDevices([['electrical', 'receptacle', 5000, 100], ['electrical', 'receptacle', 100, 4000], ['electrical', 'receptacle', 5000, 4000]]);
  const svg = api.renderPlanSheet(model, 'level-upper', { systems: ALL }).svg;

  const north = group(svg, 'test-receptacle-5000-100'), [[nc]] = [circles(north)];
  for (const [x1, y1, x2, y2] of lines(north)) { assert.equal(x1, x2, 'lines are square to a horizontal wall'); assert.ok(y2 < y1); }
  assert.ok(nc[1] < lines(north)[0][1], 'the circle sits on the room side');

  const west = group(svg, 'test-receptacle-100-4000'), [[wc]] = [circles(west)];
  for (const [x1, y1, x2, y2] of lines(west)) { assert.equal(y1, y2, 'lines are square to a vertical wall'); assert.ok(x2 > x1); }
  assert.ok(wc[0] > lines(west)[0][0]);

  // Out of reach of every wall, the symbol is centred on the device.
  const free = group(svg, 'test-receptacle-5000-4000'), [fc] = circles(free), [x1, y1, x2, y2] = lines(free)[0];
  assert.ok(Math.abs((y1 + y2) / 2 - fc[1]) < 0.01 && x1 === x2);
});

test('legacy node kinds keep the plain dot and details name the symbol', () => {
  const { api } = loadStudioApi(html);
  const svg = api.renderPlanSheet(structuredClone(fixture), 'level-ground', { systems: ALL }).svg;
  assert.match(group(svg, 'electrical-panel'), /^<g data-entity="electrical-panel"><circle [^>]*r="1.1"/);

  const model = withDevices([['electrical', 'smoke-alarm', 2000, 3000, 2400]]);
  const details = Object.fromEntries(api.entityDetails(model, 'test-smoke-alarm-2000-3000').dims);
  assert.equal(details.Kind, 'Smoke alarm');
  assert.equal(details['Mounting height'], `7'-10 1/2"`);

  // Each symbolized device also gets one 3D marker; plain nodes add none.
  const triangles = m => { api.state.model = m; api.state.systems = ALL; const gls = { triangles: [], lines: [] }; api.buildScene(gls); return gls.triangles.length; };
  const plain = withDevices([['electrical', 'circuit-end', 2000, 3000, 2400]]);
  assert.equal(triangles(model) - triangles(withDevices([])), 216, 'one prism per device');
  assert.equal(triangles(plain), triangles(withDevices([])));
});
