import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadStudioApi } from '../scripts/export-drawings.mjs';
import { inspect } from '../scripts/inspect.mjs';

const skillRoot = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(skillRoot, 'assets', 'studio-template.html'), 'utf8');
const site = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'hillside-garden-house', 'building.json'), 'utf8'));
const { api } = loadStudioApi(html);
const clone = model => structuredClone(model);
const findings = model => { api.state.model = model; return [...api.validateModel(model)]; };
const near = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance, `${message ?? ''} expected ${b}, got ${a}`);
// The centreline itself as straights and fillet arcs, for checking the outline against it.
function centreline(p) {
  const fillets = [...api.pathFillets(p)], vertices = [{ ...p.centerline[0] }];
  for (const f of fillets) {
    if (f.tangent > 0) vertices.push({ x: f.t1.x, y: f.t1.y, bulge: Math.tan(f.turn / 4) }, { x: f.t2.x, y: f.t2.y });
    else vertices.push({ x: p.centerline[f.index].x, y: p.centerline[f.index].y });
  }
  vertices.push({ ...p.centerline.at(-1) });
  return api.curvePoints(vertices, false);
}
const distanceToPolyline = (q, line) => Math.min(...line.slice(1).map((b, i) => { const a = line[i], dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(q.x - a.x - dx * t, q.y - a.y - dy * t); }));

const shapes = {
  'two curves': { centerline: [{ x: 0, y: 10000 }, { x: 0, y: 6000 }, { x: -3000, y: 3000 }, { x: -3000, y: 0 }], widthMm: 1200, cornerRadiusMm: 2400 },
  'S-curve with a per-point radius': { centerline: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 6000, y: 3000 }, { x: 10000, y: 3000, radiusMm: 0 }, { x: 10000, y: 8000 }], widthMm: 900, cornerRadiusMm: 2000 },
  'sharp corners only': { centerline: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 5000 }], widthMm: 3000 },
  'single straight': { centerline: [{ x: 0, y: 0 }, { x: 8000, y: 2000 }], widthMm: 3600 }
};

test('a path outline keeps its width everywhere: every edge point sits half the width from the centreline', () => {
  for (const [name, p] of Object.entries(shapes)) {
    assert.deepEqual([...api.centerlineIssues(p)], [], name);
    const outline = api.pathOutline(p);
    assert.deepEqual([...api.curveIssues(outline)], [], `${name} outline`);
    const line = centreline(p), ring = api.ringOf(outline);
    const ends = [p.centerline[0], p.centerline.at(-1)];
    for (const q of ring) {
      // Points on the square end caps lie between the edges; every other point is exactly half the width away.
      if (ends.some(e => Math.hypot(q.x - e.x, q.y - e.y) <= p.widthMm / 2 + 2)) continue;
      // The outside of a sharp corner is a miter point, farther than half the width by design.
      if ([...api.pathFillets(p)].some(f => f.tangent === 0 && Math.hypot(q.x - p.centerline[f.index].x, q.y - p.centerline[f.index].y) <= p.widthMm)) continue;
      near(distanceToPolyline(q, line), p.widthMm / 2, 3, `${name} at ${Math.round(q.x)},${Math.round(q.y)}`);
    }
    // Sharp corners add a corner square on the outside; elsewhere area is width times centreline length.
    if (name !== 'sharp corners only') near(api.polygonArea(ring), p.widthMm * api.centerlineLength(p), p.widthMm * api.centerlineLength(p) * 0.002, `${name} area`);
  }
});

test('path validation names the fix', () => {
  const issue = p => [...api.centerlineIssues(p)].join(' | ');
  assert.match(issue({ ...shapes['two curves'], cornerRadiusMm: 500 }), /under half the width \(600 mm\).*use at least 600 mm/);
  assert.match(issue({ ...shapes['two curves'], cornerRadiusMm: 9000 }), /reduce point 1 to \d+ mm and point 2 to \d+ mm, or move the points apart/);
  assert.match(issue({ centerline: [{ x: 0, y: 0 }, { x: 0, y: 0 }], widthMm: 900 }), /coincide/);
  assert.match(issue({ centerline: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 0, y: 1 }], widthMm: 900 }), /doubles back/);
  assert.match(issue({ centerline: [{ x: 0, y: 0 }], widthMm: 900 }), /at least two points/);
  // The suggested radius does fit.
  const fitted = clone(shapes['two curves']), suggestion = Number(issue({ ...fitted, cornerRadiusMm: 9000 }).match(/point 1 to (\d+) mm/)[1]);
  assert.deepEqual([...api.centerlineIssues({ ...fitted, cornerRadiusMm: suggestion })], []);
  const both = clone(site), walk = both.surfaces.find(item => item.id === 'surface-walk');
  walk.boundary = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }];
  assert.ok(findings(both).some(item => item.code === 'surface.geometry' && item.severity === 'error'));
  const tight = clone(site); tight.surfaces.find(item => item.id === 'surface-walk').path.cornerRadiusMm = 100;
  assert.ok(findings(tight).some(item => item.code === 'surface.path' && item.severity === 'error'));
});

test('edits behave the way a request reads', () => {
  const base = shapes['two curves'], bounds = p => { const ring = api.ringOf(api.pathOutline(p)); return { minX: Math.min(...ring.map(q => q.x)), maxX: Math.max(...ring.map(q => q.x)) }; };
  // "Move the curve east by 3 ft": move the interior points; the curve moves, the ends stay.
  const moved = { ...base, centerline: base.centerline.map((p, i) => i === 1 || i === 2 ? { ...p, x: p.x + 914 } : p) };
  assert.ok(bounds(moved).maxX > bounds(base).maxX + 400);
  // The ends stay put: the middle of each end cap is still the authored end point.
  const outline = api.pathOutline(moved), half = outline.length / 2;
  near((outline[0].x + outline.at(-1).x) / 2, base.centerline[0].x, 1); near((outline[0].y + outline.at(-1).y) / 2, base.centerline[0].y, 1);
  near((outline[half - 1].x + outline[half].x) / 2, base.centerline.at(-1).x, 1); near((outline[half - 1].y + outline[half].y) / 2, base.centerline.at(-1).y, 1);
  // "Make it gentler": a larger radius moves the arc's middle away from the corner point.
  const sag = r => { const f = api.pathFillets({ ...base, cornerRadiusMm: r })[0], corner = base.centerline[1]; return Math.min(...centreline({ ...base, cornerRadiusMm: r }).map(q => Math.hypot(q.x - corner.x, q.y - corner.y))) + 0 * f.r; };
  assert.ok(sag(3500) > sag(1000));
  // "Wider": width changes, centreline length does not.
  near(api.centerlineLength({ ...base, widthMm: 1800 }), api.centerlineLength(base), 1e-6);
});

test('the bow and fillet formulas in curves.md produce what they promise', () => {
  // bulge = 2s/c: a 6000 mm edge bowed 600 mm.
  const pts = api.curvePoints([{ x: 0, y: 0, bulge: 0.2 }, { x: 6000, y: 0 }], false);
  near(Math.max(...pts.map(q => Math.abs(q.y))), 600, 1);
  // Positive bows outward on a counter-clockwise outline.
  const square = [{ x: 0, y: 0, bulge: 0.2 }, { x: 6000, y: 0 }, { x: 6000, y: 6000 }, { x: 0, y: 6000 }];
  assert.ok(Math.min(...api.ringOf(square).map(q => q.y)) < -590);
  // Radius from bulge, and bulge from radius.
  const c = 6000, b = 0.2, R = c / 2 * (1 + b * b) / (2 * b);
  near(api.bulgeArc({ x: 0, y: 0 }, { x: c, y: 0 }, b).radius, R, 1e-6);
  near((2 * R - Math.sqrt(4 * R * R - c * c)) / c, b, 1e-9);
  // A square corner rounded to R = 1000: set back tan(45°) R, bulge tan(22.5°).
  const rounded = [{ x: 0, y: 0 }, { x: 4000, y: 0, bulge: Math.tan(Math.PI / 8) }, { x: 5000, y: 1000 }, { x: 5000, y: 5000 }, { x: 0, y: 5000 }];
  near(api.bulgeArc(rounded[1], rounded[2], rounded[1].bulge).radius, 1000, 1e-6);
  near(api.polygonArea(api.ringOf(rounded)), 25e6 - (1 - Math.PI / 4) * 1e6, 3000);
});

test('placement checks catch a walk that leaves the lot or runs under the house', () => {
  assert.deepEqual([...findings(clone(site)).filter(item => ['site.outside-lot', 'surface.under-building', 'planting.under-building'].includes(item.code))], []);
  const out = clone(site); out.surfaces.find(item => item.id === 'surface-walk').path.centerline.at(-1).y = -2000;
  assert.ok(findings(out).some(item => item.code === 'site.outside-lot' && item.entityId === 'surface-walk'));
  const under = clone(site); under.surfaces.find(item => item.id === 'surface-walk').path.centerline[0].y = 12000;
  assert.ok(findings(under).some(item => item.code === 'surface.under-building' && item.entityId === 'surface-walk'));
  const tree = clone(site); tree.plantings.find(item => item.id === 'planting-maple-2').position = { x: 9000, y: 12000 };
  assert.ok(findings(tree).some(item => item.code === 'planting.under-building'));
});

test('inspect reports a path as numbers and the script runs on a project', () => {
  const report = inspect(html, clone(site), 'surface-walk');
  assert.equal(report.path.widthMm, 1219);
  assert.deepEqual([...report.path.corners.map(c => c.radiusMm)], [2438, 2438]);
  near(report.areaMm2, 1219 * report.path.centerlineLengthMm, 1219 * 2);
  assert.ok(report.clearanceToBuildingMm >= 0 && report.clearanceToPropertyLineMm > 0);
  assert.deepEqual([...report.findings], []);
  assert.ok(inspect(html, clone(site), null).elements.some(item => item.id === 'surface-walk'));
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'), 'inspect-'));
  try {
    fs.mkdirSync(path.join(dir, 'models'));
    fs.writeFileSync(path.join(dir, 'models', 'building.json'), JSON.stringify(site));
    const out = JSON.parse(execFileSync(process.execPath, [path.join(skillRoot, 'scripts', 'inspect.mjs'), '--project', dir, '--id', 'surface-stepping-path'], { encoding: 'utf8' }));
    assert.equal(out.path.widthMm, 914);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a guided edit (bend point between the lead-ins) keeps the walk square to the door and the street', () => {
  const model = clone(site), walk = model.surfaces.find(item => item.id === 'surface-walk'), c = walk.path.centerline;
  const before = inspect(html, clone(site), 'surface-walk');
  walk.path.centerline = [c[0], { x: c[0].x, y: 6800 }, { x: Math.round((c[1].x + c[2].x) / 2) + 914, y: Math.round((c[1].y + c[2].y) / 2) }, { x: c[3].x, y: 3200 }, c[3]];
  walk.path.cornerRadiusMm = 3048;
  const after = inspect(html, model, 'surface-walk');
  assert.deepEqual([...after.findings], []);
  assert.deepEqual(JSON.parse(JSON.stringify(after.path.ends.map(e => e.headingDeg))), JSON.parse(JSON.stringify(before.path.ends.map(e => e.headingDeg))));
  assert.equal(after.path.widthMm, before.path.widthMm);
  assert.ok(after.clearanceToBuildingMm >= 0 && after.clearanceToPropertyLineMm > 0);
});
