import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildLakesideBarnResidence } from '../examples/build-lakeside-barn-residence.mjs';
import { loadStudioApi } from '../scripts/export-drawings.mjs';

const root = path.resolve(import.meta.dirname, '..');
const model = buildLakesideBarnResidence();
const { api } = loadStudioApi(fs.readFileSync(path.join(root, 'assets', 'studio-template.html'), 'utf8'));
const ft = value => Math.round(value * 304.8);

test('the rebuilt barn is generated from its current brief', () => {
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'examples', 'lakeside-barn-residence', 'building.json'), 'utf8'));
  assert.deepEqual(saved, model);
  assert.equal(model.spaces.filter(space => space.use === 'sleeping').length, 2);
  assert.deepEqual(model.roofs[0].footprint[2], { x: ft(36), y: ft(48) });
  assert.ok(!model.site?.propertyLine, 'no invented lake boundary or survey');
  assert.ok(!model.stairs.some(stair => stair.start.x < ft(36)), 'no internal stair');
});

test('walls are layered wood-frame assemblies, and rooms end at their finished faces', () => {
  const category = id => model.materials.find(item => item.id === id).category;
  const layersOf = wall => wall.layers.map(item => [item.id, category(item.materialId), item.thicknessMm]);
  for (const wall of model.walls) {
    assert.equal(wall.layers.reduce((sum, item) => sum + item.thicknessMm, 0), wall.thicknessMm, `${wall.id} layers fill the wall`);
    if (wall.kind === 'exterior') {
      assert.equal(wall.layerOrder, 'interior-to-exterior');
      assert.deepEqual(layersOf(wall), [['gypsum', 'gypsum', 13], ['studs', 'insulation-batt', 140], ['sheathing', 'engineered-wood', 12], ['siding', 'generic', 19]], wall.id);
    } else {
      assert.deepEqual(layersOf(wall), [['gypsum-left', 'gypsum', 13], ['studs', 'wood-framing', 90], ['gypsum-right', 'gypsum', 13]], wall.id);
    }
  }
  assert.match(model.materials.find(item => item.id === 'mat-siding').name, /not yet chosen/, 'the siding type stays an open decision');
  // The living room reaches the exterior faces and stops at the partition face, with no gap or overlap.
  const living = model.spaces.find(space => space.id === 'space-great-room').boundary;
  assert.deepEqual([Math.min(...living.map(p => p.x)), Math.min(...living.map(p => p.y))], [92, 92]);
  assert.equal(Math.max(...living.map(p => p.y)), ft(24) - 58);
  // Fixtures that stand against an exterior wall still touch its inside face.
  const sink = model.fixtures.find(item => item.id === 'fixture-kitchen-sink');
  assert.equal(sink.position.x - sink.size.y / 2, 92);
});

test('exterior stair meets full-width landings at the residence datum', () => {
  const stair = model.stairs[0], deck = api.outlineOf(model, model.surfaces.find(item => item.id === 'surface-deck'));
  const pad = model.surfaces.find(item => item.id === 'surface-stair-landing');
  const bounds = vertices => ({
    minX: Math.min(...vertices.map(p => p.x)), maxX: Math.max(...vertices.map(p => p.x)),
    minY: Math.min(...vertices.map(p => p.y)), maxY: Math.max(...vertices.map(p => p.y))
  });
  const d = bounds(deck), p = bounds(pad.boundary);
  assert.ok(stair.start.x - stair.widthMm / 2 > ft(36) + model.roofs[0].overhangMm, 'open flight clears the roof overhang');
  assert.equal(stair.end.y, d.minY);
  assert.equal(stair.start.y, p.maxY);
  for (const b of [d, p]) {
    assert.ok(b.minX <= stair.start.x - stair.widthMm / 2 && b.maxX >= stair.start.x + stair.widthMm / 2);
    assert.ok(b.maxY - b.minY >= stair.widthMm, 'landing depth accommodates the flight width');
  }
  assert.equal(stair.end.y - stair.start.y, (stair.riserCount - 1) * stair.treadDepthMm);
  const entry = model.openings.find(item => item.id === 'opening-residence-entry');
  assert.ok(entry.offsetMm > d.minY && entry.offsetMm + entry.widthMm < d.maxY);
  assert.equal(model.surfaces.find(item => item.id === 'surface-deck').topElevationMm, model.levels[1].elevationMm);
  assert.equal(model.slabs.find(item => item.id === 'slab-upper').boundary.length, 4, 'continuous floor with no stair hole');
  for (const post of model.columns.filter(item => item.id.startsWith('column-deck-guard-') && item.position.y < d.minY + 200)) {
    const left = post.position.x - post.shape.widthMm / 2, right = post.position.x + post.shape.widthMm / 2;
    assert.ok(right <= stair.start.x - stair.widthMm / 2 || left >= stair.start.x + stair.widthMm / 2, 'guard posts leave the full flight width clear');
  }
});

// A 600 mm-wide occupant must reach the rooms without crossing a wall or a furniture footprint.
function reachable(levelId, start, destinations) {
  const radius = 300, step = 100, width = ft(36), depth = ft(48);
  const walls = model.walls.filter(wall => wall.levelId === levelId);
  const objects = [...model.fixtures, ...model.equipment].filter(item => item.levelId === levelId);
  const face = walls.find(wall => wall.kind === 'exterior').thicknessMm / 2;
  const blocked = (x, y) => {
    if (x < face + radius || x > width - face - radius || y < face + radius || y > depth - face - radius) return true;
    for (const wall of walls) {
      const vertical = wall.start.x === wall.end.x, axis = vertical ? 'y' : 'x';
      const across = vertical ? x : y, along = vertical ? y : x;
      if (Math.abs(across - (vertical ? wall.start.x : wall.start.y)) > wall.thicknessMm / 2 + radius) continue;
      if (along < Math.min(wall.start[axis], wall.end[axis]) - radius || along > Math.max(wall.start[axis], wall.end[axis]) + radius) continue;
      const distance = Math.sign(wall.end[axis] - wall.start[axis]) * (along - wall.start[axis]);
      if (!model.openings.some(opening => opening.wallId === wall.id && ['door', 'opening'].includes(opening.kind) &&
        distance >= opening.offsetMm + radius && distance <= opening.offsetMm + opening.widthMm - radius)) return true;
    }
    return objects.some(item => {
      const angle = -item.rotationDeg * Math.PI / 180, dx = x - item.position.x, dy = y - item.position.y;
      const localX = dx * Math.cos(angle) - dy * Math.sin(angle), localY = dx * Math.sin(angle) + dy * Math.cos(angle);
      return Math.abs(localX) < item.size.x / 2 + radius && Math.abs(localY) < item.size.y / 2 + radius;
    });
  };
  const snap = value => Math.round(value / step) * step, key = (x, y) => `${x},${y}`;
  const queue = [[snap(start[0]), snap(start[1])]], seen = new Set([key(...queue[0])]);
  assert.ok(!blocked(...queue[0]), 'entry starts in clear floor space');
  for (let i = 0; i < queue.length; i += 1) {
    const [x, y] = queue[i];
    for (const [nx, ny] of [[x + step, y], [x - step, y], [x, y + step], [x, y - step]]) {
      const id = key(nx, ny);
      if (!seen.has(id) && !blocked(nx, ny)) { seen.add(id); queue.push([nx, ny]); }
    }
  }
  for (const [name, x, y] of destinations) assert.ok(seen.has(key(snap(x), snap(y))), `${name} has a clear route from the entrance`);
}

test('rooms have real access around fixtures and furniture, not just named polygons', () => {
  reachable('level-upper', [ft(36) - 800, Math.round(ft(48) * 2 / 3)], [
    ['living room', 7500, 3500], ['bedroom 1', 2100, 11600], ['bedroom 2', 7600, 11600],
    ['bathroom', 2100, 9000], ['laundry', 4200, 8800]
  ]);
  reachable('level-ground', [800, Math.round(ft(48) / 3)], [
    ['vehicle bays', 8000, 5000], ['rear workbench', 8200, 12000], ['utility', 4400, 9000], ['tool storage', 3000, 12500]
  ]);
});

test('systems use orthogonal routes and keep dwelling air out of the workshop', () => {
  for (const system of model.systems) for (const edge of system.edges) {
    for (let i = 1; i < edge.path.length; i += 1) {
      assert.equal(['x', 'y', 'z'].filter(axis => edge.path[i][axis] !== edge.path[i - 1][axis]).length, 1, edge.id);
    }
  }
  const hvac = model.systems.find(item => item.id === 'system-mechanical');
  assert.ok(hvac.nodes.filter(item => item.kind === 'ductless-head').every(item => item.levelId === 'level-upper'));
  assert.equal(model.systems.filter(item => item.id.startsWith('system-exhaust-')).length, 3);
  for (const id of ['fixture-toilet', 'fixture-shower', 'fixture-washer', 'fixture-dryer', 'fixture-kitchen-sink']) {
    assert.ok(model.fixtures.find(item => item.id === id).connections.length, `${id} is connected`);
  }
});

test('exterior access appears in exposed elevations but not through the building', () => {
  for (const side of ['east', 'north', 'south']) {
    const sheet = api.renderElevationSheet(model, side);
    for (const id of ['stair-main', 'surface-deck', 'column-deck-1', 'beam-deck']) assert.ok(sheet.svg.includes(`data-entity="${id}"`), `${side}: ${id}`);
  }
  const west = api.renderElevationSheet(model, 'west').svg;
  for (const id of ['stair-main', 'surface-deck', 'column-deck-1', 'beam-deck']) assert.ok(!west.includes(`data-entity="${id}"`), `${id} is hidden behind the west facade`);
  const structure = api.renderElevationSheet(model, 'east', { structureOnly: true });
  assert.ok(!structure.svg.includes('data-entity="surface-deck"'));
  assert.ok(structure.svg.includes('data-entity="stair-main"'));
  assert.equal(structure.ratio, api.renderElevationSheet(model, 'east').ratio);
  const north = api.renderElevationSheet(model, 'north').svg;
  const roof = north.match(/data-entity="roof-main"><polygon points="([^"]+)"/)[1].split(' ').map(point => point.split(',').map(Number));
  assert.ok(Math.abs(roof[4][0] - (roof[0][0] + roof[1][0]) / 2) < 0.02, 'the exterior deck does not shift the gable ridge');
  const interior = structuredClone(model);
  interior.columns.push({ ...interior.columns[0], id: 'column-interior', position: { x: ft(18), y: ft(24) } });
  for (const side of ['north', 'east', 'south', 'west']) {
    assert.ok(!api.renderElevationSheet(interior, side).svg.includes('data-entity="column-interior"'), `${side} hides interior posts`);
  }
  const stairSection = api.sectionGeometry(model, model.sections[1]);
  assert.ok(stairSection.cut.some(item => item.id === 'stair-main'));
  assert.ok(stairSection.cut.some(item => item.id === 'surface-deck'));
});
