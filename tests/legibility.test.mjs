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
  // The title block and the view title band are laid out separately from the drawing, so each region is
  // checked against itself rather than skipped.
  const titleBlockX = w - 10 - 64, viewTitleY = h - 10 - 6 - 18;
  const boxes = [];
  const transforms = [{ x: 0, y: 0, sx: 1, sy: 1 }];
  for (const token of svg.matchAll(/<g\b[^>]*>|<\/g>|<text\b[^>]*>[^<]*<\/text>/g)) {
    const tag = token[0], parent = transforms.at(-1);
    if (tag === '</g>') { transforms.pop(); continue; }
    if (tag.startsWith('<g')) {
      const next = { ...parent }, transform = tag.match(/transform="([^"]+)"/)?.[1] ?? '';
      for (const [, kind, args] of transform.matchAll(/([a-z]+)\(([^)]+)\)/g)) {
        const values = args.trim().split(/[,\s]+/).map(Number);
        if (kind === 'translate') { next.x += next.sx * values[0]; next.y += next.sy * (values[1] ?? 0); }
        else if (kind === 'scale') { next.sx *= values[0]; next.sy *= values[1] ?? values[0]; }
        else throw new Error(`Unsupported lettering group transform: ${kind}`);
      }
      transforms.push(next);
      continue;
    }
    const match = tag.match(/<text x="([-\d.]+)" y="([-\d.]+)" font-size="([\d.]+)" text-anchor="(\w+)"[^>]*?(?: transform="rotate\(([-\d.]+) [-\d.]+ [-\d.]+\)")?>([^<]*)<\/text>/);
    assert.ok(match, `Unsupported text shape: ${tag}`);
    const [, xs, ys, ss, anchor, rotate, raw] = match, x = Number(xs), y = Number(ys), s = Number(ss), text = decode(raw);
    if (!text.trim()) continue;
    const sheetX = parent.x + parent.sx * x, sheetY = parent.y + parent.sy * y;
    const region = sheetX >= titleBlockX ? 'title block' : sheetY >= viewTitleY ? 'view title' : 'drawing';
    const width = text.length * s * 0.62, x0 = anchor === 'start' ? 0 : anchor === 'end' ? -width : -width / 2;
    // Glyphs sit from about 0.75 of the size above the baseline to 0.2 below; shrink slightly so touching is not overlap.
    const local = [[x0 + 0.15, -0.72 * s], [x0 + width - 0.15, -0.72 * s], [x0 + width - 0.15, 0.15 * s], [x0 + 0.15, 0.15 * s]];
    const a = (Number(rotate) || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    boxes.push({ text, region, points: local.map(([px, py]) => ({
      x: parent.x + parent.sx * (x + px * c - py * sn),
      y: parent.y + parent.sy * (y + px * sn + py * c)
    })) });
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
  for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) if (boxes[i].region === boxes[j].region && quadsOverlap(boxes[i].points, boxes[j].points)) hits.push(`${boxes[i].region}: "${boxes[i].text}" / "${boxes[j].text}"`);
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
  // Overlaps inside the title block and the view title band are caught too.
  const block = '<svg viewBox="0 0 431.8 279.4"><text x="362" y="60" font-size="2.4" text-anchor="start" fill="#000">PROJECT NAME</text><text x="362" y="60.5" font-size="2.4" text-anchor="start" fill="#000">LOCATION</text><text x="40" y="262" font-size="4.8" text-anchor="start" fill="#000">SITE PLAN</text><text x="45" y="262" font-size="2.4" text-anchor="start" fill="#000">SCALE</text></svg>';
  assert.deepEqual(overlappingText(block).map(hit => hit.split(':')[0]), ['title block', 'view title']);
});

test('legend lettering is checked at its translated and scaled sheet position', () => {
  const text = '<text x="0" y="0" font-size="2.4" text-anchor="start">SD</text>';
  const svg = `<svg viewBox="0 0 431.8 279.4"><g transform="translate(362 80) scale(0.8)">${text}</g><g transform="translate(362 90) scale(0.8)">${text}</g></svg>`;
  assert.deepEqual(overlappingText(svg), []);
  assert.ok(textBoxes(svg).every(box => box.region === 'title block'));
  assert.equal(overlappingText(svg.replace('362 90', '362 80')).length, 1);
});
