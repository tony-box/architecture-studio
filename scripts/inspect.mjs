// Reports an element of an Architecture Studio model as numbers, so an agent can check a shape it
// just wrote without looking at a drawing: size, area, path width and radii, clearance to the
// building and the property line, and every validation finding that names the element.
//
//   node <skill>/scripts/inspect.mjs --project <dir>                 # list inspectable elements
//   node <skill>/scripts/inspect.mjs --project <dir> --id <entity>   # report one element
//
// Lengths are millimetres; the model's display units appear in `details`.
import fs from 'node:fs';
import path from 'node:path';
import { loadStudioApi } from './export-drawings.mjs';
import { isMain, parseArgs, readJson, resolveStudioPage } from './lib.mjs';

const round = value => Math.round(value);
const crosses = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};
function pointToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}
// Smallest gap between two outlines, edge to edge; 0 when their edges cross.
function ringGap(a, b) {
  let gap = Infinity;
  for (let i = 0; i < a.length; i += 1) {
    const p = a[i], q = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      const r = b[j], s = b[(j + 1) % b.length];
      if (crosses(p, q, r, s)) return 0;
      gap = Math.min(gap, pointToSegment(p, r, s), pointToSegment(q, r, s), pointToSegment(r, p, q), pointToSegment(s, p, q));
    }
  }
  return gap;
}

export function inspect(html, model, id) {
  const { api } = loadStudioApi(html);
  if (typeof api.outlineOf !== 'function') throw new Error('This studio page predates inspect.mjs. Run scripts/init.mjs <project> --update.');
  api.state.model = model;
  const findings = api.validateModel(model);
  if (!id) {
    const groups = ['surfaces', 'plantings', 'openings', 'slabs', 'spaces', 'walls', 'foundations'];
    return { elements: groups.flatMap(group => (model[group] ?? []).map(item => ({ id: item.id, group, name: item.name ?? null }))), errors: findings.filter(item => item.severity === 'error').length };
  }
  const details = api.entityDetails(model, id);
  if (!details) throw new Error(`No element with id ${id}.`);
  const entity = [...(model.surfaces ?? []), ...(model.plantings ?? []), ...(model.slabs ?? []), ...(model.spaces ?? []), ...(model.foundations ?? [])].find(item => item.id === id);
  const report = { id, type: details.type, title: details.title, details: Object.fromEntries(details.dims), findings: findings.filter(item => item.entityId === id).map(({ severity, code, message }) => ({ severity, code, message })) };
  const outline = entity ? api.outlineOf(model, entity) : null;
  if (outline) {
    const ring = api.ringOf(outline), xs = ring.map(p => p.x), ys = ring.map(p => p.y);
    report.bounds = { minX: round(Math.min(...xs)), minY: round(Math.min(...ys)), maxX: round(Math.max(...xs)), maxY: round(Math.max(...ys)) };
    report.areaMm2 = round(api.polygonArea(ring));
    if (entity.path) {
      const resolved = api.resolvePath(model, entity.path);
      report.path = {
        widthMm: resolved.widthMm,
        centerlineLengthMm: round(api.centerlineLength(resolved)),
        // Where every centreline point ended up, with the anchor that placed it.
        centerline: resolved.centerline.map((p, i) => ({ x: p.x, y: p.y, ...(entity.path.centerline[i].anchor ? { anchor: entity.path.centerline[i].anchor } : {}) })),
        corners: api.pathFillets(resolved).map(f => ({ point: f.index, turnDeg: round(f.turn * 180 / Math.PI), radiusMm: f.r, tangentMm: round(f.tangent) })),
        // Direction each end runs out of the path, in degrees clockwise from project north (+y). An end
        // that meets a door, wall, or kerb square to it runs at 0, 90, 180, or 270 when they are axis-aligned.
        ends: [[0, 1], [resolved.centerline.length - 1, resolved.centerline.length - 2]].map(([end, next]) => {
          const a = resolved.centerline[next], b = resolved.centerline[end];
          return { point: end, headingDeg: round((Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI) + 360) % 360 };
        }),
        outline
      };
    }
    // Clearances: negative means the shape overlaps the building or crosses the lot line, by the overlap's depth.
    const lowest = [...model.levels].sort((a, b) => a.elevationMm - b.elevationMm)[0];
    const footprints = model.slabs.filter(slab => slab.levelId === lowest.id && slab.id !== id).map(slab => api.ringOf(slab.boundary));
    const overlapDepth = (inner, outer) => Math.max(0, ...inner.filter(p => api.pointInPolygon(p, outer)).map(p => Math.min(...outer.map((a, i) => pointToSegment(p, a, outer[(i + 1) % outer.length])))));
    if (footprints.length) report.clearanceToBuildingMm = round(Math.min(...footprints.map(foot => {
      const gap = ringGap(ring, foot), depth = Math.max(overlapDepth(ring, foot), overlapDepth(foot, ring));
      return depth > 0 || gap === 0 ? -Math.max(depth, 1) : gap;
    })));
    if (model.site?.propertyLine) {
      const lot = api.ringOf(model.site.propertyLine.boundary), outside = ring.filter(p => !api.pointInPolygon(p, lot));
      const gap = ringGap(ring, lot);
      report.clearanceToPropertyLineMm = round(outside.length || gap === 0 ? -Math.max(1, ...outside.map(p => Math.min(...lot.map((a, i) => pointToSegment(p, a, lot[(i + 1) % lot.length]))))) : gap);
    }
  } else if (entity?.position) report.position = entity.position;
  // Doors and windows: the points an anchor can name, so a walk or patio can be lined up with them.
  const opening = (model.openings ?? []).find(item => item.id === id);
  if (opening) {
    report.anchors = {};
    for (const face of ['exterior', 'interior']) for (const at of ['start', 'center', 'end']) {
      const found = api.anchorPoint(model, { openingId: id, at, face });
      if (!found.error) report.anchors[`${face}-${at}`] = { ...found.point, outward: { x: Number(found.outward.x.toFixed(4)), y: Number(found.outward.y.toFixed(4)) } };
    }
    report.widthMm = opening.widthMm;
  }
  return report;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node <skill>/scripts/inspect.mjs [--project <dir>] [--id <entity>] [--page <index.html>] [--model <models/building.json>]');
    return;
  }
  const projectDir = path.resolve(String(args.project ?? args._[0] ?? '.'));
  const page = resolveStudioPage(projectDir, args.page ? String(args.page) : undefined);
  const model = readJson(path.resolve(projectDir, String(args.model ?? 'models/building.json')));
  try {
    console.log(JSON.stringify(inspect(fs.readFileSync(page, 'utf8'), model, args.id ? String(args.id) : null), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (isMain(import.meta)) main();
