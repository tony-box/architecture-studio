import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadStudioApi } from '../scripts/export-drawings.mjs';

const skillRoot = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(skillRoot, 'assets', 'studio-template.html'), 'utf8');
const read = name => JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', name, 'building.json'), 'utf8'));
const site = read('hillside-garden-house-metric');
const { api } = loadStudioApi(html);
const errorCodes = model => { api.state.model = model; return [...api.validateModel(model)].filter(item => item.severity === 'error').map(item => item.code); };
const near = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance, `${message ?? ''} expected ${b}, got ${a}`);
const evidence = { source: 'generated', confidence: 0.5, status: 'needs-review', note: 'Test.' };
const wall = (id, start, end, extra = {}) => ({ id, levelId: 'level-ground', start, end, thicknessMm: 200, heightMm: 2700, kind: 'exterior', evidence, ...extra });

function pointInPolygon(p, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function clipHalfPlane(points, f) {
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
  }
  return out;
}
const band = (g, a, b, t) => [...g.points(a, b, t / 2), ...g.points(a, b, -t / 2).reverse()];
// The half of a wall at one end, extended and clipped the way the plan draws it.
function endPiece(w, atStart, walls) {
  const g = api.wallGeometry(w), clip = api.wallEndClip(w, atStart, walls, 3), L = g.length;
  const polygon = atStart ? band(g, -clip.extend, L / 2, w.thicknessMm) : band(g, L / 2, L + clip.extend, w.thicknessMm);
  return { clip, geometry: g, thickness: w.thicknessMm, polygon: clip.keep ? clipHalfPlane(polygon, clip.keep) : polygon, plain: atStart ? band(g, 0, L / 2, w.thicknessMm) : band(g, L / 2, L, w.thicknessMm) };
}
// No point near the joint is drawn twice, and no point of either wall's own band is left undrawn.
// Points within 2 mm of a face or of a cut are skipped: there the tessellated arcs differ by design.
function assertCleanJoin(a, b, joint) {
  let checked = 0;
  for (let dx = -450; dx <= 450; dx += 9) for (let dy = -450; dy <= 450; dy += 9) {
    const p = { x: joint.x + dx + 0.37, y: joint.y + dy + 0.21 };
    if ([a, b].some(piece => Math.abs(Math.abs(piece.geometry.offsetOf(p)) - piece.thickness / 2) < 2)) continue;
    const inA = pointInPolygon(p, a.polygon), inB = pointInPolygon(p, b.polygon);
    const nearCut = [a.clip.keep, b.clip.keep].some(f => f && [[4, 4], [-4, -4], [4, -4], [-4, 4]].some(([ox, oy]) => Math.sign(f({ x: p.x + ox, y: p.y + oy })) !== Math.sign(f(p))));
    if (nearCut) continue;
    if (inA && inB) assert.fail(`overlap at ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
    if ((pointInPolygon(p, a.plain) || pointInPolygon(p, b.plain)) && !inA && !inB) assert.fail(`gap at ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
    checked += 1;
  }
  assert.ok(checked > 100);
}

test('arc wall geometry keeps the straight-wall frame along the centreline', () => {
  for (const bulge of [0.4, -0.7, 1]) {
    const g = api.wallGeometry(wall('w', { x: 0, y: 0 }, { x: 4000, y: 1000 }, { bulge }));
    near(g.at(0).x, 0, 1e-6); near(g.at(g.length).x, 4000, 1e-6); near(g.at(g.length).y, 1000, 1e-6);
    for (const along of [0, 900, g.length / 2, g.length - 1]) for (const side of [-100, 0, 100]) {
      const p = g.at(along, side);
      near(g.offsetOf(p), side, 1e-6, 'offset');
      near(g.alongOf(p), along, 1e-6, 'along');
    }
    const t = g.tangent(500), n = g.normal(500);
    near(Math.hypot(t.x, t.y), 1, 1e-9); near(t.x * n.y - t.y * n.x, 1, 1e-9, 'normal is to the left');
  }
  near(api.wallLength(wall('w', { x: 0, y: 0 }, { x: 2000, y: 0 }, { bulge: 1 })), Math.PI * 1000, 1e-6);
});

test('arc walls are validated for bulge, radius, opening fit along the arc, and overlaps', () => {
  const model = structuredClone(site), bay = model.walls.find(item => item.id === 'wall-bay');
  assert.deepEqual(errorCodes(structuredClone(model)), []);
  const tooBig = structuredClone(model); tooBig.walls.find(item => item.id === 'wall-bay').bulge = 1.5;
  assert.ok(errorCodes(tooBig).includes('wall.arc'));
  const tight = structuredClone(model); Object.assign(tight.walls.find(item => item.id === 'wall-bay'), { end: { x: bay.start.x, y: bay.start.y + 300 }, bulge: 1 });
  assert.ok(errorCodes(tight).includes('wall.arc'));
  // An opening longer than the chord still fits when the arc is long enough.
  const chord = Math.hypot(bay.end.x - bay.start.x, bay.end.y - bay.start.y), arcLength = api.wallLength(bay);
  const long = structuredClone(model); Object.assign(long.openings.find(item => item.id === 'opening-bay-window'), { offsetMm: 0, widthMm: Math.floor((chord + arcLength) / 2) });
  assert.ok(!errorCodes(long).includes('opening.fit'));
  long.openings.find(item => item.id === 'opening-bay-window').widthMm = Math.ceil(arcLength) + 10;
  assert.ok(errorCodes(long).includes('opening.fit'));
  const overlap = structuredClone(model); overlap.openings.push({ ...overlap.openings.find(item => item.id === 'opening-bay-window'), id: 'opening-bay-second' });
  assert.ok(errorCodes(overlap).includes('opening.overlap'));
});

test('joins between arcs and lines, between two arcs, at unequal thickness, and tees on arcs leave no gap or overlap', () => {
  const cases = [
    // Line into a bowed-out arc, at a right-angle corner.
    { walls: [wall('a', { x: 0, y: 0 }, { x: 4000, y: 0 }), wall('b', { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { bulge: 0.4 })], a: ['a', false], b: ['b', true], joint: { x: 4000, y: 0 } },
    // Arc into a line, the arc bowing inward, with unequal thickness.
    { walls: [wall('b', { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { bulge: -0.3 }), wall('c', { x: 4000, y: 4000 }, { x: 0, y: 4000 }, { thicknessMm: 120 })], a: ['b', false], b: ['c', true], joint: { x: 4000, y: 4000 } },
    // Two arcs meeting at an angle.
    { walls: [wall('d', { x: 0, y: 0 }, { x: 3000, y: 1000 }, { bulge: 0.3 }), wall('e', { x: 3000, y: 1000 }, { x: 3500, y: 4000 }, { bulge: -0.25 })], a: ['d', false], b: ['e', true], joint: { x: 3000, y: 1000 } },
    // Reflex corner: the walls fold back at about 120 degrees.
    { walls: [wall('f', { x: 0, y: 0 }, { x: 4000, y: 0 }), wall('g', { x: 4000, y: 0 }, { x: 2000, y: 3464 }, { bulge: 0.2 })], a: ['f', false], b: ['g', true], joint: { x: 4000, y: 0 } }
  ];
  for (const item of cases) {
    const byId = id => item.walls.find(w => w.id === id);
    const a = endPiece(byId(item.a[0]), item.a[1], item.walls), b = endPiece(byId(item.b[0]), item.b[1], item.walls);
    assert.ok(a.clip.keep && b.clip.keep, `${item.a[0]}-${item.b[0]} mitered`);
    assertCleanJoin(a, b, item.joint);
  }
  // Tee: a straight partition stops at the face of an arc it meets part way along.
  const host = wall('host', { x: 0, y: 0 }, { x: 6000, y: 0 }, { bulge: 0.25 }), hostGeometry = api.wallGeometry(host), foot = hostGeometry.at(hostGeometry.length / 2);
  const partition = wall('partition', { x: foot.x, y: foot.y + 3000 }, foot, { thicknessMm: 120, kind: 'interior' });
  const piece = endPiece(partition, false, [host, partition]);
  const face = hostGeometry.at(hostGeometry.length / 2, 100);
  near(piece.clip.keep(face), 0, 2, 'the partition stops at the host face');
  assert.ok(!pointInPolygon(foot, piece.polygon), 'the partition does not run into the host');
  assert.ok(pointInPolygon({ x: face.x, y: face.y + 5 }, piece.polygon), 'and reaches it');
});

test('a curved bay keeps the same opening in plan, section, elevation, and 3D', () => {
  const model = structuredClone(site), bay = model.walls.find(item => item.id === 'wall-bay'), window = model.openings.find(item => item.id === 'opening-bay-window');
  const plan = api.renderPlanSheet(model, 'level-ground');
  assert.match(plan.svg, /data-entity="opening-bay-window"/);
  assert.ok(plan.svg.includes(`R ${Math.round(api.wallGeometry(bay).radius)}`), 'radius note');
  // Section B-B crosses the bay through the window: the wall is cut below the sill and above the head.
  const geometry = api.sectionGeometry(model, model.sections.find(item => item.id === 'section-bb'));
  const spans = geometry.cut.filter(item => item.id === 'wall-bay').map(item => [item.z0, item.z1]);
  assert.deepEqual(JSON.parse(JSON.stringify(spans)), [[0, window.sillMm], [window.sillMm + window.heightMm, bay.heightMm]]);
  assert.ok(geometry.regions.filter(item => item.id === 'wall-bay').length >= 4 * 2, 'every layer is cut on both sides of the window');
  // East elevation: the window shows at its projected (foreshortened) width.
  const east = api.renderElevationSheet(model, 'east');
  const box = east.svg.match(/data-entity="opening-bay-window"><polygon points="([^"]+)"/);
  assert.ok(box, 'bay window in the east elevation');
  const xs = box[1].split(' ').map(pair => Number(pair.split(',')[0])), width = (Math.max(...xs) - Math.min(...xs)) * east.ratio;
  const g = api.wallGeometry(bay), projected = Math.abs(g.at(window.offsetMm).y - g.at(window.offsetMm + window.widthMm).y);
  near(width, projected, east.ratio * 0.02);
  assert.ok(width < window.widthMm);
  assert.ok(!api.renderElevationSheet(model, 'west').svg.includes('opening-bay-window'));
  // 3D: the curved band adds faces a straight wall would not have.
  const scene = { triangles: [], lines: [] };
  api.state.model = model; api.state.systems = new Set(); api.buildScene(scene);
  const curved = scene.triangles.length;
  const straight = structuredClone(model); delete straight.walls.find(item => item.id === 'wall-bay').bulge;
  api.state.model = straight; api.buildScene(scene);
  assert.ok(curved > scene.triangles.length + 18 * 50);
});

test('arc walls draw in poché when the plan has no material detail', () => {
  const model = structuredClone(site);
  model.materials = model.materials.filter(item => !item.id.startsWith('mat-')).slice(0, 0);
  for (const item of model.walls) { delete item.layers; delete item.layerOrder; delete item.materialId; }
  for (const item of model.slabs) { delete item.layers; }
  model.surfaces = []; model.site = { ...model.site, groundMaterialId: undefined };
  delete model.site.groundMaterialId;
  const plan = api.renderPlanSheet(model, 'level-ground');
  assert.match(plan.svg, /data-entity="wall-bay"><polygon points="[^"]+" fill="#4d4d4d"/);
});
