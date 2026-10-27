import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadStudioApi } from '../scripts/export-drawings.mjs';

const skillRoot = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(skillRoot, 'assets', 'studio-template.html'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'lakeside-barn-residence', 'building.json'), 'utf8'));
const { api } = loadStudioApi(html);
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} expected ${expected}, got ${actual}`);
const errors = model => { api.state.model = model; return api.validateModel(model).filter(item => item.severity === 'error'); };

test('a positive bulge is a counter-clockwise arc that bows to the right of its chord', () => {
  const arc = api.bulgeArc({ x: 0, y: 0 }, { x: 2000, y: 0 }, 1);
  near(arc.radius, 1000, 1e-9);
  near(arc.center.x, 1000, 1e-9); near(arc.center.y, 0, 1e-9);
  assert.ok(arc.sweep > 0);
  const points = api.curvePoints([{ x: 0, y: 0, bulge: 1 }, { x: 2000, y: 0 }], false);
  const lowest = points.reduce((best, p) => p.y < best.y ? p : best);
  near(lowest.x, 1000, 30); near(lowest.y, -1000, 1);
  // Negative bulge mirrors it to the left of the chord.
  const left = api.curvePoints([{ x: 0, y: 0, bulge: -1 }, { x: 2000, y: 0 }], false);
  assert.ok(Math.max(...left.map(p => p.y)) > 999);
});

test('arcs over 180 degrees and small bulges keep the chord endpoints and the radius', () => {
  for (const bulge of [0.05, 0.4, -0.7, 2, -3.5]) {
    const a = { x: 100, y: 200 }, b = { x: 3100, y: -900 }, arc = api.bulgeArc(a, b, bulge);
    near(Math.hypot(a.x - arc.center.x, a.y - arc.center.y), arc.radius, 1e-6, `bulge ${bulge} start`);
    near(Math.hypot(b.x - arc.center.x, b.y - arc.center.y), arc.radius, 1e-6, `bulge ${bulge} end`);
    near(Math.abs(arc.sweep), 4 * Math.atan(Math.abs(bulge)), 1e-12);
    const points = api.curvePoints([{ ...a, bulge }, b], false);
    for (const p of points) near(Math.hypot(p.x - arc.center.x, p.y - arc.center.y), arc.radius, 1e-6);
    // Chord error stays inside the model tolerance.
    for (let i = 1; i < points.length; i += 1) {
      const mid = { x: (points[i].x + points[i - 1].x) / 2, y: (points[i].y + points[i - 1].y) / 2 };
      assert.ok(arc.radius - Math.hypot(mid.x - arc.center.x, mid.y - arc.center.y) <= 1.0001);
    }
  }
});

test('SVG arcs use sweep 0 for counter-clockwise model arcs once paper is y-down', () => {
  const map = p => ({ x: p.x / 10, y: -p.y / 10 });
  assert.equal(api.curvePathD([{ x: 0, y: 0, bulge: 1 }, { x: 2000, y: 0 }], false, map, 10), 'M0,0 A100,100 0 0 0 200,0');
  assert.equal(api.curvePathD([{ x: 0, y: 0, bulge: -3 }, { x: 2000, y: 0 }], false, map, 10).split(' ').slice(3, 5).join(' '), '1 1');
  assert.match(api.curvePathD([{ x: 0, y: 0, c1: { x: 0, y: 1000 }, c2: { x: 1000, y: 1000 } }, { x: 1000, y: 0 }, { x: 0, y: -500 }], true, map, 10), /^M0,0 C0,-100 100,-100 100,0 L0,50 Z$/);
});

test('Bezier tessellation stays within the chord tolerance', () => {
  const a = { x: 0, y: 0, c1: { x: 4000, y: 9000 }, c2: { x: 9000, y: -6000 } }, b = { x: 12000, y: 1000 };
  const points = api.curvePoints([a, b], false);
  const exact = t => { const s = 1 - t; return { x: s ** 3 * a.x + 3 * s * s * t * a.c1.x + 3 * s * t * t * a.c2.x + t ** 3 * b.x, y: s ** 3 * a.y + 3 * s * s * t * a.c1.y + 3 * s * t * t * a.c2.y + t ** 3 * b.y }; };
  const n = points.length - 1;
  for (let i = 0; i < n; i += 1) {
    const p = points[i], q = points[i + 1];
    for (const f of [0.25, 0.5, 0.75]) {
      const e = exact((i + f) / n), line = { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
      assert.ok(Math.hypot(e.x - line.x, e.y - line.y) <= 1.0001);
    }
  }
});

test('curved rings give exact areas, lengths, containment, and edge provenance', () => {
  const circle = [{ x: -1000, y: 0, bulge: 1 }, { x: 1000, y: 0, bulge: 1 }];
  const ring = api.ringOf(circle);
  near(api.polygonArea(ring), Math.PI * 1e6, Math.PI * 1e6 * 2e-3);
  near(api.curveLength(circle, true), 2 * Math.PI * 1000, 1);
  assert.ok(api.pointInPolygon({ x: 0, y: 990 }, ring) && !api.pointInPolygon({ x: 0, y: 1010 }, ring));
  assert.deepEqual([...new Set(ring.map(p => p.edge))], [0, 1]);
  // Straight rings are returned untouched, so legacy geometry is bit-for-bit the same.
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(api.ringOf(square), square);
  // Both windings triangulate to the full area.
  for (const shape of [ring, [...ring].reverse()]) {
    const area = api.triangulate(shape).reduce((sum, [i, j, k]) => sum + api.polygonArea([shape[i], shape[j], shape[k]]), 0);
    near(area, api.polygonArea(shape), 1);
  }
});

test('a section line crosses a curved U-shaped outline twice', () => {
  const u = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000, bulge: 1 }, { x: 4000, y: 4000 }, { x: 4000, y: 2000, bulge: -1 }, { x: 2000, y: 2000 }, { x: 2000, y: 4000, bulge: 1 }, { x: 0, y: 4000 }];
  assert.deepEqual([...api.curveIssues(u)], []);
  const intervals = api.segmentPolygonIntervals({ x: -1000, y: 3000 }, { x: 7000, y: 3000 }, api.ringOf(u));
  assert.equal(intervals.length, 2);
});

test('curve vertex rules are validated', () => {
  const issues = boundary => api.curveIssues(boundary);
  assert.ok(issues([{ x: 0, y: 0, bulge: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }]).includes('a zero or non-numeric bulge'));
  assert.ok(issues([{ x: 0, y: 0, bulge: 5 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }]).includes('a bulge beyond 3.7'));
  assert.ok(issues([{ x: 0, y: 0, c1: { x: 5, y: 5 } }, { x: 1000, y: 0 }, { x: 0, y: 1000 }]).includes('Bezier controls without both c1 and c2 as integer points'));
  assert.ok(issues([{ x: 0, y: 0, bulge: 0.5, c1: { x: 1, y: 1 }, c2: { x: 2, y: 2 } }, { x: 1000, y: 0 }, { x: 0, y: 1000 }]).includes('both a bulge and Bezier controls on one vertex'));
  assert.ok(issues([{ x: 0, y: 0, bulge: 0.5 }, { x: 5, y: 0 }, { x: 0, y: 1000 }]).includes('an arc with a chord under 10 mm'));
  assert.ok(api.curveIssues([{ x: 0, y: 0, c1: { x: 0, y: 1 }, c2: { x: 1, y: 1 } }, { x: 1000, y: 0 }, { x: 0, y: 1000 }], { bezier: false }).includes('Bezier controls where only straight segments and arcs are allowed'));
  assert.ok(api.pathIssues([{ x: 0, y: 0 }, { x: 1000, y: 0, bulge: 0.3 }], false).includes('a curve on the last vertex of an open path'));
  // A bulge large enough to fold the ring over itself is a self-intersection.
  assert.ok(issues([{ x: 0, y: 0, bulge: 1 }, { x: 2000, y: 0 }, { x: 1000, y: -1500 }]).includes('self-intersection'));
});

test('curved slabs and surfaces render in plan, section, and 3D', () => {
  const model = structuredClone(fixture);
  const slab = model.slabs.find(item => item.levelId === 'level-ground');
  const box = api.rectangleBounds(slab.boundary);
  // Round the south-east corner of the slab with a quarter arc (bulge tan(22.5 degrees)).
  slab.boundary = [{ x: box.minX, y: box.minY }, { x: box.maxX - 2000, y: box.minY, bulge: Math.tan(Math.PI / 8) }, { x: box.maxX, y: box.minY + 2000 }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }];
  model.materials = [...(model.materials ?? []), { id: 'mat-pavers', name: 'Pavers', category: 'concrete' }];
  model.surfaces = [{ id: 'surface-curved-walk', name: 'Curved Walk', levelId: 'level-ground', boundary: [{ x: box.minX, y: box.minY - 2400, c1: { x: box.minX + 3000, y: box.minY - 3600 }, c2: { x: box.minX + 6000, y: box.minY - 1200 } }, { x: box.minX + 9000, y: box.minY - 2400 }, { x: box.minX + 9000, y: box.minY - 1200, c1: { x: box.minX + 6000, y: box.minY }, c2: { x: box.minX + 3000, y: box.minY - 2400 } }, { x: box.minX, y: box.minY - 1200 }], topElevationMm: 0, thicknessMm: 100, materialId: 'mat-pavers', evidence: fixture.levels[0].evidence }];
  assert.deepEqual([...errors(model).map(item => item.code)], []);
  const plan = api.renderPlanSheet(model, 'level-ground');
  assert.match(plan.svg, /data-entity="surface-curved-walk"><path d="M[^"]+ C/);
  const scene = { triangles: [], lines: [] };
  api.state.model = model; api.state.systems = new Set();
  api.buildScene(scene);
  assert.ok(scene.triangles.length > 0);
  model.sections = [{ id: 'section-walk', name: 'Walk', start: { x: box.minX + 4500, y: box.minY - 5000 }, end: { x: box.minX + 4500, y: box.maxY + 1000 }, lookDirection: 'left' }];
  const geometry = api.sectionGeometry(model, model.sections[0]);
  assert.ok(geometry.cut.some(item => item.id === 'surface-curved-walk'));
  assert.ok(geometry.cut.some(item => item.id === slab.id));
});
