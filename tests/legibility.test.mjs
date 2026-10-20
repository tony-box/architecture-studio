// Legibility: no two pieces of lettering on a drawing sheet may overlap. Text boxes come from the same
// font metrics the renderer lays out with (width 0.62 x height per character), rotated as drawn.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildDrawingSet } from '../scripts/export-drawings.mjs';

const skillRoot = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(skillRoot, 'assets', 'studio-template.html'), 'utf8');
const examples = fs.readdirSync(path.join(skillRoot, 'examples'), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && fs.existsSync(path.join(skillRoot, 'examples', entry.name, 'building.json'))).map(entry => entry.name);

const decode = text => text.replace(/&(amp|lt|gt|quot|#39);/g, 'x');
export function textBoxes(svg) {
  const [, w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
  // The title block and the view title band have a fixed layout of their own.
  const titleBlockX = w - 10 - 64, viewTitleY = h - 10 - 6 - 18;
  const boxes = [];
  for (const match of svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)" font-size="([\d.]+)" text-anchor="(\w+)"[^>]*?(?: transform="rotate\(([-\d.]+) [-\d.]+ [-\d.]+\)")?>([^<]*)<\/text>/g)) {
    const [, xs, ys, ss, anchor, rotate, raw] = match, x = Number(xs), y = Number(ys), s = Number(ss), text = decode(raw);
    if (!text.trim() || x >= titleBlockX || y >= viewTitleY) continue;
    const width = text.length * s * 0.62, x0 = anchor === 'start' ? 0 : anchor === 'end' ? -width : -width / 2;
    // Glyphs sit from about 0.75 of the size above the baseline to 0.2 below; shrink slightly so touching is not overlap.
    const local = [[x0 + 0.15, -0.72 * s], [x0 + width - 0.15, -0.72 * s], [x0 + width - 0.15, 0.15 * s], [x0 + 0.15, 0.15 * s]];
    const a = (Number(rotate) || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    boxes.push({ text, points: local.map(([px, py]) => ({ x: x + px * c - py * sn, y: y + px * sn + py * c })) });
  }
  return boxes;
}
// Separating-axis test for two convex quadrilaterals.
function quadsOverlap(p, q) {
  for (const poly of [p, q]) for (let i = 0; i < 4; i += 1) {
    const a = poly[i], b = poly[(i + 1) % 4], axis = { x: -(b.y - a.y), y: b.x - a.x };
    const project = points => points.map(pt => pt.x * axis.x + pt.y * axis.y);
    const pp = project(p), qq = project(q);
    if (Math.max(...pp) <= Math.min(...qq) || Math.max(...qq) <= Math.min(...pp)) return false;
  }
  return true;
}
export function overlappingText(svg) {
  const boxes = textBoxes(svg), hits = [];
  for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) if (quadsOverlap(boxes[i].points, boxes[j].points)) hits.push(`"${boxes[i].text}" / "${boxes[j].text}"`);
  return hits;
}

test('no lettering overlaps other lettering on any example sheet', () => {
  const problems = [];
  for (const name of examples) {
    const model = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', name, 'building.json'), 'utf8'));
    for (const sheet of buildDrawingSet(html, model).sheets) for (const hit of overlappingText(sheet.svg)) problems.push(`${name} ${sheet.sheetId}: ${hit}`);
  }
  assert.deepEqual(problems, []);
});

test('the overlap check finds lettering drawn on top of other lettering', () => {
  const svg = '<svg viewBox="0 0 431.8 279.4"><text x="100" y="100" font-size="2.4" text-anchor="middle" fill="#000">24\'-0"</text><text x="102" y="100.5" font-size="2.4" text-anchor="start" fill="#000">IG</text><text x="100" y="140" font-size="2.4" text-anchor="middle" fill="#000">CLEAR</text></svg>';
  assert.equal(overlappingText(svg).length, 1);
});
