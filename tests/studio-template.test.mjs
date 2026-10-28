import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { buildDrawingSet, extractStudioScript, loadStudioApi } from '../scripts/export-drawings.mjs';
import { expectedPreview } from '../scripts/build-preview.mjs';

const skillRoot = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(skillRoot, 'assets', 'studio-template.html'), 'utf8');
const readFixture = name => JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', name, 'building.json'), 'utf8'));
const fixture = readFixture('lakeside-barn-residence');
const metricFixture = readFixture('compact-metric-studio');
const materialFixture = readFixture('mixed-material-workshop');
const metricMaterialFixture = readFixture('mixed-material-workshop-metric');

function withoutCatalog(source) {
  const model = structuredClone(source);
  delete model.materials;
  for (const item of [...(model.walls ?? []), ...(model.slabs ?? []), ...(model.stairs ?? [])]) {
    delete item.layers;
    delete item.layerOrder;
    delete item.materialId;
  }
  return model;
}

function loadStudio() {
  return loadStudioApi(html);
}
function cloneFixture() {
  return structuredClone(fixture);
}

function errorCodes(api, model) {
  api.state.model = model;
  return api.validateModel(model).filter(finding => finding.severity === 'error').map(finding => finding.code);
}

test('fixture is renderable while invalid and unsupported geometry is blocked', () => {
  const { api } = loadStudio();
  assert.equal(errorCodes(api, cloneFixture()).length, 0);

  const selfIntersecting = cloneFixture();
  selfIntersecting.spaces[0].boundary = [{ x: 0, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }, { x: 2000, y: 0 }];
  assert.ok(errorCodes(api, selfIntersecting).includes('polygon.geometry'));

  const duplicateElevation = cloneFixture();
  duplicateElevation.levels[1].elevationMm = 0;
  duplicateElevation.stairs = [];
  assert.ok(errorCodes(api, duplicateElevation).includes('level.duplicate-elevation'));

  const invalidOpening = cloneFixture();
  invalidOpening.openings[0].widthMm = -100;
  assert.ok(errorCodes(api, invalidOpening).includes('opening.geometry'));

  const unknownRoofLevel = cloneFixture();
  unknownRoofLevel.roofs[0].levelId = 'missing-level';
  assert.ok(errorCodes(api, unknownRoofLevel).includes('reference.level'));

  const lShapedSlab = cloneFixture();
  lShapedSlab.slabs[0].boundary = [{ x: 0, y: 0 }, { x: 9600, y: 0 }, { x: 9600, y: 6000 }, { x: 4800, y: 6000 }, { x: 4800, y: 13200 }, { x: 0, y: 13200 }];
  assert.ok(!errorCodes(api, lShapedSlab).includes('renderer.unsupported-slab'), 'any simple slab outline renders');

  const unsupportedRoof = cloneFixture();
  unsupportedRoof.roofs[0].kind = 'hip';
  assert.ok(errorCodes(api, unsupportedRoof).includes('renderer.unsupported-roof'));
});

test('system plans are level-specific and reject disconnected paths', () => {
  const { api } = loadStudio();
  const model = cloneFixture();
  api.state.model = model;
  api.state.levelId = 'level-ground';
  const ground = api.planSvg(true);
  api.state.levelId = 'level-upper';
  const upper = api.planSvg(true);
  assert.notEqual(ground, upper);
  assert.match(ground, /plumbing-edge-entry-stack/);
  assert.doesNotMatch(ground, /plumbing-edge-kitchen/);
  assert.match(upper, /plumbing-edge-kitchen/);

  model.systems[0].edges[0].path[0] = { x: 999999, y: 999999, z: 999999 };
  assert.ok(errorCodes(api, model).includes('system.endpoint'));
});

test('elevations use project directions and wall base offsets', () => {
  const { api } = loadStudio();
  const model = cloneFixture();
  api.state.model = model;
  api.state.levelId = 'level-ground';
  api.state.elevation = 'north';
  assert.doesNotMatch(api.elevationSvg(), /opening-overhead-west/);
  api.state.elevation = 'south';
  const baseline = api.elevationSvg();
  assert.match(baseline, /opening-overhead-west/);
  model.walls.find(wall => wall.id === 'wall-g-south').baseOffsetMm = 500;
  assert.notEqual(api.elevationSvg(), baseline);
});

for (const source of ['roof', 'space']) {
  test(`elevation openings use wall faces when the ${source} extends beyond wall centerlines`, () => {
    const { api } = loadStudio();
    const model = cloneFixture();
    const faces = { north: 'north', east: 'east', south: 'south', west: 'west' };
    model.openings = model.walls.map(wall => ({
      ...model.openings[0], id: `opening-${wall.id}`, wallId: wall.id,
      kind: 'window', offsetMm: 500, widthMm: 900, heightMm: 900, sillMm: 1000
    }));
    const baseline = Object.fromEntries(Object.keys(faces).map(side => [side, api.renderElevationSheet(model, side).svg]));
    const maxX = Math.max(...model.walls.flatMap(wall => [wall.start.x, wall.end.x]));
    const maxY = Math.max(...model.walls.flatMap(wall => [wall.start.y, wall.end.y]));
    const boundary = [{ x: -102, y: -102 }, { x: maxX + 102, y: -102 }, { x: maxX + 102, y: maxY + 102 }, { x: -102, y: maxY + 102 }];
    if (source === 'roof') model.roofs[0].footprint = boundary;
    else model.spaces[0].boundary = boundary;

    for (const [side, face] of Object.entries(faces)) {
      const svg = api.renderElevationSheet(model, side).svg;
      for (const opening of model.openings) {
        const expected = opening.wallId === `wall-g-${face}` || opening.wallId === `wall-u-${face}`;
        assert.equal(svg.includes(`data-entity="${opening.id}"`), expected, `${side}: ${opening.id}`);
      }
      assert.equal(svg, baseline[side], `${source} bounds must not move or hide ${side} openings`);
    }
  });
}

test('3D prisms face outward and stairs affect scene geometry', () => {
  const { api } = loadStudio();
  const prism = [];
  api.pushPrism(prism, 0, 0, 0, 2, 2, 2, 0, [1, 1, 1]);
  for (let index = 0; index < prism.length; index += 18) {
    const a = prism.slice(index, index + 3), b = prism.slice(index + 6, index + 9), c = prism.slice(index + 12, index + 15);
    const u = b.map((value, axis) => value - a[axis]), v = c.map((value, axis) => value - a[axis]);
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const center = a.map((value, axis) => (value + b[axis] + c[axis]) / 3);
    assert.ok(normal.reduce((sum, value, axis) => sum + value * center[axis], 0) > 0);
  }

  const scene = { triangles: [], lines: [] };
  api.state.model = cloneFixture();
  api.buildScene(scene);
  const withStair = scene.triangles.length;
  api.state.model.stairs = [];
  api.buildScene(scene);
  assert.ok(withStair > scene.triangles.length);
});

test('flying moves where you look at a steady speed per second, whatever the frame rate', () => {
  const { api } = loadStudio();
  const start = { walkPosition: [0, 1.7, 0], yaw: 0, pitch: 0 };
  const hold = (keys, frames, dt, mode = 'walk', camera = start) => {
    let at = camera;
    for (let i = 0; i < frames; i += 1) at = { ...at, ...api.cameraStep(at, new Set(keys), dt, mode) };
    return at;
  };
  const close = (actual, expected, label) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-9, `${label}: ${actual} vs ${expected}`));

  // Facing -z at yaw 0: one second of W is the flying speed, at 60 or 144 frames a second.
  close(hold(['KeyW'], 60, 1 / 60).walkPosition, [0, 1.7, -api.WALK.speed], '60 fps');
  close(hold(['KeyW'], 144, 1 / 144).walkPosition, [0, 1.7, -api.WALK.speed], '144 fps');
  close(hold(['KeyW', 'Shift'], 60, 1 / 60).walkPosition, [0, 1.7, -api.WALK.run], 'Shift goes faster');
  const diagonal = hold(['KeyW', 'KeyD'], 60, 1 / 60).walkPosition;
  assert.ok(Math.abs(Math.hypot(diagonal[0], diagonal[2]) - api.WALK.speed) < 1e-9, 'diagonal is not faster');
  close(hold(['KeyW', 'KeyS'], 60, 1 / 60).walkPosition, [0, 1.7, 0], 'opposite keys cancel');

  // Aiming up climbs and aiming down dives along the line of sight, still at the flying speed.
  const up = { ...start, pitch: 0.5 }, down = { ...start, pitch: -0.5 }, highUp = { ...up, walkPosition: [0, 5, 0] };
  close(hold(['KeyW'], 60, 1 / 60, 'walk', up).walkPosition, [0, 1.7 + api.WALK.speed * Math.sin(0.5), -api.WALK.speed * Math.cos(0.5)], 'climb');
  close(hold(['KeyS'], 60, 1 / 60, 'walk', highUp).walkPosition, [0, 5 - api.WALK.speed * Math.sin(0.5), api.WALK.speed * Math.cos(0.5)], 'back away and down');
  assert.ok(hold(['KeyW'], 20, 1 / 60, 'walk', down).walkPosition[1] < 1.7, 'dive');
  close(hold(['KeyD'], 60, 1 / 60, 'walk', up).walkPosition, [api.WALK.speed, 1.7, 0], 'A and D strafe level');
  const climbingDiagonal = hold(['KeyW', 'KeyD'], 60, 1 / 60, 'walk', up).walkPosition;
  assert.ok(Math.abs(Math.hypot(climbingDiagonal[0], climbingDiagonal[1] - 1.7, climbingDiagonal[2]) - api.WALK.speed) < 1e-9, 'diagonal climb is not faster');
  assert.equal(hold(['KeyW'], 600, 1 / 60, 'walk', down).walkPosition[1], -api.WALK.below, 'a dive stops 8 m below the model');
  assert.equal(hold(['KeyW'], 600, 1 / 60, 'walk', { ...down, floor: -11.5 }).walkPosition[1], -11.5, 'the floor follows the scene');
  assert.equal(hold(['KeyW'], 3000, 1 / 60, 'walk', up).walkPosition[1], api.WALK.maxHeight);
  assert.ok(api.WALK.maxHeight > fixture.roofs[0].ridgeElevationMm / 1000, 'you can fly over the roof');
  assert.equal(hold(['KeyQ'], 600, 1 / 60).walkPosition[1], -api.WALK.below);
  assert.equal(hold(['KeyE'], 3000, 1 / 60).walkPosition[1], api.WALK.maxHeight);
  close(hold(['KeyE'], 60, 1 / 60).walkPosition, [0, 1.7 + api.WALK.climb, 0], 'rise');
  close(hold(['KeyE', 'Shift'], 60, 1 / 60).walkPosition, [0, 1.7 + api.WALK.climbRun, 0], 'Shift rises faster');
  close(hold(['KeyQ', 'Shift'], 30, 1 / 60, 'walk', { ...start, walkPosition: [0, 5, 0] }).walkPosition, [0, 5 - api.WALK.climbRun / 2, 0], 'Shift sinks faster');
  assert.ok(Math.abs(api.WALK.climbRun / api.WALK.climb - api.WALK.run / api.WALK.speed) < 1e-9, 'Shift boosts climbing as much as flying');

  // A stalled frame (a background tab) moves at most one short step instead of jumping.
  close(hold(['KeyW'], 1, 5).walkPosition, [0, 1.7, -api.WALK.speed * api.WALK.maxStep], 'stall');
  assert.ok(Math.abs(hold(['ArrowRight'], 60, 1 / 60).yaw - api.WALK.turn) < 1e-9);
  assert.equal(hold(['ArrowUp'], 600, 1 / 60).pitch, 1.2, 'looking up stops at the limit');

  // Orbit turns the other way and never moves the flying position.
  const orbit = hold(['ArrowRight', 'KeyW'], 60, 1 / 60, 'orbit');
  assert.ok(Math.abs(orbit.yaw + api.WALK.turn) < 1e-9);
  close(orbit.walkPosition, start.walkPosition, 'orbit');

  // Reset view's defaults are fresh each time, so flying away never changes where it returns to.
  const home = api.defaultCamera(fixture);
  const moved = hold(['KeyW', 'ArrowRight'], 60, 1 / 60, 'walk', { ...home.walk, walkPosition: home.walkPosition });
  moved.walkPosition[0] += 100;
  assert.equal(JSON.stringify(api.defaultCamera(fixture)), JSON.stringify(home));
  assert.notEqual(api.defaultCamera(fixture).walkPosition, api.defaultCamera(fixture).walkPosition);
});

test('Fly starts outside the south face, level and centred, with the building in view', () => {
  const { api } = loadStudio();
  for (const name of ['lakeside-barn-residence', 'compact-metric-studio', 'hillside-garden-house']) {
    const model = readFixture(name), home = api.defaultCamera(model);
    const xs = model.walls.flatMap(wall => [wall.start.x, wall.end.x]), ys = model.walls.flatMap(wall => [wall.start.y, wall.end.y]);
    const [x, y, z] = home.walkPosition;
    assert.equal(JSON.stringify(home.walk), JSON.stringify({ yaw: 0, pitch: 0 }), `${name}: level, facing north toward the south face`);
    assert.ok(Math.abs(x - (Math.min(...xs) + Math.max(...xs)) / 2000) < 1, `${name}: centred on the face`);
    const back = z - (-Math.min(...ys) / 1000);
    assert.ok(back > 0, `${name}: outside the building, not inside it`);
    // Every wall corner and the ridge sit inside a 60-degree view from there.
    const ridge = Math.max(...(model.roofs ?? []).map(roof => roof.ridgeElevationMm), ...model.walls.map(wall => wall.heightMm)) / 1000;
    for (const px of xs) assert.ok(Math.atan2(Math.abs(px / 1000 - x), back) < Math.PI / 6, `${name}: ${px} fits across`);
    assert.ok(Math.atan2(Math.abs(ridge - y), back) < Math.PI / 6 && Math.atan2(y, back) < Math.PI / 6, `${name}: the full height fits`);
  }
  // Each mode keeps its own heading: switching never hands Fly the orbit's downward aim, and back again.
  const gls = {};
  api.state.cameraMode = 'orbit';
  api.resetCamera(gls, 'orbit', fixture);
  assert.equal(gls.pitch, api.defaultCamera(fixture).orbit.pitch);
  gls.yaw = 2;
  api.switchCameraMode(gls, 'orbit', 'walk');
  assert.deepEqual([gls.yaw, gls.pitch], [0, 0]);
  gls.pitch = -0.4;
  api.switchCameraMode(gls, 'walk', 'orbit');
  assert.equal(gls.yaw, 2, 'orbit comes back where it was left');
  api.switchCameraMode(gls, 'orbit', 'walk');
  assert.equal(gls.pitch, -0.4, 'fly too');
  api.resetCamera(gls, 'walk', fixture);
  assert.deepEqual([gls.yaw, gls.pitch], [0, 0], 'Reset view restores the current mode');
  assert.equal(JSON.stringify(gls.headings.orbit), JSON.stringify(api.defaultCamera(fixture).orbit), 'and the other mode');
});

test('the 3D scene carries face normals for lighting and a pattern for each material', () => {
  const { api } = loadStudio();
  const scene = model => { api.state.model = model; api.state.systems = new Set(['electrical']); const gls = { triangles: [], lines: [] }; api.buildScene(gls); return { gls, data: api.sceneVertexData(gls) }; };
  const { gls, data } = scene(cloneFixture());
  const stride = 10, count = gls.triangles.length / 6;
  assert.equal(data.triangles.length, count * stride);
  assert.equal(data.lines.length, gls.lines.length / 6 * stride);
  for (let v = 0; v < count; v += 1) {
    const at = v * stride, normal = [data.triangles[at + 6], data.triangles[at + 7], data.triangles[at + 8]];
    assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-4, `vertex ${v} has a unit face normal`);
    for (let i = 0; i < 6; i += 1) assert.ok(Math.abs(data.triangles[at + i] - gls.triangles[v * 6 + i]) < 1e-4);
  }
  // A prism's top faces up, so it takes the most sky and sun.
  const prism = { triangles: [], lines: [] };
  api.pushPrism(prism.triangles, 0, 0, 0, 2, 2, 2, 0, [1, 1, 1]);
  const box = api.sceneVertexData(prism).triangles, normals = new Set();
  for (let v = 0; v < box.length / stride; v += 1) normals.add([6, 7, 8].map(i => Math.round(box[v * stride + i])).join(','));
  assert.deepEqual([...normals].sort(), ['-1,0,0', '0,-1,0', '0,0,-1', '0,0,1', '0,1,0', '1,0,0'], 'six outward faces');
  for (let v = 0; v < data.lines.length / stride; v += 1) assert.deepEqual([6, 7, 8, 9].map(i => data.lines[v * stride + i]), [0, 0, 0, 0], 'lines stay unlit and plain');

  const patterns = values => new Set(Array.from({ length: values.length / stride }, (_, v) => values[v * stride + 9]));
  const barn = patterns(data.triangles);
  for (const category of ['concrete', 'wood-framing', 'decking', 'gypsum']) assert.ok(barn.has(api.SCENE_PATTERNS[category]), `the barn shows ${category}`);
  assert.ok(barn.has(0), 'unspecified envelopes and fixtures stay plain');
  const workshop = patterns(scene(readFixture('mixed-material-workshop')).data.triangles);
  for (const category of ['brick', 'concrete']) assert.ok(workshop.has(api.SCENE_PATTERNS[category]), `the workshop shows ${category}`);
  const hillside = patterns(scene(readFixture('hillside-garden-house')).data.triangles);
  assert.ok(hillside.has(api.SCENE_PATTERNS.lawn), 'grass terrain reads as lawn');
  // Every pattern id has a branch in the shader.
  for (const id of new Set(Object.values(api.SCENE_PATTERNS))) assert.match(api.SCENE_FRAGMENT_SHADER, new RegExp(`id == ${id}\\)`), `pattern ${id}`);
  assert.doesNotMatch(api.SCENE_FRAGMENT_SHADER.replace(/\/\/.*$/gm, ''), /\bhalf\b/, 'GLSL ES reserves "half"');
});

test('3D walls meet at closed corners, like the plan, not notched boxes', () => {
  const { api } = loadStudio();
  const model = cloneFixture();
  api.state.model = model; api.state.systems = new Set();
  const gls = { triangles: [], lines: [] };
  api.buildScene(gls);
  const vertices = new Set();
  for (let i = 0; i < gls.triangles.length; i += 6) vertices.add(gls.triangles.slice(i, i + 3).map(value => Math.round(value * 1000)).join(','));
  // The barn's exterior walls run on a rectangle of centrelines, 300 mm thick: the outside corners sit
  // 150 mm beyond it both ways, at every level's wall top. A square-ended box would leave them empty.
  for (const level of model.levels) {
    const walls = model.walls.filter(wall => wall.levelId === level.id && wall.kind === 'exterior');
    const xs = walls.flatMap(wall => [wall.start.x, wall.end.x]), ys = walls.flatMap(wall => [wall.start.y, wall.end.y]);
    const half = walls[0].thicknessMm / 2, top = level.elevationMm + walls[0].heightMm;
    for (const x of [Math.min(...xs) - half, Math.max(...xs) + half]) for (const y of [Math.min(...ys) - half, Math.max(...ys) + half]) {
      assert.ok(vertices.has([x, top, -y].join(',')), `${level.id}: outside corner ${x}, ${y} is closed`);
    }
  }
  // Nor do two walls fill the inside corner twice: the barn's south and west walls share only their miter.
  const south = model.walls.find(wall => wall.id === 'wall-g-south'), west = model.walls.find(wall => wall.id === 'wall-g-west');
  const inner = [Math.min(south.start.x, south.end.x) + south.thicknessMm / 2, 0, -(Math.min(west.start.y, west.end.y) + west.thicknessMm / 2)];
  assert.ok(vertices.has(inner.join(',')), 'the inside corner is a shared miter vertex');
});

test('3D walls show the layer each face exposes', () => {
  const { api } = loadStudio();
  const hex = (r, g, b) => `#${[r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
  // Colours of the wall faces at plan offset `y` (mm) facing `+1` (north, model +y) or `-1`, on one level's height.
  const faceColours = (model, levelId, y, facing) => {
    api.state.model = model; api.state.systems = new Set();
    const gls = { triangles: [], lines: [] };
    api.buildScene(gls);
    const data = api.sceneVertexData(gls), level = model.levels.find(item => item.id === levelId), colours = new Set();
    for (let tri = 0; tri < data.triangles.length / 30; tri += 1) {
      const at = tri * 30, corner = k => [0, 1, 2].map(i => data.triangles[at + k * 10 + i]);
      const centre = [0, 1, 2].map(i => (corner(0)[i] + corner(1)[i] + corner(2)[i]) / 3);
      if (Math.abs(-centre[2] * 1000 - y) > 1 || Math.abs(data.triangles[at + 8] + facing) > 1e-3) continue;
      if (centre[1] * 1000 <= level.elevationMm || centre[1] * 1000 >= level.elevationMm + 2600 || centre[0] < 1 || centre[0] > 8) continue;
      colours.add(hex(data.triangles[at + 3], data.triangles[at + 4], data.triangles[at + 5]));
    }
    return [...colours];
  };
  const colour = category => api.MATERIAL_CATEGORIES[category].color;
  // The barn's south wall: siding (not specified) outside, gypsum inside.
  const barn = cloneFixture(), half = barn.walls.find(wall => wall.id === 'wall-u-south').thicknessMm / 2;
  assert.deepEqual(faceColours(barn, 'level-upper', -half, -1), [colour('generic')], 'siding faces out');
  assert.deepEqual(faceColours(barn, 'level-upper', half, 1), [colour('gypsum')], 'gypsum faces the living room');
  // A stud partition shows gypsum on both faces, not its studs.
  const living = barn.walls.find(wall => wall.id === 'wall-u-living'), p = living.thicknessMm / 2, y = living.start.y;
  assert.deepEqual(faceColours(barn, 'level-upper', y - p, -1), [colour('gypsum')]);
  assert.deepEqual(faceColours(barn, 'level-upper', y + p, 1), [colour('gypsum')]);
  // The workshop: brick veneer and block show outside, gypsum inside.
  const workshop = readFixture('mixed-material-workshop');
  const upper = workshop.walls.find(wall => wall.id === 'wall-u-south').thicknessMm / 2, ground = workshop.walls.find(wall => wall.id === 'wall-g-south').thicknessMm / 2;
  assert.deepEqual(faceColours(workshop, 'level-upper', -upper, -1), [colour('brick')]);
  assert.deepEqual(faceColours(workshop, 'level-upper', upper, 1), [colour('gypsum')]);
  assert.deepEqual(faceColours(workshop, 'level-ground', -ground, -1), [colour('concrete-masonry')]);
});

test('the 3D scene is uploaded once per build and drawing re-sends nothing', () => {
  const { api } = loadStudio();
  const calls = { createBuffer: 0, bufferData: 0, drawArrays: [] };
  const gl = {
    ARRAY_BUFFER: 1, STATIC_DRAW: 2, FLOAT: 3, TRIANGLES: 4, LINES: 5,
    createBuffer: () => ({ id: ++calls.createBuffer }), bindBuffer() {}, bufferData: (_target, data) => { calls.bufferData += 1; assert.equal(Object.prototype.toString.call(data), '[object Float32Array]'); },
    enableVertexAttribArray() {}, vertexAttribPointer() {}, drawArrays: (mode, first, count) => calls.drawArrays.push([mode, count])
  };
  api.state.model = cloneFixture();
  api.state.systems = new Set(['plumbing', 'electrical', 'mechanical']);
  const gls = { gl, triangles: [], lines: [], buffers: {}, position: 0, color: 1 };
  api.buildScene(gls);
  api.uploadScene(gls);
  assert.equal(calls.createBuffer, 2);
  assert.equal(calls.bufferData, 2);
  for (let frame = 0; frame < 120; frame += 1) {
    api.drawBuffer(gls, gls.buffers.triangles, gl.TRIANGLES);
    api.drawBuffer(gls, gls.buffers.lines, gl.LINES);
  }
  assert.equal(calls.bufferData, 2, 'two seconds of frames upload nothing');
  assert.deepEqual(calls.drawArrays[0], [gl.TRIANGLES, gls.triangles.length / 6]);
  assert.deepEqual(calls.drawArrays[1], [gl.LINES, gls.lines.length / 6]);
  assert.ok(gls.center.every(Number.isFinite));
  let lowest = Infinity;
  for (let i = 1; i < gls.triangles.length; i += 6) lowest = Math.min(lowest, gls.triangles[i]);
  assert.ok(lowest < 0, 'the barn slab sits below grade');
  assert.ok(Math.abs(gls.floor - (lowest - api.WALK.below)) < 1e-9, 'flying stops 8 m below the lowest point of the model');

  api.state.systems = new Set();
  api.buildScene(gls);
  api.uploadScene(gls);
  assert.equal(calls.createBuffer, 2, 'a rebuild reuses the same buffers');
  assert.equal(calls.bufferData, 4);
});

test('plans render authored stairs and dimensions', () => {
  const { api } = loadStudio();
  api.state.model = cloneFixture();
  api.state.levelId = 'level-ground';
  const plan = api.planSvg(false);
  assert.match(plan, /data-entity="stair-main"/);
  assert.match(plan, /data-entity="dimension-width"/);
  assert.match(plan, /data-entity="dimension-depth"/);
});

test('code view renders a valid staged report and distinguishes invalid reports', () => {
  const { api, elements } = loadStudio();
  api.state.model = cloneFixture();
  api.state.codeReport = {
    status: 'loaded',
    data: {
      findings: [{
        topic: 'egress',
        status: 'needs-review',
        summary: 'Verify the bedroom opening.',
        authority: 'Example Township',
        sourceTitle: 'Adopted code notice',
        sourceRef: 'https://example.invalid/code',
        accessedDate: '2026-09-12',
        affectedEntityIds: ['opening-bedroom-window']
      }],
      coverage: { checked: [], potentialConflicts: [], unresolved: ['Bedroom egress'], outOfScope: [] }
    }
  };
  api.renderDocument('code');
  assert.match(elements.get('#content').innerHTML, /Verify the bedroom opening/);
  assert.match(elements.get('#content').innerHTML, /Adopted code notice/);

  api.state.codeReport = { status: 'invalid', message: 'The report belongs to another project.' };
  api.renderDocument('code');
  assert.match(elements.get('#content').innerHTML, /belongs to another project/);
});

const svgAttr = (svg, name) => svg.match(new RegExp(`<svg[^>]*\\s${name}="([^"]*)"`))?.[1];
const entityGroup = (svg, id) => svg.match(new RegExp(`<g data-entity="${id}">([\\s\\S]*?)</g>`))?.[1] ?? '';
const numbersIn = (markup, attr) => [...markup.matchAll(new RegExp(`\\s${attr}="(-?[\\d.]+)"`, 'g'))].map(match => Number(match[1]));
const pointXs = markup => [...markup.matchAll(/points="([^"]+)"/g)].flatMap(match => match[1].split(' ').map(pair => Number(pair.split(',')[0])));
// Open <g> groups left at the end of a markup slice.
const groupDepth = markup => (markup.match(/<g[\s>]/g) ?? []).length - (markup.match(/<\/g>/g) ?? []).length;

test('sheets follow the drafting profile selected by display units', () => {
  const { api } = loadStudio();
  const imperial = api.renderPlanSheet(cloneFixture(), 'level-ground');
  assert.equal(svgAttr(imperial.svg, 'width'), '431.8mm');
  assert.equal(svgAttr(imperial.svg, 'viewBox'), '0 0 431.8 279.4');
  assert.match(imperial.svg, /NCS-INFORMED IMPERIAL/);
  assert.match(imperial.scaleLabel, /" = 1'-0"$/);
  assert.equal(imperial.sheetId, 'A-101');

  const metric = api.renderPlanSheet(structuredClone(metricFixture), 'level-ground');
  assert.equal(svgAttr(metric.svg, 'viewBox'), '0 0 420 297');
  assert.match(metric.svg, /ISO-INFORMED METRIC/);
  assert.match(metric.scaleLabel, /^1:\d+$/);
  // Metric dimensions are bare millimetres with arrow terminators (filled polygons).
  const living = entityGroup(metric.svg, 'dimension-living-width');
  assert.match(living, />5200</);
  assert.match(living, /<polygon[^>]*fill="#1b1b1b"/);
});

test('scale selection picks the largest standard scale that fits', () => {
  const { api } = loadStudio();
  const profile = api.PROFILES.imperial, area = api.drawingArea(profile);
  assert.equal(api.selectScale(profile, 2000, 2000, area).ratio, 12);
  assert.equal(api.selectScale(profile, 3000, 3000, area).ratio, 24);
  assert.equal(api.selectScale(profile, 12000, 14000, area).ratio, 96);
  const huge = api.selectScale(profile, 900000, 900000, area);
  assert.equal(huge.ratio, profile.scales.at(-1)[0]);
});

test('sheets are deterministic and carry no invented document-control data', () => {
  const { api } = loadStudio();
  const first = api.renderDrawingSet(cloneFixture()).map(sheet => sheet.svg).join('\n');
  const second = api.renderDrawingSet(cloneFixture()).map(sheet => sheet.svg).join('\n');
  assert.equal(first, second);
  assert.match(first, /UNDATED CONCEPT/);
  assert.match(first, /CONCEPT - NOT FOR CONSTRUCTION/);
  assert.doesNotMatch(first, /\b20\d\d-\d\d-\d\d\b/);
  assert.doesNotMatch(first, /var\(|<script|class="/);
  assert.doesNotMatch(first, /\u2014/);
});

test('plan dimensions sit outside the building footprint', () => {
  const { api } = loadStudio();
  const plan = api.renderPlanSheet(cloneFixture(), 'level-ground').svg;
  const westWall = Math.min(...pointXs(entityGroup(plan, 'wall-g-west')));
  const depth = entityGroup(plan, 'dimension-depth');
  assert.ok(depth, 'depth dimension is drawn');
  assert.ok(Math.max(...numbersIn(depth, 'x1'), ...numbersIn(depth, 'x2')) < westWall, 'depth dimension clears the west wall');
});

test('room tags find clear positions on crowded metric plans', () => {
  const { api } = loadStudio();
  for (const levelId of ['level-ground', 'level-upper']) {
    const result = api.renderPlanSheet(structuredClone(metricFixture), levelId);
    assert.equal(result.warnings.length, 0, JSON.stringify(result.warnings));
  }
  const placer = api.createPlacer({ x0: 0, y0: 0, x1: 100, y1: 100 });
  placer.reserve({ x0: 10, y0: 10, x1: 20, y1: 20 });
  assert.equal(placer.fits({ x0: 15, y0: 15, x1: 25, y1: 25 }), false);
  assert.equal(placer.fits({ x0: 30, y0: 30, x1: 40, y1: 40 }), true);
  assert.equal(placer.fits({ x0: 95, y0: 95, x1: 105, y1: 105 }), false);
});

test('sections cut walls, slabs, stairs, and roofs from the canonical model', () => {
  const { api } = loadStudio();
  const barn = api.sectionGeometry(cloneFixture(), fixture.sections[0]);
  const cutIds = new Set(barn.cut.map(item => item.id));
  for (const id of ['wall-g-west', 'wall-g-east', 'wall-u-west', 'wall-u-east', 'slab-ground', 'slab-upper', 'stair-main']) assert.ok(cutIds.has(id), `${id} is cut`);
  const slab = barn.cut.find(item => item.id === 'slab-upper');
  assert.equal(slab.z1 - slab.z0, fixture.slabs.find(item => item.id === 'slab-upper').thicknessMm);
  assert.equal(barn.roofCut.length, 1);
  assert.equal(Math.max(...barn.roofCut[0].points.map(point => point.z)), fixture.roofs[0].ridgeElevationMm);

  const metric = api.sectionGeometry(structuredClone(metricFixture), metricFixture.sections[0]);
  const stair = metric.cut.find(item => item.id === 'stair-main');
  assert.ok(stair.profile.length > 2 * 17, 'stair cut along its run shows every riser');
  const partition = metric.cut.filter(item => item.id === 'wall-u-partition');
  assert.equal(partition.length, 1, 'the sliding door leaves only the wall above its head');
  assert.equal(partition[0].z0, 3000 + 2100);
  const windowCut = { ...metricFixture.sections[0], start: { ...metricFixture.sections[0].start, y: 3000 }, end: { ...metricFixture.sections[0].end, y: 3000 } };
  const window = api.sectionGeometry(structuredClone(metricFixture), windowCut).cut.filter(item => item.id === 'wall-u-west');
  assert.equal(window.length, 2, 'the west window splits the cut wall');

  const reversed = structuredClone(metricFixture.sections[0]);
  reversed.lookDirection = 'right';
  const mirrored = api.sectionGeometry(structuredClone(metricFixture), reversed);
  const span = geometry => geometry.cut.filter(item => item.id === 'slab-upper').map(item => [item.h0, item.h1].sort((a, b) => a - b));
  assert.deepEqual(span(mirrored)[0].map(value => -value).sort((a, b) => a - b), span(metric)[0]);
});

test('section sheets render with marks on every plan and no unsupported warning', () => {
  const { api } = loadStudio();
  const model = cloneFixture();
  assert.ok(!api.validateModel(model).some(finding => finding.code === 'renderer.unsupported-sections'));
  const section = api.renderSectionSheet(model, 'section-aa');
  assert.equal(section.sheetId, 'A-301');
  assert.equal(section.warnings.length, 0);
  assert.match(section.svg, /TRANSVERSE SECTION A-A/);
  for (const levelId of ['level-ground', 'level-upper']) assert.match(api.renderPlanSheet(model, levelId).svg, /data-entity="section-aa"/);
});

test('the export script writes a complete, standalone, deterministic drawing set', () => {
  const first = buildDrawingSet(html, cloneFixture());
  const second = buildDrawingSet(html, cloneFixture());
  assert.equal(first.errors.length, 0);
  assert.equal(JSON.stringify(first.manifest), JSON.stringify(second.manifest));
  assert.equal(first.sheets.map(sheet => sheet.svg).join(''), second.sheets.map(sheet => sheet.svg).join(''));
  assert.deepEqual([...first.manifest.files.map(file => file.sheet)], ['A-101', 'A-102', 'A-201', 'A-202', 'A-203', 'A-204', 'A-301', 'A-302', 'M-101', 'M-102']);
  assert.ok(first.manifest.files.every(file => /^exports\/(plans|elevations|sections|systems)\/[a-z0-9-]+\.svg$/.test(file.path)));
  for (const sheet of first.sheets) {
    assert.match(sheet.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="[\d.]+mm" height="[\d.]+mm"/);
    assert.equal((sheet.svg.match(/<svg/g) ?? []).length, 1);
  }

  const edited = cloneFixture();
  edited.openings[0].offsetMm += 100;
  assert.notEqual(buildDrawingSet(html, edited).manifest.modelFingerprint, first.manifest.modelFingerprint);

  const broken = cloneFixture();
  broken.openings[0].widthMm = -1;
  const refused = buildDrawingSet(html, broken);
  assert.ok(refused.errors.length > 0);
  assert.equal(refused.sheets.length, 0);
});

test('the drawing-set ZIP is a valid store-only archive', () => {
  const { api } = loadStudio();
  const encoder = new TextEncoder();
  const zip = api.zipFiles([{ name: 'exports/a.svg', bytes: encoder.encode('<svg/>') }, { name: 'exports/manifest.json', bytes: encoder.encode('{}') }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const end = zip.byteLength - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  assert.equal(api.crc32(encoder.encode('123456789')), 0xcbf43926);
});

test('the demo preview is generated from the current template', () => {
  const current = fs.readFileSync(path.join(skillRoot, 'preview', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(current, expectedPreview().replace(/\r\n/g, '\n'));
});

test('skill copy contains no em dashes', () => {
  const files = ['SKILL.md', 'README.md', 'assets/studio-template.html', ...fs.readdirSync(path.join(skillRoot, 'scripts')).map(file => `scripts/${file}`), ...fs.readdirSync(path.join(skillRoot, 'references')).map(file => `references/${file}`)];
  for (const file of files) assert.doesNotMatch(fs.readFileSync(path.join(skillRoot, file), 'utf8'), /\u2014/, file);
});
test('selected elements expose review details without inventing undefined values', () => {
  const { api } = loadStudio();
  const model = cloneFixture();
  const stair = api.entityDetails(model, 'stair-main');
  assert.equal(stair.type, 'Stair');
  assert.equal(stair.title, 'Main stair');
  const stairDims = Object.fromEntries(stair.dims);
  assert.equal(stairDims.Riser, '7 1/8"');
  assert.equal(stairDims['Total rise'], `11'-9 3/4"`);
  assert.match(stair.diagram, /^<svg[^>]*role="img"/);
  assert.ok(stair.openItems.includes('Guards and handrails'));

  const opening = Object.fromEntries(api.entityDetails(model, 'opening-bedroom-window').dims);
  assert.equal(opening['Head height'], `7'-6 1/2"`);
  assert.ok(!('Header' in opening), 'header size is an open item, not a value');
  assert.ok(api.entityDetails(model, 'opening-bedroom-window').openItems.includes('Header size and framing'));

  const room = Object.fromEntries(api.entityDetails(model, 'space-workshop').dims);
  assert.equal(room.Area, api.profileFor(model).area(api.polygonArea(model.spaces.find(item => item.id === 'space-workshop').boundary)));
  const metricRoom = Object.fromEntries(api.entityDetails(structuredClone(metricFixture), 'space-bath-ground').dims);
  assert.equal(metricRoom.Area, '11.5 m²');
  assert.equal(api.entityDetails(model, 'not-an-entity'), null);
});

test('approvals export references only real entities and the model fingerprint', () => {
  const { api } = loadStudio();
  const model = cloneFixture();
  const exported = api.approvalsExport(model, { 'stair-main': { approvedAt: '2026-10-19' }, 'deleted-thing': { approvedAt: '2026-10-19' } });
  assert.equal(exported.projectId, model.project.id);
  assert.equal(exported.modelFingerprint, api.modelFingerprint(model));
  assert.equal(exported.approvals.length, 1);
  assert.equal(exported.approvals[0].entityId, 'stair-main');
  assert.equal(exported.approvals[0].type, 'Stair');
});
test('material examples validate and draw every sheet without warnings', () => {
  for (const model of [materialFixture, metricMaterialFixture]) {
    const set = buildDrawingSet(html, structuredClone(model));
    assert.equal(set.errors.length, 0, JSON.stringify(set.errors));
    assert.deepEqual([...set.manifest.files.map(file => file.sheet)], ['A-101', 'A-102', 'A-201', 'A-202', 'A-203', 'A-204', 'A-301', 'A-302', 'M-101', 'M-102']);
    for (const sheet of set.sheets) {
      assert.equal(sheet.warnings.length, 0, `${sheet.sheetId}: ${JSON.stringify(sheet.warnings)}`);
      const hatched = sheet.view === 'plan' || sheet.view === 'section';
      assert.equal(/url\(#hatch-/.test(sheet.svg), hatched, `${sheet.sheetId} hatching`);
      assert.equal(/>MATERIALS</.test(sheet.svg), hatched, `${sheet.sheetId} material key`);
      // Every pattern a sheet uses is defined on that sheet.
      for (const [, id] of sheet.svg.matchAll(/url\(#(hatch-[a-z-]+)\)/g)) assert.match(sheet.svg, new RegExp(`<pattern id="${id}"`), `${sheet.sheetId} defines ${id}`);
    }
  }
});

test('material hatching follows the drafting profile', () => {
  const { api } = loadStudio();
  const slabMaterial = units => {
    const model = structuredClone(metricFixture);
    model.project.coordinates.displayUnits = units;
    model.materials = [{ id: 'mat-rc', name: 'Reinforced concrete', category: 'reinforced-concrete' }];
    for (const slab of model.slabs) { delete slab.layers; slab.materialId = 'mat-rc'; }
    return api.renderSectionSheet(model, 'section-a').svg;
  };
  const imperial = slabMaterial('feet-inches'), metric = slabMaterial('metric');
  assert.match(imperial, /url\(#hatch-concrete\)/);
  assert.doesNotMatch(imperial, /url\(#hatch-diagonal-wide\)/, 'imperial profile convention: reinforced concrete hatches as plain concrete');
  assert.match(metric, /url\(#hatch-diagonal-wide\)/, 'metric profile convention: reinforced concrete adds 45-degree lines');

  // Profile conventions (drafting-standard.md): rigid insulation zig-zag against crosshatch; sawn end grain X against rings.
  const imperialSection = api.renderSectionSheet(structuredClone(materialFixture), 'section-aa').svg;
  const metricSection = api.renderSectionSheet(structuredClone(metricMaterialFixture), 'section-aa').svg;
  assert.doesNotMatch(imperialSection, /hatch-crosshatch/);
  assert.match(metricSection, /url\(#hatch-crosshatch\)/);
  const imperialPost = entityGroup(api.renderPlanSheet(structuredClone(materialFixture), 'level-upper').svg, 'column-ridge-post');
  const metricPost = entityGroup(api.renderPlanSheet(structuredClone(metricMaterialFixture), 'level-upper').svg, 'column-ridge-post');
  assert.equal((imperialPost.match(/<line/g) ?? []).length, 2, 'imperial end grain is an X');
  assert.equal((metricPost.match(/<line/g) ?? []).length, 0);
  assert.equal((metricPost.match(/<polygon points="(?:[^ "]+ ){23}[^ "]+"/g) ?? []).length, 2, 'metric end grain is two growth rings');
});

test('layered wall corners join square, layer by layer, with no diagonal seams', () => {
  const { api } = loadStudio();
  const svg = api.renderPlanSheet(structuredClone(metricFixture), 'level-ground').svg;
  const layers = [...svg.matchAll(/<polygon points="([^"]+)" fill="none" stroke="[^"]+" stroke-width="[^"]+" stroke-linejoin="miter"\/>/g)].map(match => match[1].split(' ').map(pair => pair.split(',').map(Number)));
  assert.ok(layers.length >= 40, `expected outlined layer regions, got ${layers.length}`);
  for (const ring of layers) ring.forEach(([x, y], i) => {
    const [nx, ny] = ring[(i + 1) % ring.length];
    assert.ok(Math.abs(nx - x) < 0.05 || Math.abs(ny - y) < 0.05, `diagonal layer edge ${x},${y} to ${nx},${ny}`);
  });
});

test('material detail falls back to poche without a catalog or at small scales', () => {
  const { api } = loadStudio();
  const legacy = api.renderPlanSheet(withoutCatalog(metricFixture), 'level-ground').svg;
  assert.doesNotMatch(legacy, /hatch-|MATERIALS/);

  const distant = structuredClone(materialFixture);
  distant.sections[1].start.x = -60000;
  const small = api.renderPlanSheet(distant, 'level-ground');
  assert.ok(small.ratio > 100, `expected a small scale, got 1:${small.ratio}`);
  assert.doesNotMatch(small.svg, /hatch-|MATERIALS/);
  assert.match(entityGroup(small.svg, 'wall-g-south'), /fill="#4d4d4d"/);

  // Unassigned elements read as "not specified" once a sheet carries material detail.
  const partial = structuredClone(materialFixture);
  delete partial.walls.find(wall => wall.id === 'wall-g-office').layers;
  assert.match(api.renderPlanSheet(partial, 'level-ground').svg, />MATERIAL NOT SPECIFIED</);
});

test('validation catches material, assembly, header, and member errors', () => {
  const { api } = loadStudio();
  const expectError = (code, mutate) => {
    const model = structuredClone(materialFixture);
    mutate(model);
    assert.ok(errorCodes(api, model).includes(code), `${code} expected, got ${errorCodes(api, model).join(', ')}`);
  };
  assert.equal(errorCodes(api, structuredClone(materialFixture)).length, 0);
  expectError('material.layers', model => { model.walls[0].layers[0].thicknessMm += 10; });
  expectError('material.conflict', model => { model.walls[0].materialId = 'mat-cmu'; });
  expectError('reference.material', model => { model.slabs[0].layers[2].materialId = 'mat-missing'; });
  expectError('reference.material', model => { model.beams[0].materialId = 'mat-missing'; });
  expectError('material.category', model => { model.materials[0].category = 'adobe'; });
  expectError('opening.header', model => { model.openings.find(item => item.id === 'opening-studio-window').headers[0].layerId = 'missing-layer'; });
  expectError('opening.header', model => { delete model.openings.find(item => item.id === 'opening-studio-window').headers[0].layerId; });
  expectError('opening.header', model => { delete model.openings.find(item => item.id === 'opening-studio-window').headers[0].plies; });
  expectError('opening.header', model => { model.openings.find(item => item.id === 'opening-studio-window').headers[1].layerId = 'studs'; });
  expectError('opening.header', model => { model.openings.find(item => item.id === 'opening-office-window').headers[1].face = 'inner'; });
  expectError('opening.header', model => { model.openings.find(item => item.id === 'opening-studio-window').headers[0].face = 'outer'; });
  expectError('material.layers', model => { model.walls[0].layers[1].id = model.walls[0].layers[0].id; });
  expectError('material.layers', model => { delete model.slabs[0].layers[0].id; });
  expectError('material.layers', model => { model.walls[0].layerOrder = 'outside-in'; });
  expectError('opening.header-fit', model => { model.openings.find(item => item.id === 'opening-studio-window').headers[0].depthMm = 900; });
  expectError('opening.header-fit', model => { model.openings.find(item => item.id === 'opening-overhead-door').headers[0].bearingMm = 5000; });
  expectError('member.profile', model => { delete model.beams[0].shape.flangeThicknessMm; });
  expectError('member.profile', model => { model.columns[0].shape.wallThicknessMm = 80; });
  expectError('member.geometry', model => { model.columns[0].topElevationMm = -10; });
  expectError('polygon.geometry', model => { model.foundations[0].boundary = [{ x: 0, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }, { x: 1000, y: 0 }]; });
  expectError('polygon.geometry', model => { model.surfaces[0].boundary = [{ x: 0, y: 0 }, { x: 1000, y: 0 }]; });
  const findings = api.validateModel(structuredClone(materialFixture));
  assert.ok(findings.some(finding => finding.code === 'structure.review' && finding.severity === 'advisory'));
  assert.ok(!findings.some(finding => finding.code === 'material.evidence'), 'example materials carry evidence');
  const unsourced = structuredClone(materialFixture);
  delete unsourced.materials[0].evidence;
  assert.ok(api.validateModel(unsourced).some(finding => finding.code === 'material.evidence' && finding.severity === 'advisory'));
});

test('sections cut assemblies, headers, members, foundations, and site surfaces', () => {
  const { api } = loadStudio();
  const model = structuredClone(materialFixture);
  const aa = api.sectionGeometry(model, model.sections[0]);
  const headerKinds = new Map(aa.regions.filter(region => region.role === 'header').map(region => [`${region.openingId}:${region.header.kind}`, region]));
  for (const key of ['opening-overhead-door:steel-beam', 'opening-shop-window:masonry-bond-beam', 'opening-studio-window:built-up-lumber', 'opening-studio-window:steel-angle', 'opening-studio-north-window:engineered-lumber']) assert.ok(headerKinds.has(key), `${key} is cut`);
  const builtUp = headerKinds.get('opening-studio-window:built-up-lumber'), window = model.openings.find(item => item.id === 'opening-studio-window');
  assert.equal(builtUp.z0, model.levels[1].elevationMm + window.sillMm + window.heightMm);
  assert.equal(builtUp.z1 - builtUp.z0, 235);
  // The stud layer resumes above the header; the angle lintel leaves the brick it carries in place.
  const studAbove = aa.regions.filter(region => region.id === 'wall-u-south' && region.role === 'layer' && region.materialId === 'mat-batt').map(region => region.z0);
  assert.ok(studAbove.includes(builtUp.z1));
  assert.ok(aa.regions.some(region => region.id === 'wall-u-south' && region.materialId === 'mat-brick' && region.z0 === builtUp.z0));

  const slab = aa.regions.filter(region => region.id === 'slab-ground');
  assert.deepEqual([...slab.map(region => region.materialId)], ['mat-concrete', 'mat-rigid', 'mat-gravel']);
  assert.deepEqual([...slab.map(region => region.z1 - region.z0)], [102, 51, 152]);
  const cutIds = new Set(aa.cut.map(item => item.id));
  for (const id of ['foundation-stem-south', 'foundation-footing-north', 'foundation-pad-2', 'surface-apron', 'surface-apron-base']) assert.ok(cutIds.has(id), `${id} is cut`);
  assert.deepEqual([...aa.members.map(member => member.id)].sort(), ['beam-floor', 'beam-ridge']);

  const bb = api.sectionGeometry(model, model.sections[1]);
  const floorBeam = bb.beyond.find(item => item.id === 'beam-floor');
  assert.equal(floorBeam.kind, 'member', 'a beam seen along its length draws in outline');
  assert.equal(floorBeam.flange, 8);
  assert.ok(bb.beyond.some(item => item.id === 'column-shop-1'));

  const sheet = api.renderSectionSheet(model, 'section-aa').svg;
  assert.match(sheet, /data-role="earth"/);
  assert.match(sheet, />UNDISTURBED EARTH</);
  assert.match(entityGroup(sheet, 'beam-floor'), /<path d="M[^"]+" fill="#1b1b1b"/, 'steel cut solid');
});

test('material plans miter wall corners and stop partitions at the faces they meet', () => {
  const { api } = loadStudio();
  const plan = api.renderPlanSheet(structuredClone(materialFixture), 'level-ground').svg;
  const polygons = id => [...entityGroup(plan, id).matchAll(/points="([^"]+)"/g)].map(match => match[1].split(' ').map(pair => pair.split(',').map(Number)));
  const south = polygons('wall-g-south'), office = polygons('wall-g-office');
  const southBottom = Math.max(...south.flat().map(([, y]) => y)), officeBottom = Math.max(...office.flat().map(([, y]) => y));
  const wallPaper = 248 / 48;
  assert.ok(officeBottom <= southBottom - wallPaper + 0.05, 'the partition stops at the inner face of the south wall');
  const firstLeg = south[0], leftX = firstLeg.map(([x]) => x).sort((a, b) => a - b);
  assert.ok(leftX[1] - leftX[0] > wallPaper * 0.9, 'the south wall miters at its west corner');
});

test('review details describe assemblies, headers, and members', () => {
  const { api } = loadStudio();
  const model = structuredClone(materialFixture);
  const opening = api.entityDetails(model, 'opening-studio-window'), dims = Object.fromEntries(opening.dims);
  assert.match(dims['Header 1'], /^Built-up lumber header 3-2x10, 0?'?-?9 1\/4" deep, 3" bearing$/);
  assert.match(dims['Header 2'], /^Steel angle lintel L4x3-1\/2x5\/16/);
  assert.ok(opening.openItems.includes('Header sizing and bearing by an engineer'));
  assert.ok(!opening.openItems.includes('Header size and framing'));
  assert.match(opening.diagram, /2 headers/);
  assert.ok(!('Header' in Object.fromEntries(api.entityDetails(model, 'opening-studio-west-window').dims)));

  const wall = Object.fromEntries(api.entityDetails(model, 'wall-u-south').dims);
  assert.equal(wall['Layer 5'], 'Brick veneer, 3 5/8"');
  assert.equal(wall['Layer 1'], 'Gypsum board, 5/8"');
  const beam = Object.fromEntries(api.entityDetails(model, 'beam-floor').dims);
  assert.equal(beam.Material, 'Structural steel');
  assert.equal(beam.Designation, 'W8x18');
  const material = api.entityDetails(model, 'mat-gravel');
  assert.equal(material.type, 'Material');
  assert.equal(Object.fromEntries(material.dims)['Used by'], '3 elements');
});

test('3D scene includes members, foundations, and site surfaces', () => {
  const { api } = loadStudio();
  const scene = { triangles: [], lines: [] };
  api.state.model = structuredClone(materialFixture);
  api.buildScene(scene);
  const full = scene.triangles.length;
  for (const key of ['beams', 'columns', 'foundations', 'surfaces']) api.state.model[key] = [];
  api.buildScene(scene);
  assert.ok(full > scene.triangles.length);
});

test('review regressions: lintel draw order, near-miss corners, unequal miters, earth scale, inherited keys', () => {
  const { api } = loadStudio();
  // Steel angle lintels draw after (over) the brick layer they carry.
  const section = api.renderSectionSheet(structuredClone(materialFixture), 'section-aa').svg;
  const materials = section.match(/<g data-role="materials"[^>]*>([\s\S]*?)<\/g>/)[1];
  const lastBrick = materials.lastIndexOf('url(#hatch-diagonal)'), firstAngle = materials.search(/<polygon points="(?:[^ "]+ ){5}[^ "]+" fill="none"/);
  assert.ok(firstAngle > lastBrick, 'angle lintels follow every brick fill');

  const plan = model => api.renderPlanSheet(model, 'level-ground').svg;
  const polygons = (svg, id) => [...entityGroup(svg, id).matchAll(/points="([^"]+)"/g)].map(match => match[1].split(' ').map(pair => pair.split(',').map(Number)));
  const area = points => Math.abs(points.reduce((sum, [x, y], i) => { const [nx, ny] = points[(i + 1) % points.length]; return sum + x * ny - nx * y; }, 0) / 2);
  // A corner whose endpoints miss by 10 mm still miters instead of leaving a hole.
  const gap = structuredClone(materialFixture);
  gap.walls.find(wall => wall.id === 'wall-g-west').end = { x: 0, y: 10 };
  const west = polygons(plan(gap), 'wall-g-west'), south = polygons(plan(gap), 'wall-g-south');
  assert.ok(Math.max(...west.flat().map(([, y]) => y)) >= Math.max(...south.flat().map(([, y]) => y)) - 0.05, 'the west wall reaches the outer corner');
  // Collinear walls with a small gap keep their full width.
  const split = structuredClone(materialFixture);
  const wall = split.walls.find(item => item.id === 'wall-g-west');
  split.walls.push({ ...structuredClone(wall), id: 'wall-g-west-lower', start: { x: 0, y: 2990 }, end: { x: 0, y: 0 } });
  wall.end = { x: 0, y: 3000 };
  split.openings = split.openings.filter(item => item.wallId !== 'wall-g-west');
  for (const id of ['wall-g-west', 'wall-g-west-lower']) assert.ok(polygons(plan(split), id).every(points => area(points) > 1), `${id} keeps its width`);
  // Walls of different thickness miter through both face intersections.
  const thick = structuredClone(materialFixture);
  const thickWest = thick.walls.find(item => item.id === 'wall-g-west');
  thickWest.thicknessMm = 400; thickWest.layers[2].thicknessMm += 152;
  thick.openings = thick.openings.filter(item => item.wallId !== 'wall-g-west');
  const thickWestOutline = polygons(plan(thick), 'wall-g-west')[0], thickSouthOutline = polygons(plan(thick), 'wall-g-south')[0];
  assert.ok(Math.abs(Math.max(...thickWestOutline.map(([, y]) => y)) - Math.max(...thickSouthOutline.map(([, y]) => y))) < 0.05, 'outer faces meet at one corner');

  // Earth never pushes a section out of material detail.
  const tall = structuredClone(materialFixture);
  tall.foundations[0].depthMm = 20000;
  const tallSheet = api.renderSectionSheet(tall, 'section-aa');
  assert.ok(!/data-role="earth"/.test(tallSheet.svg) || tallSheet.ratio <= api.PROFILES.imperial.materialDetailRatio);

  const inherited = structuredClone(materialFixture);
  inherited.materials[0].category = 'toString';
  assert.ok(errorCodes(api, inherited).includes('material.category'));
  const badHeader = structuredClone(materialFixture);
  badHeader.openings[0].headers[0].kind = 'constructor';
  assert.ok(errorCodes(api, badHeader).includes('opening.header'));
});

// The hatch contract from references/drafting-standard.md, Materials. Pattern ids or the directional
// symbol each category must draw, per profile.
const HATCH_CONTRACT = {
  earth: [['earth'], ['earth']], gravel: [['gravel'], ['gravel']], sand: [['sand'], ['sand']], concrete: [['concrete'], ['concrete']],
  'reinforced-concrete': [['concrete'], ['concrete', 'diagonal-wide']], 'concrete-masonry': [['concrete-sparse', 'diagonal-wide'], ['concrete-sparse', 'diagonal-wide']],
  brick: [['diagonal'], ['diagonal']], gypsum: [['stipple'], ['stipple']], 'insulation-rigid': ['zigzag', ['crosshatch']],
  steel: ['solid', 'solid'], 'wood-framing': ['grain', 'grain'], 'engineered-wood': ['laminated', 'laminated'], 'insulation-batt': ['batt', 'batt'], generic: ['poche', 'poche'],
  lawn: [['lawn'], ['lawn']], mulch: [['mulch'], ['mulch']], asphalt: [['asphalt'], ['asphalt']], 'unit-pavers': [['pavers'], ['pavers']],
  flagstone: [['flagstone'], ['flagstone']], water: [['water'], ['water']], decking: [['boards'], ['boards']]
};

test('every material category draws its documented hatch in both profiles', () => {
  const { api } = loadStudio();
  assert.deepEqual(Object.keys(HATCH_CONTRACT).sort(), [...Object.keys(api.MATERIAL_CATEGORIES)].sort(), 'the contract covers every category');
  const box = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
  const frame = { o: { x: 0, y: 10 }, u: { x: 1, y: 0 }, v: { x: 0, y: -1 }, L: 20, T: 10 };
  for (const [index, profile] of [api.PROFILES.imperial, api.PROFILES.metric].entries()) {
    const model = structuredClone(index ? metricMaterialFixture : materialFixture);
    for (const [category, expected] of Object.entries(HATCH_CONTRACT)) {
      const markup = api.materialContext(model, profile, true).region(box, frame, category), label = `${profile.id} ${category}`;
      const patterns = [...markup.matchAll(/url\(#hatch-([a-z-]+)\)/g)].map(match => match[1]).sort();
      if (Array.isArray(expected[index])) { assert.deepEqual(patterns, expected[index], label); continue; }
      assert.equal(patterns.length, 0, label);
      const symbol = expected[index];
      if (symbol === 'solid') assert.match(markup, /fill="#1b1b1b"/, label);
      if (symbol === 'poche') assert.match(markup, /fill="#4d4d4d"/, label);
      if (symbol === 'batt') assert.match(markup, /<path d="M[^"]+ C/, label);
      if (symbol === 'zigzag' || symbol === 'grain') assert.equal((markup.match(/<polyline/g) ?? []).length, 2, label);
      if (symbol === 'laminated') assert.ok((markup.match(/<line/g) ?? []).length >= 2, label);
    }
  }
});

test('thin regions stay unhatched except steel, and material detail follows each profile scale', () => {
  const { api } = loadStudio();
  const ctx = api.materialContext(structuredClone(materialFixture), api.PROFILES.imperial, true);
  const thin = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 0.5 }, { x: 0, y: 0.5 }];
  const frame = { o: { x: 0, y: 0.5 }, u: { x: 1, y: 0 }, v: { x: 0, y: -1 }, L: 20, T: 0.5 };
  for (const category of ['gypsum', 'concrete', 'insulation-batt', 'wood-framing']) assert.doesNotMatch(ctx.region(thin, frame, category), /url\(|<path|<polyline|<line/, category);
  assert.match(ctx.region(thin, frame, 'steel'), /fill="#1b1b1b"/);
  // 5/8" gypsum at 1/4" = 1'-0" is 0.33 mm on paper: outlined, never hatched.
  const plan = api.renderPlanSheet(structuredClone(materialFixture), 'level-upper').svg;
  assert.doesNotMatch(plan.match(/<g data-layer="wallFill"[^>]*>([\s\S]*?)<\/g>/)[1], /url\(#hatch-stipple\)/);

  const imperial = structuredClone(materialFixture), metric = structuredClone(metricMaterialFixture);
  assert.equal(api.materialsActive(imperial, 96), true, '1/8" = 1\'-0"');
  assert.equal(api.materialsActive(imperial, 128), false, '3/32" = 1\'-0"');
  assert.equal(api.materialsActive(metric, 100), true, '1:100');
  assert.equal(api.materialsActive(metric, 200), false, '1:200');
  assert.equal(api.materialsActive(withoutCatalog(metricFixture), 12), false, 'no catalog, no detail');
});

test('oblique layered walls hatch, miter, and stay finite', () => {
  const { api } = loadStudio();
  const model = structuredClone(metricMaterialFixture);
  const u1 = { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) }, u2 = { x: -u1.y, y: u1.x };
  const p = (base, u, d) => ({ x: Math.round(base.x + u.x * d), y: Math.round(base.y + u.y * d) });
  const a = { x: 0, y: 0 }, b = p(a, u1, 5000), c = p(b, u2, 3000), mid = p(a, u1, 2500);
  const layers = [{ id: 'veneer', materialId: 'mat-brick', thicknessMm: 115 }, { id: 'studs', materialId: 'mat-batt', thicknessMm: 160 }];
  const wall = (id, start, end, extra) => ({ id, levelId: 'level-ground', start, end, thicknessMm: 275, heightMm: 2800, kind: 'exterior', layers, evidence: fixture.walls[0].evidence, ...extra });
  model.walls = [wall('wall-a', a, b), wall('wall-b', b, c), { ...wall('wall-c', mid, p(mid, u2, 2000)), thicknessMm: 130, kind: 'interior', layers: undefined, materialId: 'mat-lumber' }];
  delete model.walls[2].layers;
  Object.assign(model, { openings: [], spaces: [], slabs: [], roofs: [], stairs: [], fixtures: [], beams: [], columns: [], foundations: [], surfaces: [], dimensions: [], sections: [] });
  assert.equal(errorCodes(api, model).length, 0, JSON.stringify(api.validateModel(model)));
  const sheet = api.renderPlanSheet(model, 'level-ground');
  assert.doesNotMatch(sheet.svg, /NaN|Infinity/);
  assert.match(sheet.svg, /url\(#hatch-diagonal\)/);
  assert.match(sheet.svg, /<path d="M[^"]+ C/, 'batt wave follows the oblique wall');
  const vertices = id => [...entityGroup(sheet.svg, id).matchAll(/points="([^"]+)"/g)][0][1].split(' ').map(pair => pair.split(',').map(Number));
  const shared = vertices('wall-a').filter(([x, y]) => vertices('wall-b').some(([x2, y2]) => Math.hypot(x - x2, y - y2) < 0.02));
  assert.equal(shared.length, 2, 'the 90 degree oblique corner miters on a shared edge');
});

test('interior-to-exterior layer order survives reversing a wall', () => {
  const { api } = loadStudio();
  const original = structuredClone(materialFixture), reversed = structuredClone(materialFixture);
  const wall = reversed.walls.find(item => item.id === 'wall-g-south'), length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  [wall.start, wall.end] = [wall.end, wall.start];
  for (const opening of reversed.openings.filter(item => item.wallId === wall.id)) opening.offsetMm = Math.round(length - opening.offsetMm - opening.widthMm);
  const layersOf = model => [...api.sectionGeometry(model, model.sections[0]).regions].filter(region => region.id === 'wall-g-south').map(region => `${region.role}:${region.materialId}:${Math.round(region.h0)}:${Math.round(region.h1)}:${region.z0}`).sort();
  assert.deepEqual(layersOf(reversed), layersOf(original));
  assert.equal(errorCodes(api, reversed).length, 0);
});

test('foundations and surfaces may be any simple polygon', () => {
  const { api } = loadStudio();
  const u = [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 2000 }, { x: 2000, y: 2000 }, { x: 2000, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 2000 }, { x: 0, y: 2000 }];
  const intervals = [...api.segmentPolygonIntervals({ x: -500, y: 1500 }, { x: 3500, y: 1500 }, u)].map(([t0, t1]) => [t0 * 4000 - 500, t1 * 4000 - 500].map(Math.round));
  assert.deepEqual(intervals, [[0, 1000], [2000, 3000]], 'a U shape is crossed twice');
  const tris = api.triangulate(u);
  assert.equal(tris.length, u.length - 2);
  const triArea = tris.reduce((sum, [i, j, k]) => sum + Math.abs((u[j].x - u[i].x) * (u[k].y - u[i].y) - (u[k].x - u[i].x) * (u[j].y - u[i].y)) / 2, 0);
  assert.equal(triArea, 5000000);
  const extruded = [];
  api.pushExtrusion(extruded, u, 0, 300, [1, 1, 1]);
  assert.equal(extruded.length, ((u.length - 2) * 2 + u.length * 2) * 3 * 6);

  const model = structuredClone(materialFixture);
  const walk = model.surfaces.find(item => item.id === 'surface-shop-walk');
  assert.equal(walk.boundary.length, 6);
  assert.equal(entityGroup(api.renderPlanSheet(model, 'level-ground').svg, 'surface-shop-walk').match(/points="([^"]+)"/)[1].split(' ').length, 6);
  const door = model.openings.find(item => item.id === 'opening-shop-door');
  const y = door.offsetMm + door.widthMm / 2;
  const throughWalk = { ...model.sections[1], start: { ...model.sections[1].start, y }, end: { ...model.sections[1].end, y } };
  assert.ok(api.sectionGeometry(model, throughWalk).cut.some(item => item.id === 'surface-shop-walk'));
});

test('the material key never drops entries silently', () => {
  const { api } = loadStudio();
  const model = structuredClone(materialFixture), slab = model.slabs.find(item => item.id === 'slab-upper');
  slab.layers = Array.from({ length: 23 }, (_, i) => ({ id: `layer-${i}`, materialId: `mat-extra-${i}`, thicknessMm: i < 22 ? 12 : slab.thicknessMm - 12 * 22 }));
  for (let i = 0; i < 23; i += 1) model.materials.push({ id: `mat-extra-${i}`, name: `Extra finish material number ${i}`, category: 'gypsum', evidence: fixture.walls[0].evidence });
  const sheet = api.renderSectionSheet(model, 'section-aa');
  const warning = sheet.warnings.find(item => item.code === 'material.key-overflow');
  assert.ok(warning, 'overflow is reported');
  assert.match(warning.message, /Extra finish material number 22/);
  assert.match(sheet.svg, /drawn but not keyed/);
});

test('drawings carry no structural detail the model does not author', () => {
  const { api } = loadStudio();
  const model = structuredClone(materialFixture);
  for (const id of ['section-aa', 'section-bb']) {
    const materials = api.renderSectionSheet(model, id).svg.match(/<g data-role="materials"[^>]*>([\s\S]*?)<\/g>/)[1];
    assert.doesNotMatch(materials, /<circle/, `${id}: no reinforcing bars without bar data`);
  }
  delete model.openings.find(item => item.id === 'opening-overhead-door').headers[0].materialId;
  assert.match(api.renderSectionSheet(model, 'section-aa').svg, />MATERIAL NOT SPECIFIED</, 'a header without a material is unspecified, not steel by kind');
});

test('the mixed-material examples are generated and structurally identical', async () => {
  const generator = await import('../examples/build-mixed-material-workshop.mjs');
  for (const spec of generator.SPECS) {
    assert.equal(fs.readFileSync(generator.examplePath(spec), 'utf8').replace(/\r\n/g, '\n'), generator.serialize(generator.buildExample(spec)), `${spec.id} is current`);
  }
  const shape = model => JSON.stringify(Object.fromEntries(Object.entries(model).filter(([, value]) => Array.isArray(value)).map(([key, items]) => [key, items.map(item => [item.id, item.kind, (item.layers ?? []).map(layer => layer.id), (item.headers ?? []).map(header => `${header.kind}:${header.layerId}:${header.face ?? ''}`)])])));
  assert.equal(shape(materialFixture), shape(metricMaterialFixture));
});

// ---------------------------------------------------------------------------
// Source images: scale selection, the calibration hand-off, underlays, and source-only mode.
// ---------------------------------------------------------------------------
const siteFixture = readFixture('hillside-garden-house');
const HASH = `sha256:${'a'.repeat(64)}`;
const cal = (id, method, mmPerPx, relativeUncertainty, extra = {}) => ({ id, method, estimated: !['manual', 'control-points'].includes(method), mmPerPx, relativeUncertainty, provenance: 'test', sourceRevision: 2, createdAt: '2026-10-01T00:00:00Z', ...extra });
const testSource = (calibrations = [], extra = {}) => ({
  id: 'survey-plat', path: 'sources/survey-plat.png', kind: 'survey', format: 'png', contentHash: HASH, revision: 2, calibrationRevision: 3,
  pixels: { width: 4000, height: 3000 }, exifOrientation: 1, importedAt: '2026-10-01T00:00:00Z', calibrations, references: [], ...extra
});
// Placement transform per coordinate-contract.md: a = s cos t, b = s sin t, c = s sin t, d = -s cos t.
const placementTransform = (s, deg, e, f) => { const t = deg * Math.PI / 180; return { a: s * Math.cos(t), b: s * Math.sin(t), c: s * Math.sin(t), d: -s * Math.cos(t), e, f }; };
const underlayParts = svg => {
  const match = svg.match(/<g data-layer="underlay" pointer-events="none"><clipPath id="([^"]+)"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"\/><\/clipPath><g clip-path="url\(#\1\)">(<image [^>]*\/>)<\/g><\/g>/);
  assert.ok(match, 'the sheet draws one underlay group');
  const image = match[6], matrix = image.match(/transform="matrix\(([^)]+)\)"/)[1].split(',').map(Number);
  return { clip: { x0: +match[2], y0: +match[3], x1: +match[2] + +match[4], y1: +match[3] + +match[5] }, image, matrix };
};
// Values from the vm realm have foreign prototypes; strict deepEqual needs plain copies.
const plain = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

function assertUnderlayGeometry(sheet, transform, model, pixels) {
  const { matrix, clip, image } = underlayParts(sheet.svg);
  const { place, ext, ratio } = sheet.frame;
  const toModel = p => ({ x: transform.a * p.x + transform.c * p.y + transform.e, y: transform.b * p.x + transform.d * p.y + transform.f });
  const toSheet = p => ({ x: place.x + (p.x - ext.minX) / ratio, y: place.y + (ext.maxY - p.y) / ratio });
  const [A, B, C, D, E, F] = matrix;
  for (const p of [{ x: 0, y: 0 }, { x: pixels.width, y: 0 }, { x: 0, y: pixels.height }, { x: pixels.width, y: pixels.height }, { x: 1234.5, y: 678.9 }]) {
    const expected = toSheet(toModel(p));
    near(A * p.x + C * p.y + E, expected.x, 0.01, `x of pixel ${p.x},${p.y}`);
    near(B * p.x + D * p.y + F, expected.y, 0.01, `y of pixel ${p.x},${p.y}`);
  }
  assert.match(image, new RegExp(`width="${pixels.width}" height="${pixels.height}" preserveAspectRatio="none" opacity="0.4"`));
  assert.ok(model.project.coordinates.trueNorthDeg !== 0, 'the fixture rotates true north');
  return clip;
}

test('length entry accepts the documented grammar and rejects bare numbers', () => {
  const { api } = loadStudio();
  for (const text of ['3810mm', '3810 mm', '3.81m', '381cm', '12.5ft', `12'-6"`, `12' 6"`, `12'6"`, '150in', '150"', '12 ft 6 in', '3,810 mm']) {
    assert.equal(api.parseLength(text).mm, 3810, text);
  }
  assert.equal(api.parseLength(`12'`).mm, 3657.6);
  assert.equal(api.parseLength(`12'-6 1/2"`).mm, 3822.7);
  assert.match(api.parseLength('3810').error, /Add a unit/);
  assert.match(api.parseLength('12 6').error, /Add a unit/);
  for (const text of ['', '0 mm', '-5mm', 'twelve feet', '12 yards']) assert.ok(api.parseLength(text).error, `${JSON.stringify(text)} is rejected`);
});

test('source scale follows the contract selection rules', () => {
  const { api } = loadStudio();
  const precise = api.sourceScale(testSource([cal('cal-1', 'printed-dimension', 10, 0.01), cal('cal-2', 'manual', 11, 0.02)]));
  assert.equal(precise.mmPerPx, 11);
  assert.deepEqual(plain(precise.methods), ['manual']);
  assert.equal(precise.estimated, false);
  assert.equal(precise.disagree, false, 'precise calibrations are compared only with each other');

  const mean = api.sourceScale(testSource([cal('cal-1', 'printed-dimension', 10, 0.01), cal('cal-2', 'printed-dimension', 10.4, 0.02)]));
  near(mean.mmPerPx, (10 / 0.01 ** 2 + 10.4 / 0.02 ** 2) / (1 / 0.01 ** 2 + 1 / 0.02 ** 2), 1e-12, 'inverse-variance mean');
  near(mean.relativeUncertainty, 1 / Math.sqrt(1 / 0.01 ** 2 + 1 / 0.02 ** 2), 1e-12, 'combined uncertainty');
  assert.equal(mean.disagree, false);
  assert.equal(mean.estimated, true);

  const ordered = api.sourceScale(testSource([cal('cal-1', 'scale-bar', 11, 0.01), cal('cal-2', 'printed-dimension', 10, 0.05)]));
  assert.equal(ordered.mmPerPx, 10, 'printed-dimension comes before scale-bar');
  assert.equal(ordered.disagree, true, 'every automatic method is compared');

  const horizontal = { from: { x: 0, y: 0 }, to: { x: 1000, y: 0 } }, vertical = { from: { x: 0, y: 0 }, to: { x: 0, y: 1000 } };
  const uneven = api.sourceScale(testSource([cal('cal-1', 'printed-dimension', 10, 0.01, horizontal), cal('cal-2', 'printed-dimension', 11, 0.01, vertical)]));
  assert.equal(uneven.disagree, true);
  assert.equal(uneven.uneven, true);
  assert.equal(api.sourceScale(testSource([cal('cal-1', 'manual', 10, 0.01), cal('cal-2', 'manual', 10.6, 0.01)])).disagree, true);

  assert.equal(api.sourceScale(testSource([cal('cal-1', 'known-object', 9, 0.1)])), null, 'known-object needs acceptedByUser');
  const known = api.sourceScale(testSource([cal('cal-1', 'known-object', 9, 0.1, { acceptedByUser: true })]));
  assert.deepEqual(plain([known.mmPerPx, known.methods]), [9, ['known-object']]);
  const knownIgnored = api.sourceScale(testSource([cal('cal-1', 'known-object', 20, 0.1, { acceptedByUser: true }), cal('cal-2', 'stated-scale', 10, 0.02)]));
  assert.deepEqual([knownIgnored.mmPerPx, knownIgnored.disagree], [10, false], 'known-object is the last resort and never compared');

  const withRegion = testSource([cal('cal-1', 'printed-dimension', 10, 0.01), cal('cal-2', 'scale-bar', 2, 0.01, { region: { x0: 100, y0: 100, x1: 900, y1: 900 } })]);
  assert.equal(api.sourceScale(withRegion).disagree, true, 'one image has one scale: a stray region field isolates nothing');
  assert.equal(api.sourceScale(withRegion).region, undefined);
  assert.equal(api.sourceScaleGroups, undefined, 'scale groups were removed');
  assert.equal(api.sourceScale(testSource([cal('cal-1', 'manual', 10, 0.01)], { kind: 'photo' })), null, 'photos are never calibrated');
});

test('the calibration payload is the exact text the apply command reads', () => {
  const { api } = loadStudio();
  const source = testSource();
  const text = api.calibrationPayload(source, {
    calibration: { from: { x: 100.04, y: 200.06 }, to: { x: 3100.16, y: 200 }, distanceMm: 3810, entered: ` 12'-6" `, uncertaintyPx: 0.3, region: { x0: 3200, y0: 2900, x1: 10, y1: 20, label: 'Main plan' } },
    references: [{ label: 'NE house corner', pixel: { x: 12.34, y: 6.78 } }, { label: '  ', pixel: { x: 1, y: 1 } }]
  });
  assert.equal(text, 'Architecture Studio calibration for survey-plat. Paste this to your agent; it applies it with scripts/import-image.mjs apply.\n'
    + `{"type":"architecture-studio/source-calibration","version":1,"sourceId":"survey-plat","contentHash":"${HASH}","pixels":{"width":4000,"height":3000},"sourceRevision":2,"calibrationRevision":3,`
    + `"calibration":{"from":{"x":100,"y":200.1},"to":{"x":3100.2,"y":200},"distanceMm":3810,"entered":"12'-6\\"","uncertaintyPx":0.5},`
    + '"references":[{"label":"NE house corner","pixel":{"x":12.3,"y":6.8}}]}');
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  assert.equal(json.calibration.entered, `12'-6"`);

  const referencesOnly = api.calibrationPayload(source, { references: [{ label: 'Gate', pixel: { x: 5, y: 5 } }] });
  const parsed = JSON.parse(referencesOnly.slice(referencesOnly.indexOf('{')));
  assert.equal(parsed.calibration, undefined);
  assert.deepEqual(parsed.references, [{ label: 'Gate', pixel: { x: 5, y: 5 } }]);
  const unlabelled = api.calibrationPayload(source, { calibration: { from: { x: 0, y: 0 }, to: { x: 3000, y: 0 }, distanceMm: 1000, entered: '1 m', uncertaintyPx: 2 } });
  assert.deepEqual(JSON.parse(unlabelled.slice(unlabelled.indexOf('{'))).calibration, { from: { x: 0, y: 0 }, to: { x: 3000, y: 0 }, distanceMm: 1000, entered: '1 m', uncertaintyPx: 2 });
  assert.throws(() => api.calibrationPayload(source, {}), /a scale line, a labelled reference point, or a labelled area/);
});

test('areas are measured from the scale and copied with labels', () => {
  const { api } = loadStudio();
  api.state.model = cloneFixture();
  assert.equal(api.state.model.project.coordinates.displayUnits, 'feet-inches');
  // A 300 x 200 px rectangle at 10 mm/px: 60000 px² x 100 = 6 m² = 64.58 sq ft; perimeter 1000 px = 10 m.
  const rect = [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 300 }, { x: 100, y: 300 }];
  const scaled = testSource([cal('cal-1', 'scale-bar', 10, 0.01)]);
  const measure = api.areaMeasure(scaled, rect);
  near(measure.areaMm2, 6e6, 1e-6, 'area');
  near(measure.perimeterMm, 10000, 1e-9, 'perimeter');
  near(measure.relativeUncertainty, 0.02, 1e-12, 'twice the scale uncertainty');
  assert.equal(api.areaSummary(scaled, measure), `64.6 sq ft ± 1.3 sq ft, perimeter 32'-9 3/4", estimated`);
  assert.equal(api.areaSummary(scaled, measure, 'metric'), '6.00 m² ± 0.12 m², perimeter 10.00 m, estimated');

  // The draft's own scale line, 3000 px = 15 m (5 mm/px), takes precedence over the scale bar: 1.5 m².
  const draft = (areas, extra = {}) => ({ from: { x: 0, y: 0 }, to: { x: 3000, y: 0 }, fromU: 0.5, toU: 0.5, distanceText: '15 m', references: [], areas, areaPoints: [], ...extra });
  const size = { width: 4000, height: 3000 };
  const check = api.draftCheck(scaled, draft([{ label: 'Garden bed', points: rect }]), size);
  const fromLine = api.areaMeasure(scaled, rect, check.calibration);
  near(fromLine.areaMm2, 1.5e6, 1e-6, 'area from the draft line');
  near(fromLine.relativeUncertainty, 2 * (2 * 0.5 / 3000), 1e-12, 'uncertainty of the draft line');
  assert.equal(fromLine.fromDraft, true);
  assert.equal(api.areaSummary(scaled, fromLine), `16.1 sq ft ± 0.0 sq ft, perimeter 16'-4 7/8"`);
  assert.deepEqual(Object.keys(check.calibration).sort(), ['distanceMm', 'entered', 'from', 'to', 'uncertaintyPx'], 'the draft line applies to the whole image');

  // Without a scale the area is not measured but can still be labelled and copied.
  const bare = testSource();
  assert.equal(api.areaMeasure(bare, rect), null);
  assert.equal(api.areaSummary(bare, null), 'Not measured: add a scale line.');
  const photo = testSource([], { kind: 'photo' });
  assert.equal(api.areaMeasure(photo, rect), null);
  assert.equal(api.areaSummary(photo, null), 'Not measured: photos have no scale.');
  const onlyArea = api.draftCheck(bare, draft([{ label: '  Existing shed ', points: [{ x: 10.04, y: 20.06 }, { x: 110, y: 20 }, { x: 60.56, y: 90 }] }], { from: null, to: null, distanceText: '' }), size);
  assert.equal(onlyArea.problem, '');
  assert.equal(onlyArea.calibration, null);
  const text = api.calibrationPayload(bare, onlyArea.input);
  assert.equal(text, 'Architecture Studio calibration for survey-plat. Paste this to your agent; it applies it with scripts/import-image.mjs apply.\n'
    + `{"type":"architecture-studio/source-calibration","version":1,"sourceId":"survey-plat","contentHash":"${HASH}","pixels":{"width":4000,"height":3000},"sourceRevision":2,"calibrationRevision":3,`
    + '"areas":[{"label":"Existing shed","points":[{"x":10,"y":20.1},{"x":110,"y":20},{"x":60.6,"y":90}]}]}');

  // Areas follow references in the payload.
  const both = JSON.parse(api.calibrationPayload(bare, { references: [{ label: 'Gate', pixel: { x: 5, y: 5 } }], areas: [{ label: 'Bed', points: rect }] }).split('\n')[1]);
  assert.deepEqual(Object.keys(both).slice(-2), ['references', 'areas']);

  assert.equal(api.draftCheck(bare, draft([{ label: '', points: rect }], { from: null, to: null, distanceText: '' }), size).problem, 'Label every area.');
  assert.equal(api.draftCheck(bare, draft([{ label: 'A', points: rect }, { label: 'A ', points: rect }], { from: null, to: null, distanceText: '' }), size).problem, 'Give each area its own label.');
  assert.equal(api.draftCheck(bare, draft([], { from: null, to: null, distanceText: '', areaPoints: [{ x: 1, y: 1 }] }), size).problem, 'Finish or cancel the area you are outlining.');
  assert.equal(api.draftCheck(bare, draft([{ label: 'Strip', points: rect.slice(0, 2) }], { from: null, to: null, distanceText: '' }), size).problem, 'An area needs at least 3 points.');
  assert.throws(() => api.calibrationPayload(bare, { areas: [{ label: 'Strip', points: rect.slice(0, 2) }] }), /at least 3 points/);
  assert.throws(() => api.calibrationPayload(bare, { areas: [{ label: ' ', points: rect }] }), /Label every area/);
});

test('named features take default labels, and recorded ones can be renamed or removed', () => {
  const { api } = loadStudio();
  const rect = [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 300 }];
  const size = { width: 4000, height: 3000 };
  const source = testSource([], { references: [{ label: 'Point 1', pixel: { x: 10.25, y: 20.5 } }, { label: 'Gate', pixel: { x: 5, y: 5 } }], areas: [{ label: 'Area 2', points: rect }] });
  const draft = (extra = {}) => ({ from: null, to: null, fromU: 0.5, toU: 0.5, distanceText: '', references: [], areas: [], areaPoints: [], saved: { references: {}, areas: {} }, ...extra });
  const payload = check => plain(api.calibrationPayloadObject(source, check.input));

  // "Point N" and "Area N" take the smallest N no recorded or draft mark of that kind uses.
  assert.equal(api.nextMarkLabel(source, draft(), 'point'), 'Point 2');
  assert.equal(api.nextMarkLabel(source, draft({ references: [{ label: 'Point 2', pixel: { x: 1, y: 1 } }] }), 'point'), 'Point 3');
  assert.equal(api.nextMarkLabel(source, draft(), 'area'), 'Area 1', 'points and areas are numbered apart');
  assert.equal(api.nextMarkLabel(source, draft({ areas: [{ label: ' Area 1 ', points: rect }] }), 'area'), 'Area 3');
  assert.equal(api.nextMarkLabel(source, draft({ saved: { references: { 'Point 1': { label: 'Point 2', removed: false } }, areas: {} } }), 'point'), 'Point 3', 'a recorded label stays taken until saved');
  assert.equal(api.nextMarkLabel(testSource(), { references: [] }, 'point'), 'Point 1');

  const listed = api.savedMarks(source, draft({ saved: { references: { Gate: { label: 'Gate', removed: true } }, areas: {} } }));
  assert.deepEqual(plain(listed.references.map(item => [item.original, item.label, item.removed])), [['Point 1', 'Point 1', false], ['Gate', 'Gate', true]]);
  assert.deepEqual(plain(listed.areas[0].points), rect);

  // Nothing edited: nothing to save.
  assert.equal(api.draftCheck(source, draft(), size).input, null);
  assert.throws(() => api.calibrationPayloadObject(source, { removeReferences: [], removeAreas: [' '] }), /a scale line, a labelled reference point, or a labelled area/);

  // Labels are checked across recorded and draft marks, and the problem names the inputs.
  const clash = api.draftCheck(source, draft({ references: [{ label: ' Gate ', pixel: { x: 1, y: 1 } }] }), size);
  assert.equal(clash.problem, 'Give each reference point its own label.');
  assert.equal(clash.markProblem, true);
  assert.deepEqual(plain(clash.invalidIds), ['cal-saved-ref-1', 'cal-ref-0']);
  const cleared = api.draftCheck(source, draft({ saved: { references: { 'Point 1': { label: '  ', removed: false } }, areas: {} } }), size);
  assert.deepEqual(plain([cleared.problem, cleared.invalidIds]), ['Label every reference point.', ['cal-saved-ref-0']]);
  const areaClash = api.draftCheck(source, draft({ areas: [{ label: 'Area 2', points: rect }] }), size);
  assert.deepEqual(plain([areaClash.problem, areaClash.invalidIds]), ['Give each area its own label.', ['cal-saved-area-0', 'cal-area-0']]);
  const replaced = api.draftCheck(source, draft({ references: [{ label: 'Gate', pixel: { x: 1, y: 1 } }], saved: { references: { Gate: { label: 'Gate', removed: true } }, areas: {} } }), size);
  assert.equal(replaced.problem, '', 'a removed label is free again');
  assert.deepEqual(payload(replaced).removeReferences, ['Gate']);
  const unscaled = api.draftCheck(source, draft({ distanceText: '3 m' }), size);
  assert.equal(unscaled.markProblem, false, 'a scale line problem is not a mark problem');
  assert.deepEqual(plain(unscaled.invalidIds), []);

  // A rename removes the old label and adds the mark, where it was recorded, under the new one.
  const renamed = api.draftCheck(source, draft({ saved: { references: { 'Point 1': { label: ' NE corner ', removed: false } }, areas: { 'Area 2': { label: 'Bed', removed: false } } } }), size);
  assert.equal(renamed.problem, '');
  const body = payload(renamed);
  assert.deepEqual(body.removeReferences, ['Point 1']);
  assert.deepEqual(body.references, [{ label: 'NE corner', pixel: { x: 10.25, y: 20.5 } }], 'the recorded pixel is sent as stored');
  assert.deepEqual(body.removeAreas, ['Area 2']);
  assert.deepEqual(body.areas, [{ label: 'Bed', points: rect }]);
  assert.deepEqual(Object.keys(body).slice(-4), ['removeReferences', 'removeAreas', 'references', 'areas'], 'removals come first');
  const same = api.draftCheck(source, draft({ saved: { references: { 'Point 1': { label: ' Point 1 ', removed: false } }, areas: {} } }), size);
  assert.equal(same.input, null, 'a label typed back to the recorded one is no change');

  // A removal alone is a valid payload.
  const removed = api.draftCheck(source, draft({ saved: { references: { Gate: { label: 'Gate', removed: true } }, areas: {} } }), size);
  const removal = payload(removed);
  assert.deepEqual(removal.removeReferences, ['Gate']);
  for (const key of ['calibration', 'references', 'areas', 'removeAreas']) assert.equal(key in removal, false, `no ${key}`);
  const text = api.calibrationPayload(source, removed.input);
  assert.deepEqual(JSON.parse(text.slice(text.indexOf('{'))), removal, 'Copy calibration carries the same removal');
  const fresh = payload(api.draftCheck(source, draft({ references: [{ label: 'Point 2', pixel: { x: 1.04, y: 1 } }] }), size));
  assert.equal('removeReferences' in fresh || 'removeAreas' in fresh, false, 'the removal lists appear only when non-empty');
  assert.deepEqual(fresh.references, [{ label: 'Point 2', pixel: { x: 1, y: 1 } }]);

  // Save closes an outline of 3 or more corners under its default label; a shorter one still blocks it.
  const outlining = draft({ areaPoints: rect });
  const closed = api.closeOpenArea(source, outlining);
  assert.notEqual(closed, outlining);
  assert.deepEqual(plain(closed.areas), [{ label: 'Area 1', points: rect }]);
  assert.deepEqual(plain(closed.areaPoints), []);
  assert.equal(outlining.areaPoints.length, 3, 'the draft itself is not changed');
  const two = draft({ areaPoints: rect.slice(0, 2) }), line = draft({ areaPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] });
  assert.equal(api.closeOpenArea(source, two), two);
  assert.equal(api.closeOpenArea(source, line), line, 'points on one line are not closed');
  const open = api.draftCheck(source, outlining, size);
  assert.equal(open.problem, '');
  assert.deepEqual(payload(open).areas, [{ label: 'Area 1', points: rect }]);
  const short = api.draftCheck(source, two, size);
  assert.deepEqual(plain([short.problem, short.markProblem, short.invalidIds, short.input]), ['Finish or cancel the area you are outlining.', true, [], null]);
});

test('a manual distance that disagrees with the estimate warns before copying', () => {
  const { api } = loadStudio();
  const source = testSource([cal('cal-1', 'scale-bar', 10, 0.01)]);
  const draft = text => ({ from: { x: 0, y: 0 }, to: { x: 3000, y: 0 }, fromU: 0.5, toU: 0.5, distanceText: text, references: [] });
  const size = { width: 4000, height: 3000 };
  assert.equal(api.draftCheck(source, draft('30 m'), size).distanceWarning, '', 'agreeing with the scale bar');
  const wrong = api.draftCheck(source, draft('20 m'), size);
  assert.match(wrong.distanceWarning, /^This overrides the scale bar estimate, which makes this line about 98'-5 1\/8" \(50% different\)\.$/);
  assert.ok(wrong.input, 'a warning never blocks copying');
  const manualOnly = testSource([cal('cal-1', 'manual', 10, 0.01)]);
  assert.equal(api.draftCheck(manualOnly, draft('20 m'), size).distanceWarning, '', 'only automatic estimates are compared');
});

test('underlays map image pixels through the plan and site sheet maps', () => {
  const { api } = loadStudio();
  const pixels = { width: 4000, height: 3000 };
  // One pair and north: theta = north.deg - trueNorthDeg.
  const plan = cloneFixture(), planTransform = placementTransform(5, 35 - plan.project.coordinates.trueNorthDeg, -2000, 16000);
  const underlay = transform => [{ href: 'blob:underlay', ...pixels, transform, opacity: 0.4 }];
  const planSheet = api.renderPlanSheet(plan, 'level-ground', { underlays: underlay(planTransform) });
  const planClip = assertUnderlayGeometry(planSheet, planTransform, plan, pixels);
  for (const key of ['x0', 'y0', 'x1', 'y1']) near(planClip[key], planSheet.frame.clip[key], 1e-6, `plan clip ${key}`);
  const area = api.drawingArea(api.profileFor(plan));
  assert.deepEqual(plain(planSheet.frame.clip), { x0: area.x0, y0: area.y0, x1: area.x1, y1: area.y1 });
  const layers = [...planSheet.svg.matchAll(/data-layer="([^"]+)"/g)].map(match => match[1]);
  assert.equal(layers[0], 'underlay', 'the underlay sits beneath all linework');
  const systems = api.renderPlanSheet(plan, 'level-ground', { systems: new Set(['plumbing']), underlays: underlay(planTransform) });
  assertUnderlayGeometry(systems, planTransform, plan, pixels);

  const site = structuredClone(siteFixture), siteTransform = placementTransform(40, 200 - site.project.coordinates.trueNorthDeg, -30000, 60000);
  const siteSheet = api.renderSitePlanSheet(site, { underlays: underlay(siteTransform) });
  const siteClip = assertUnderlayGeometry(siteSheet, siteTransform, site, pixels);
  const siteArea = api.drawingArea(api.profileFor(site));
  assert.ok(api.plantSchedule(site).length, 'the fixture has a plant schedule');
  near(siteClip.x1, siteArea.x1 - 96, 1e-6, 'the clip stops short of the schedule column');
  const scheduleX = Number(siteSheet.svg.match(/<g data-role="plant-schedule"><text[^>]*\sx="([\d.]+)"/)[1]);
  assert.ok(scheduleX >= siteClip.x1, 'the plant schedule lies outside the underlay clip');

  // The frame is the map the sheet draws with: the site model's plan clips its site layer to it.
  const hillsidePlan = api.renderPlanSheet(site, 'level-ground');
  const { place, ext, ratio } = hillsidePlan.frame, a = { x: place.x, y: place.y }, b = { x: place.x + (ext.maxX - ext.minX) / ratio, y: place.y + (ext.maxY - ext.minY) / ratio };
  const frameClip = hillsidePlan.svg.match(/<clipPath id="plan-frame-level-ground"><polygon points="([^"]+)"/)[1].split(' ').map(pair => pair.split(',').map(Number));
  near(frameClip[0][0], a.x, 0.01, 'frame x0'); near(frameClip[0][1], a.y, 0.01, 'frame y0');
  near(frameClip[2][0], b.x, 0.01, 'frame x1'); near(frameClip[2][1], b.y, 0.01, 'frame y1');
});

test('underlays never reach exported drawings', () => {
  const { api } = loadStudio();
  const model = cloneFixture();
  const bare = api.renderPlanSheet(model, 'level-ground');
  const withUnderlay = api.renderPlanSheet(model, 'level-ground', { underlays: [{ href: 'blob:x', width: 10, height: 10, transform: placementTransform(1, 0, 0, 0), opacity: 0.5 }] });
  assert.equal(withUnderlay.svg.replace(/<g data-layer="underlay"[\s\S]*?<\/g><\/g>/, ''), bare.svg, 'the underlay adds one group and changes nothing else');
  assert.equal(api.renderPlanSheet(model, 'level-ground', { underlays: [] }).svg, bare.svg);

  const before = buildDrawingSet(html, model).sheets.map(sheet => sheet.svg);
  api.state.model = model;
  api.state.underlay = true;
  api.state.sources = { status: 'loaded', data: { schemaVersion: '1.0.0', sources: [testSource([], { placement: { view: 'level-ground', pairs: [], mmPerPx: 1, rotationDeg: 0, transform: placementTransform(1, 0, 0, 0), residualsMm: [], calibrationRevision: 3, sourceRevision: 2, createdAt: '2026-10-01T00:00:00Z' } })] } };
  assert.deepEqual(plain(api.renderDrawingSet(model).map(sheet => sheet.svg)), plain(before));
  assert.ok(before.every(svg => !svg.includes('data-layer="underlay"')));
});

test('sources manifests are checked before use', () => {
  const { api } = loadStudio();
  assert.equal(api.sourcesProblem({ schemaVersion: '1.0.0', sources: [testSource()] }), null);
  assert.match(api.sourcesProblem({ schemaVersion: '2.0.0', sources: [] }), /reads 1\.0\.0/);
  assert.match(api.sourcesProblem({ schemaVersion: '1.0.0', sources: [testSource([], { path: '../models/building.json' })] }), /entry 1 \(survey-plat\) is malformed/);
  assert.match(api.sourcesProblem({ schemaVersion: '1.0.0', sources: [testSource([], { path: 'sources/..' })] }), /malformed/);
  const placed = testSource([], { placement: { sourceRevision: 2, calibrationRevision: 3 } });
  assert.equal(api.placementStale(placed), false);
  assert.equal(api.placementStale({ ...placed, calibrationRevision: 4 }), true);
  assert.equal(api.placementStale({ ...placed, revision: 3 }), true);

  // A north-derived placement records the trueNorthDeg it used; moving the model's true north stales it.
  const northPlaced = testSource([], { placement: { sourceRevision: 2, calibrationRevision: 3, usesNorth: true, trueNorthDeg: 18 } });
  const model = cloneFixture();
  model.project.coordinates.trueNorthDeg = 18;
  assert.equal(api.placementStale(northPlaced, model), false);
  model.project.coordinates.trueNorthDeg = 20;
  assert.equal(api.placementStale(northPlaced, model), true);
  api.state.model = model;
  assert.equal(api.placementStale(northPlaced), true, 'the viewer checks against the loaded model by default');
  assert.equal(api.placementStale(placed, model), false, 'a placement fitted from pairs does not depend on true north');
});

// A browser stand-in just large enough to run start(): elements are inert records, fetch serves a
// fixed set of project files, and the clipboard is captured. `token` plays scripts/serve.mjs's write
// token; `post` answers its POST requests; timers, reloads, and history URLs are captured, not run.
function startHarness({ files, search = '', token = '', protocol = 'http:', post = null, picker, pageHtml }) {
  const elements = new Map(), listeners = [], doc = { activeElement: null, listeners: {}, ...(pageHtml ? { documentElement: { outerHTML: pageHtml } } : {}) };
  class Element {
    constructor(attrs = {}) { Object.assign(this, { innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, style: {}, dataset: {}, options: [], attributes: {}, listeners: {} }, attrs); const set = new Set(); this.classList = { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c), toggle: (c, on = !set.has(c)) => (on ? set.add(c) : set.delete(c), on) }; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); listeners.push(type); }
    dispatch(type, event = {}) { for (const fn of [...(this.listeners[type] ?? [])]) fn({ preventDefault() {}, stopPropagation() {}, target: this, ...event }); }
    querySelector(selector) { return element(`${selector}@child`); }
    querySelectorAll() { return []; }
    contains(other) { return other === this || other?.parent === this; }
    focus() { doc.activeElement = this; }
    select() {}
    click() { this.clicked = true; }
    remove() {}
    setPointerCapture() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  }
  const element = selector => { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); };
  const tabs = [...html.matchAll(/<button class="tab" role="tab" id="(tab-[a-z]+)" data-view="([a-z]+)"[^>]*?( hidden)?>/g)].map(([, id, view, hidden]) => {
    const tab = element(`#${id}`); Object.assign(tab, { id, dataset: { view }, hidden: Boolean(hidden) }); return tab;
  });
  const tools = [...html.matchAll(/data-tool="([a-z]+)"/g)].map(([, tool]) => Object.assign(element(`tool-${tool}`), { dataset: { tool } }));
  const clipboard = [], posts = [], timers = [], reloads = [], urls = [], blobs = [], fetched = [], session = new Map();
  if (token) element('meta[name="architecture-studio-write"]').content = token;
  const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => JSON.parse(body), arrayBuffer: async () => (typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body)).buffer });
  let api;
  const context = vm.createContext({
    console, structuredClone, TextEncoder, URLSearchParams, Blob, crypto: globalThis.crypto,
    URL: { createObjectURL: blob => { blobs.push(blob); return 'blob:source'; } },
    // `picker` plays the browser's save dialog (showSaveFilePicker); without it the page falls back to a download.
    ...(picker ? { showSaveFilePicker: picker } : {}),
    Image: class { set src(value) { this.url = value; } async decode() { this.naturalWidth = 400; this.naturalHeight = 300; } },
    CSS: { escape: value => value },
    navigator: { clipboard: { writeText: async text => { clipboard.push(text); } } },
    location: { search, pathname: '/', hash: '', protocol, reload: () => reloads.push(true) },
    history: { replaceState: (_state, _title, url) => urls.push(url) },
    window: { addEventListener() {} },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    sessionStorage: { getItem: key => session.get(key) ?? null, setItem: (key, value) => session.set(key, String(value)), removeItem: key => session.delete(key) },
    fetch: async (url, init = {}) => {
      if (init.method === 'POST') {
        posts.push({ url, ...init });
        const [status, body] = await post(url, init);
        return { ok: status === 200, status, json: async () => body };
      }
      fetched.push(url);
      return files[url] === undefined ? response('', 404) : response(files[url]);
    },
    document: Object.assign(doc, { querySelector: element, getElementById: id => element(`#${id}`), createElement: () => new Element(), body: { append() {} }, addEventListener(type, fn) { (doc.listeners[type] ??= []).push(fn); }, querySelectorAll: selector => selector === '.tab' ? tabs : selector === '.source-tool' ? tools : [] }),
    __ARCHITECTURE_STUDIO_API__(value) { api = value; }
  });
  vm.runInContext(extractStudioScript(html), context);
  const settle = () => api.sourcesChecked();
  return { api, element, tabs, tools, clipboard, settle, posts, timers, reloads, urls, session, blobs, fetched, doc };
}
const imageBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
const sourcesJson = (overrides = {}) => JSON.stringify({ schemaVersion: '1.0.0', sources: [testSource([], { pixels: { width: 400, height: 300 }, contentHash: `sha256:${crypto.createHash('sha256').update(imageBytes).digest('hex')}`, ...overrides })] });

// Entries of a store-only archive written by zipFiles, by name.
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder(), out = {};
  for (let at = 0; view.getUint32(at, true) === 0x04034b50;) {
    const size = view.getUint32(at + 18, true), nameLength = view.getUint16(at + 26, true), start = at + 30 + nameLength + view.getUint16(at + 28, true);
    out[decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength))] = bytes.subarray(start, start + size);
    at = start + size;
  }
  return out;
}
const waitFor = async check => { for (let i = 0; i < 100 && !check(); i += 1) await new Promise(resolve => setImmediate(resolve)); };
const text = bytes => new TextDecoder().decode(bytes);

test('Export project packages every served project file, the stored viewer, and browser approvals', async () => {
  const listed = ['architecture-studio.json', 'exports/manifest.json', 'exports/plans/removed-level.svg', 'exports/kept.html', 'index.html', 'models/building.json', 'reviews/approvals.json', 'sources/site photo.png'];
  const files = {
    '/__architecture-studio/project-files': JSON.stringify({ files: listed }),
    './architecture-studio.json': '{"tool":"architecture-studio"}',
    './exports/kept.html': '<p>bundle</p>',
    './index.html?raw=1': '<!doctype html><title>stored viewer</title>',
    './models/building.json': JSON.stringify(fixture),
    './reviews/approvals.json': '{"stale":true}',
    './sources/site%20photo.png': imageBytes
  };
  const { api, element, blobs, fetched } = startHarness({ files, token: 'page-token' });
  await api.start();
  api.state.approvals = { 'opening-entry': { approvedAt: '2026-10-01T00:00:00.000Z' } };
  element('#export-project').dispatch('click');
  await waitFor(() => /^Saved|Could not/.test(element('#download-status').textContent));

  const status = element('#download-status').textContent;
  assert.equal(status, "Saved lakeside-barn-residence-project.zip to your browser's downloads folder.");
  assert.equal(element('#export-project').disabled, false);
  assert.ok(fetched.includes('./index.html?raw=1') && !fetched.includes('./index.html'), 'the viewer comes from disk, without the live token or reload script');
  assert.ok(!fetched.includes('./reviews/approvals.json'), 'browser approvals take the place of the saved file');
  assert.ok(!fetched.some(url => /exports\/(manifest\.json|plans\/)/.test(url)), 'saved drawings are replaced by fresh ones, not read');

  const zip = readZip(new Uint8Array(await blobs.at(-1).arrayBuffer()));
  const folder = 'lakeside-barn-residence/', sheets = buildDrawingSet(html, fixture).sheets;
  assert.equal(JSON.stringify(Object.keys(zip)), JSON.stringify([
    'architecture-studio.json', 'exports/kept.html', 'index.html', 'models/building.json', 'sources/site photo.png', 'reviews/approvals.json',
    ...sheets.map(sheet => sheet.path), 'exports/manifest.json'
  ].map(name => folder + name)), 'a sheet for a removed level is dropped, as export-drawings.mjs would');
  assert.equal(text(zip[`${folder}index.html`]), files['./index.html?raw=1']);
  assert.deepEqual([...zip[`${folder}sources/site photo.png`]], [...imageBytes], 'images keep their bytes');
  assert.deepEqual(JSON.parse(text(zip[`${folder}models/building.json`])), fixture);
  assert.deepEqual(JSON.parse(text(zip[`${folder}exports/manifest.json`])).artifacts, [{ path: 'models/building.json' }]);
  const approvals = JSON.parse(text(zip[`${folder}reviews/approvals.json`]));
  assert.equal(approvals.projectId, fixture.project.id);
  assert.deepEqual(approvals.approvals.map(item => item.entityId), ['opening-entry']);
});

test('exports/ drawn in the browser matches export-drawings.mjs byte for byte', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-studio-drawings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of ['models/building.json', 'HANDOFF.md']) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), 'x');
  }
  const { sheets, manifest } = buildDrawingSet(html, fixture, dir);
  const { api } = loadStudio();
  const browser = api.drawingSetExport(fixture, name => ['models/building.json', 'HANDOFF.md'].includes(name));
  assert.equal(JSON.stringify(browser.map(file => file.name)), JSON.stringify([...sheets.map(sheet => sheet.path), 'exports/manifest.json']));
  sheets.forEach((sheet, i) => assert.equal(browser[i].text, `<?xml version="1.0" encoding="UTF-8"?>\n${sheet.svg}\n`, sheet.path));
  assert.equal(browser.at(-1).text, `${JSON.stringify(manifest, null, 2)}\n`);
});

test('the viewer carries the skill version that Export project writes to architecture-studio.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(skillRoot, 'package.json'), 'utf8'));
  assert.match(html, new RegExp(`<meta name="architecture-studio-version" content="${pkg.version.replace(/\./g, '\\.')}">`));
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  assert.match(skill, new RegExp(`^  version: "${pkg.version.replace(/\./g, '\\.')}"$`, 'm'), 'SKILL.md metadata matches package.json');
});

test('Export project always carries the launcher, executable on macOS', async () => {
  const { api } = loadStudio();
  const launchers = api.projectLaunchers(html);
  assert.equal(JSON.stringify(launchers.map(file => file.name)), JSON.stringify(['open-studio.mjs', 'Open Studio.cmd', 'Open Studio.command']));

  const fromPage = await api.projectExportFiles({ listed: null, model: fixture, page: '<!doctype html>', launchers });
  const command = fromPage.files.find(file => file.name === 'Open Studio.command');
  assert.equal(command.mode, 0o755);
  assert.equal(text(fromPage.files.find(file => file.name === 'Open Studio.cmd').bytes), launchers[1].text);

  // A served project keeps its own launcher copy; one made before the launcher existed gets the page's.
  const served = await api.projectExportFiles({
    listed: ['index.html', 'open-studio.mjs'], model: fixture, launchers,
    fetchImpl: async url => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(url === './open-studio.mjs' ? '// project copy' : 'page').buffer })
  });
  assert.equal(text(served.files.find(file => file.name === 'open-studio.mjs').bytes), '// project copy');
  assert.ok(served.files.some(file => file.name === 'Open Studio.cmd') && served.files.some(file => file.name === 'Open Studio.command' && file.mode === 0o755));

  const zip = api.zipFiles([{ name: 'p/Open Studio.command', bytes: command.bytes, mode: 0o755 }, { name: 'p/index.html', bytes: new Uint8Array([60]) }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const central = view.getUint32(zip.byteLength - 22 + 16, true);
  assert.equal(view.getUint16(central + 4, true), 0x0314, 'made on Unix, so the mode is honored');
  assert.equal(view.getUint32(central + 38, true) >>> 16, 0o100755);
  const second = central + 46 + view.getUint16(central + 28, true);
  assert.equal(view.getUint16(second + 4, true), 20, 'other entries are unchanged');
  assert.equal(view.getUint32(second + 38, true), 0);
});

test('a project page opened from disk says to use Open Studio instead of failing to fetch', async () => {
  const { api, element } = startHarness({ files: {}, protocol: 'file:' });
  await api.start();
  assert.equal(api.state.blocked.title, 'Open this project with Open Studio');
  assert.match(element('#stage-status').innerHTML, /double-click Open Studio\.cmd \(Windows\) or Open Studio\.command \(macOS\)/);
  assert.doesNotMatch(element('#inspector').innerHTML, /Failed to fetch|Model request failed/);

  const served = startHarness({ files: {} });
  await served.api.start();
  assert.equal(served.api.state.blocked.title, 'Model unavailable', 'a served page with no model keeps the model message');
});

test('Share asks where to save, and saves nothing when the dialog is cancelled', async () => {
  const written = [], asked = [];
  let answer = 'save', fetchedWhenAsked = null;
  const { api, element, blobs, fetched } = startHarness({
    files: { '/__architecture-studio/project-files': JSON.stringify({ files: ['models/building.json'] }), './models/building.json': JSON.stringify(fixture) },
    picker: async options => {
      asked.push(options);
      fetchedWhenAsked ??= fetched.length;
      if (answer === 'cancel') throw Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
      if (answer === 'blocked') throw Object.assign(new Error('Must be handling a user gesture.'), { name: 'SecurityError' });
      return { name: 'Barn backup.zip', createWritable: async () => ({ write: async blob => written.push(blob), close: async () => {} }) };
    }
  });
  await api.start();
  const settled = () => waitFor(() => /^Saved|Could not/.test(element('#download-status').textContent));

  const startFetches = fetched.length;
  element('#export-project').dispatch('click');
  await settled();
  assert.equal(asked[0].suggestedName, 'lakeside-barn-residence-project.zip');
  assert.deepEqual(Object.keys(asked[0].types[0].accept), ['application/zip']);
  assert.equal(fetchedWhenAsked, startFetches, 'the dialog opens before any packaging, while the click still counts as a gesture');
  assert.equal(element('#download-status').textContent, 'Saved Barn backup.zip.', 'the browser does not reveal the chosen folder');
  assert.equal(Object.keys(readZip(new Uint8Array(await written[0].arrayBuffer())))[0], 'lakeside-barn-residence/models/building.json');
  assert.equal(blobs.length, 0, 'nothing went to the downloads folder');

  element('#download-status').textContent = '';
  element('#download-set').dispatch('click');
  await settled();
  assert.equal(asked[1].suggestedName, 'lakeside-barn-residence-drawings.zip');
  assert.equal(element('#download-status').textContent, 'Saved Barn backup.zip.');

  answer = 'cancel';
  element('#download-status').textContent = 'an older message';
  element('#export-project').dispatch('click');
  await waitFor(() => element('#download-status').textContent === '');
  element('#download-set').dispatch('click');
  await waitFor(() => asked.length === 4);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('#download-status').textContent, '', 'a cancelled save says nothing');
  assert.equal(written.length, 2);
  assert.equal(blobs.length, 0, 'a cancelled save does not download instead');

  answer = 'blocked';
  element('#download-set').dispatch('click');
  await settled();
  assert.match(element('#download-status').textContent, /to your browser's downloads folder\.$/, 'when the dialog cannot open, the browser downloads as usual');
  assert.equal(blobs.length, 1);
});

test('a save confirmation clears itself after a few seconds; a problem stays', async () => {
  const picker = async () => ({ name: 'barn.zip', createWritable: async () => ({ write: async () => {}, close: async () => {} }) });
  const { api, element, timers } = startHarness({
    files: { '/__architecture-studio/project-files': JSON.stringify({ files: ['models/building.json', 'brief.json'] }), './models/building.json': JSON.stringify(fixture) },
    picker
  });
  await api.start();
  const status = element('#download-status'), clears = () => timers.filter(timer => timer.ms === 4000);

  element('#download-set').dispatch('click');
  await waitFor(() => status.textContent === 'Saved barn.zip.');
  element('#download-set').dispatch('click');
  await waitFor(() => clears().length === 2);
  clears()[0].fn();
  assert.equal(status.textContent, 'Saved barn.zip.', "the first save's timer does not cut the second confirmation short");
  clears()[1].fn();
  assert.equal(status.textContent, '', 'the confirmation clears after 4 seconds');

  element('#export-project').dispatch('click');
  await waitFor(() => /could not be read/.test(status.textContent));
  assert.equal(status.textContent, 'Saved barn.zip. 1 file could not be read.');
  assert.equal(clears().length, 2, 'a save with missing files is not cleared automatically');
});

test('away from serve.mjs, Export project rebuilds a reopenable project from the page', async () => {
  const findings = { schemaVersion: '1.0.0', projectId: fixture.project.id, status: 'unavailable', coverage: {}, findings: [] };
  const files = { './models/building.json': JSON.stringify(fixture), './reviews/code-findings.json': JSON.stringify(findings) };
  // A page opened from disk with its data embedded, as the preview and bundles are.
  const pageHtml = '<html lang="en"><head><meta name="architecture-studio-version" content="9.8.7"></head><body><main>viewer</main>'
    + `<script type="application/json" id="embedded-model">${JSON.stringify(fixture).replace(/</g, '\\u003c')}</script>`
    + `<script type="application/json" id="embedded-code-findings">${JSON.stringify(findings)}</script><script>/* renderer */</script></body></html>`;
  const { api, element, blobs, fetched } = startHarness({ files, protocol: 'file:', pageHtml });
  element('meta[name="architecture-studio-version"]').content = '9.8.7';
  await api.start();
  api.state.approvals = { 'opening-entry': { approvedAt: '2026-10-01T00:00:00.000Z' }, 'not-in-the-model': { approvedAt: '2026-10-01T00:00:00.000Z' } };
  element('#export-project').dispatch('click');
  await waitFor(() => /^Saved|Could not/.test(element('#download-status').textContent));

  assert.ok(!fetched.includes('/__architecture-studio/project-files'), 'a file page cannot list the folder');
  assert.equal(element('#download-status').textContent, "Saved lakeside-barn-residence-project.zip to your browser's downloads folder.");
  const zip = readZip(new Uint8Array(await blobs.at(-1).arrayBuffer())), at = name => zip[`lakeside-barn-residence/${name}`];
  const sheets = buildDrawingSet(html, fixture).sheets;
  assert.equal(JSON.stringify(Object.keys(zip)), JSON.stringify([
    'architecture-studio.json', 'index.html', 'models/building.json', 'reviews/code-findings.json', 'reviews/approvals.json', ...sheets.map(sheet => sheet.path), 'exports/manifest.json'
  ].map(name => `lakeside-barn-residence/${name}`)));
  assert.equal(text(at('architecture-studio.json')), '{\n  "tool": "architecture-studio",\n  "skillVersion": "9.8.7"\n}\n', 'the marker init.mjs writes, with the viewer version');
  assert.equal(text(at('index.html')), '<!doctype html>\n<html lang="en"><head><meta name="architecture-studio-version" content="9.8.7"></head><body><main>viewer</main>'
    + '<script type="application/json" id="embedded-model"></script><script type="application/json" id="embedded-code-findings"></script><script>/* renderer */</script></body></html>\n',
  'the viewer without its embedded data, so it reads models/ and reviews/ like any project');
  assert.equal(text(at('models/building.json')), `${JSON.stringify(fixture, null, 2)}\n`);
  assert.deepEqual(JSON.parse(text(at('reviews/code-findings.json'))), findings);
  assert.deepEqual(JSON.parse(text(at('reviews/approvals.json'))).approvals.map(item => item.entityId), ['opening-entry'], 'approvals for missing elements are dropped');
  assert.equal(text(at(sheets[0].path)), `<?xml version="1.0" encoding="UTF-8"?>\n${sheets[0].svg}\n`);
  assert.deepEqual(JSON.parse(text(at('exports/manifest.json'))).artifacts, [{ path: 'models/building.json' }, { path: 'reviews/code-findings.json' }]);
});

test('Export project falls back when the server cannot list files, and keeps archive names safe', async () => {
  const { api } = loadStudio();
  const http = { protocol: 'http:' };
  assert.equal(await api.fetchProjectFileList(async () => ({ ok: false, status: 404 }), http), null, 'a plain static server');
  assert.equal(await api.fetchProjectFileList(async () => ({ ok: true, json: async () => ({ files: [1] }) }), http), null);
  assert.equal(await api.fetchProjectFileList(async () => { throw new Error('offline'); }, http), null);
  assert.deepEqual(await api.fetchProjectFileList(async () => ({ ok: true, json: async () => ({ files: ['index.html'] }) }), http), ['index.html']);
  assert.equal(await api.fetchProjectFileList(async () => { throw new Error('not called'); }, { protocol: 'file:' }), null);
  assert.equal(api.archiveFolder('../client/house 2'), 'client-house-2');
  assert.equal(api.archiveFolder(undefined), 'architecture-studio-project');

  const empty = await api.projectExportFiles({ listed: null, model: null, approvals: { x: {} } });
  assert.equal(empty.files.length, 0, 'nothing to export without a model or a server');
});

test('Share opens a keyboard menu with Export project and Download drawings', async () => {
  // A static page with no exports/ folder, like the preview: Download drawings still has every sheet.
  const { api, element, doc, blobs, fetched } = startHarness({ files: { './models/building.json': JSON.stringify(fixture) }, protocol: 'file:' });
  const share = element('#share-button'), menu = Object.assign(element('#share-menu'), { hidden: true });
  const exportItem = element('#export-project'), download = element('#download-set');
  for (const item of [share, exportItem, download]) item.parent = element('.share');
  await api.start();
  api.state.approvals = { 'opening-entry': { approvedAt: '2026-10-01' } };

  share.dispatch('click');
  assert.equal(menu.hidden, false);
  assert.equal(share.attributes['aria-expanded'], 'true');
  assert.equal(doc.activeElement, exportItem, 'opening lands on the first item');
  assert.equal(download.hidden, false);
  menu.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(doc.activeElement, download);
  menu.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(doc.activeElement, exportItem, 'the arrows wrap');
  menu.dispatch('keydown', { key: 'End' });
  assert.equal(doc.activeElement, download);
  menu.dispatch('keydown', { key: 'Home' });
  assert.equal(doc.activeElement, exportItem);
  menu.dispatch('keydown', { key: 'Escape' });
  assert.equal(menu.hidden, true);
  assert.equal(share.attributes['aria-expanded'], 'false');
  assert.equal(doc.activeElement, share, 'Escape returns focus to Share');

  share.dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(doc.activeElement, download, 'ArrowUp opens on the last item');
  for (const fn of doc.listeners.pointerdown) fn({ target: exportItem });
  assert.equal(menu.hidden, false, 'a press inside the menu keeps it open');
  for (const fn of doc.listeners.pointerdown) fn({ target: element('#sheet-viewport') });
  assert.equal(menu.hidden, true, 'a press elsewhere closes it');
  share.dispatch('click');
  menu.dispatch('keydown', { key: 'Tab' });
  assert.equal(menu.hidden, true, 'Tab leaves the menu');
  share.dispatch('click');
  share.dispatch('click');
  assert.equal(menu.hidden, true, 'Share toggles');

  share.dispatch('click');
  const before = fetched.length;
  download.dispatch('click');
  assert.equal(menu.hidden, true, 'choosing closes the menu first');
  assert.equal(doc.activeElement, share);
  const sheets = buildDrawingSet(html, fixture).sheets;
  await waitFor(() => /^Saved|Could not/.test(element('#download-status').textContent));
  assert.equal(element('#download-status').textContent, "Saved lakeside-barn-residence-drawings.zip to your browser's downloads folder.");
  assert.equal(fetched.length, before, 'the sheets are drawn from the model, not read from exports/');
  const zip = readZip(new Uint8Array(await blobs.at(-1).arrayBuffer()));
  assert.equal(JSON.stringify(Object.keys(zip)), JSON.stringify(sheets.map(sheet => sheet.path.replace('exports/', 'lakeside-barn-residence-drawings/'))), 'only drawing sheets: no manifest, approvals, model, or handoff notes');
  for (const sheet of sheets) assert.equal(text(zip[sheet.path.replace('exports/', 'lakeside-barn-residence-drawings/')]), `<?xml version="1.0" encoding="UTF-8"?>\n${sheet.svg}\n`, `${sheet.path} matches export-drawings.mjs`);
});

test('Download drawings keeps sheet names inside its folder', () => {
  const { api } = loadStudio();
  const model = cloneFixture();
  model.project.id = '../escape';
  model.sections[0].id = '../../section aa';
  const names = api.drawingFiles(model).map(file => file.name);
  assert.ok(names.every(name => name.startsWith('escape-drawings/') && !name.includes('..') && name.split('/').length === 3), names.join(', '));
  assert.ok(names.includes('escape-drawings/sections/section-aa.svg'));
});

test('with the model blocked, Share offers only Export project', async () => {
  const { api, element, doc } = startHarness({ files: {} });
  const menu = Object.assign(element('#share-menu'), { hidden: true });
  await api.start();
  assert.equal(api.state.blocked.title, 'Model unavailable');
  element('#share-button').dispatch('click');
  assert.equal(menu.hidden, false);
  assert.equal(element('#download-set').hidden, true);
  assert.equal(doc.activeElement, element('#export-project'));
  element('#share-menu').dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(doc.activeElement, element('#export-project'), 'only one item to move between');
});

test('without a valid model the Sources view still calibrates', async () => {
  const { api, element, tabs, tools, clipboard, settle } = startHarness({ files: { './sources/sources.json': sourcesJson(), './sources/survey-plat.png': imageBytes }, search: '?view=sources' });
  await api.start();
  await settle();
  assert.equal(api.state.blocked.title, 'Model unavailable');
  assert.equal(api.state.view, 'sources');
  assert.equal(element('#tab-sources').hidden, false);
  assert.match(element('#sheet-stage').innerHTML, /<img class="source-image" src="blob:source" width="400" height="300"/);
  assert.ok(element('#stage-status').classList.contains('hidden-view'));
  assert.match(element('#inspector').innerHTML, /survey-plat/);
  assert.doesNotMatch(element('#inspector').innerHTML, /Not verified|Stale/, 'the file hash and size match');

  // Fit puts the 400 x 300 image in an 800 x 600 viewport at zoom 1.92, offset (16, 12).
  const click = (x, y) => {
    const at = { clientX: 16 + x * 1.92, clientY: 12 + y * 1.92, pointerId: 1 };
    element('#sheet-viewport').dispatch('pointerdown', at);
    element('#sheet-viewport').dispatch('pointerup', at);
  };
  tools[0].dispatch('click');
  assert.equal(api.state.tool, 'line');
  click(10, 20);
  click(390, 20);
  Object.assign(element('#cal-distance'), { value: '3810' }).dispatch('input');
  assert.match(element('#cal-distance-note').textContent, /Add a unit/);
  assert.equal(element('#copy-calibration').disabled, true);
  Object.assign(element('#cal-distance'), { value: `12'-6"` }).dispatch('input');
  assert.equal(element('#copy-calibration').disabled, false);
  element('#copy-calibration').dispatch('click');
  await settle();
  const payload = JSON.parse(clipboard.at(-1).slice(clipboard.at(-1).indexOf('{')));
  assert.deepEqual(payload.calibration, { from: { x: 10, y: 20 }, to: { x: 390, y: 20 }, distanceMm: 3810, entered: `12'-6"`, uncertaintyPx: 0.5 });

  tabs.find(tab => tab.dataset.view === 'plan').dispatch('click');
  assert.match(element('#stage-status').innerHTML, /Model unavailable/);
  assert.match(element('#inspector').innerHTML, /Model unavailable/);
  assert.equal(element('#stage-status').classList.contains('hidden-view'), false);
});

test('the Area tool outlines, closes, and copies a labelled area', async () => {
  const files = { './sources/sources.json': sourcesJson({ calibrations: [cal('cal-1', 'scale-bar', 10, 0.01)] }), './sources/survey-plat.png': imageBytes };
  const { api, element, tools, clipboard, settle } = startHarness({ files, search: '?view=sources' });
  await api.start();
  await settle();
  const viewport = element('#sheet-viewport');
  const click = (x, y) => {
    const at = { clientX: 16 + x * 1.92, clientY: 12 + y * 1.92, pointerId: 1 };
    viewport.dispatch('pointerdown', at);
    viewport.dispatch('pointerup', at);
  };
  const area = tools.find(tool => tool.dataset.tool === 'area');
  area.dispatch('click');
  assert.equal(api.state.tool, 'area');
  assert.equal(area.attributes['aria-pressed'], 'true');

  click(10, 10);
  viewport.dispatch('keydown', { key: 'Escape' });
  assert.equal(api.state.draft.areaPoints.length, 0, 'Escape cancels the area in progress');
  assert.equal(api.state.tool, 'area');

  click(50, 50); click(350, 50); click(200, 200);
  viewport.dispatch('keydown', { key: 'Backspace' });
  assert.deepEqual(plain(api.state.draft.areaPoints), [{ x: 50, y: 50 }, { x: 350, y: 50 }], 'Backspace removes the last point');
  click(350, 250); click(50, 250);
  assert.match(element('#inspector').innerHTML, /id="cal-area-finish">Finish area/);
  assert.match(element('.source-overlay@child').innerHTML, /<polyline class="ov-draft"|<polygon class="ov-draft"/);
  click(50.5, 50.5);
  assert.equal(api.state.draft.areaPoints.length, 0, 'clicking the first point closes the area');
  assert.equal(api.state.draft.areas.length, 1);
  // 300 x 200 px at the 10 mm/px scale bar.
  assert.equal(element('#cal-area-0-size').textContent, `64.6 sq ft ± 1.3 sq ft, perimeter 32'-9 3/4", estimated`);
  assert.equal(api.state.draft.areas[0].label, 'Area 1', 'a closed area takes the next free default label');
  assert.match(element('#inspector').innerHTML, /<input id="cal-area-0" data-area-index="0" type="text" autocomplete="off" value="Area 1"[^>]*><\/td><td class="marks-where">4 corners<span class="marks-new">New<\/span><\/td>/);
  assert.equal(element('#cal-problem').textContent, '');
  assert.equal(element('#copy-calibration').disabled, false);

  // A cleared label is flagged on its input and under the table, as well as by the button.
  const refresh = () => element('#cal-distance').dispatch('input');
  api.state.draft.areas[0].label = ' ';
  refresh();
  assert.equal(element('#cal-problem').textContent, 'Label every area.');
  assert.equal(element('#marks-problem').textContent, 'Label every area.');
  assert.equal(element('#cal-area-0').attributes['aria-invalid'], 'true');
  assert.equal(element('#cal-area-0').attributes['aria-describedby'], 'cal-area-0-size marks-problem');
  assert.equal(element('#copy-calibration').disabled, true);

  api.state.draft.areas[0].label = ' Garden bed ';
  refresh();
  assert.equal(element('#marks-problem').textContent, '');
  assert.equal(element('#cal-area-0').attributes['aria-invalid'], 'false');
  assert.equal(element('#cal-area-0').attributes['aria-describedby'], 'cal-area-0-size');
  element('#copy-calibration').dispatch('click');
  await settle();
  const payload = JSON.parse(clipboard.at(-1).slice(clipboard.at(-1).indexOf('{')));
  assert.equal(payload.calibration, undefined);
  assert.deepEqual(payload.areas, [{ label: 'Garden bed', points: [{ x: 50, y: 50 }, { x: 350, y: 50 }, { x: 350, y: 250 }, { x: 50, y: 250 }] }]);

  // An outline of 2 corners blocks copying; from 3 corners Copy closes it under its default label.
  click(100, 100); click(300, 100);
  assert.equal(element('#marks-problem').textContent, 'Finish or cancel the area you are outlining.');
  assert.equal(element('#copy-calibration').disabled, true);
  click(200, 200);
  assert.equal(element('#marks-problem').textContent, '');
  assert.equal(element('#copy-calibration').disabled, false);
  element('#copy-calibration').dispatch('click');
  await settle();
  assert.equal(api.state.draft.areaPoints.length, 0);
  assert.deepEqual(plain(api.state.draft.areas.map(item => item.label.trim())), ['Garden bed', 'Area 1']);
  assert.deepEqual(JSON.parse(clipboard.at(-1).slice(clipboard.at(-1).indexOf('{'))).areas.map(item => item.label), ['Garden bed', 'Area 1']);
});

test('an image has one scale: no scale region tool, and a disagreement suggests cropping', async () => {
  assert.deepEqual([...html.matchAll(/data-tool="([a-z]+)"/g)].map(([, tool]) => tool), ['line', 'point', 'area']);
  assert.doesNotMatch(html, /Scale region|Whole image/);
  const files = { './sources/sources.json': sourcesJson({ calibrations: [cal('cal-1', 'printed-dimension', 10, 0.01), cal('cal-2', 'scale-bar', 2, 0.01)] }), './sources/survey-plat.png': imageBytes };
  const { api, element, settle } = startHarness({ files, search: '?view=sources' });
  await api.start();
  await settle();
  const inspector = element('#inspector').innerHTML;
  assert.match(inspector, /<h4 class="entity-subhead">Scale<\/h4><p class="entity-context">10 mm\/px ± 1%, printed dimension, estimated <b>\(disagree\)<\/b><\/p>/);
  assert.match(inspector, /Calibrations disagree<\/b>: resolve them, or crop each part of a mixed-scale sheet into its own image/);
  assert.match(inspector, /If the sheet mixes scales, such as an enlarged detail or a location map, crop each part into its own image and import it separately\./);
  assert.match(api.state.sourceFindings.map(item => item.message).join('\n'), /crop each part into its own image and import it separately/);
});

test('start keeps the old blocked page when there are no sources, and flags stale files', async () => {
  const blocked = startHarness({ files: {} });
  await blocked.api.start();
  assert.equal(blocked.element('#tab-sources').hidden, true);
  assert.match(blocked.element('#stage-status').innerHTML, /Model unavailable/);
  assert.equal(blocked.tabs[0].listeners.click, undefined, 'no tabs are wired');

  const invalid = cloneFixture();
  invalid.openings[0].widthMm = -100;
  const errors = startHarness({ files: { './models/building.json': JSON.stringify(invalid), './sources/sources.json': sourcesJson({ contentHash: HASH }), './sources/survey-plat.png': imageBytes }, search: '?view=sources' });
  await errors.api.start();
  await errors.settle();
  assert.equal(errors.api.state.blocked.title, 'Resolve model errors');
  assert.match(errors.element('#inspector').innerHTML, /Stale<\/b>: re-import with add --replace/);
  assert.match(errors.element('#inspector').innerHTML, /Calibration is off/);
  assert.equal(errors.tools[0].disabled, true);

  const malformed = startHarness({ files: { './sources/sources.json': '{"schemaVersion":"1.0.0"' }, search: '?view=sources' });
  await malformed.api.start();
  assert.equal(malformed.api.state.view, 'sources');
  assert.match(malformed.element('#stage-status').innerHTML, /not valid JSON/);
});

test('the viewer draws current placements under the plan and honours ?underlay=0', async () => {
  const placement = (extra = {}) => ({ placement: { view: 'level-ground', pairs: [{ pixel: { x: 0, y: 0 }, model: { x: 0, y: 0 } }], usesNorth: true, mmPerPx: 30, rotationDeg: 0, transform: placementTransform(30, 0, -1000, 9000), residualsMm: [0], calibrationRevision: 3, sourceRevision: 2, createdAt: '2026-10-01T00:00:00Z', ...extra } });
  const files = sources => ({ './models/building.json': JSON.stringify(fixture), './sources/sources.json': sources, './sources/survey-plat.png': imageBytes });
  const shown = startHarness({ files: files(sourcesJson(placement())), search: '?view=plan&level=level-ground' });
  await shown.api.start();
  await shown.settle();
  assert.match(shown.element('#sheet-stage').innerHTML, /<g data-layer="underlay"[^>]*>[\s\S]*href="blob:source"/);
  assert.equal(shown.element('#underlay-controls').classList.contains('hidden-view'), false);
  shown.element('#underlay-toggle').dispatch('click');
  assert.doesNotMatch(shown.element('#sheet-stage').innerHTML, /data-layer="underlay"/);
  assert.equal(shown.element('#underlay-toggle').attributes['aria-pressed'], 'false');

  const hidden = startHarness({ files: files(sourcesJson(placement())), search: '?view=plan&underlay=0' });
  await hidden.api.start();
  await hidden.settle();
  assert.doesNotMatch(hidden.element('#sheet-stage').innerHTML, /data-layer="underlay"/);

  const stale = startHarness({ files: files(sourcesJson(placement({ calibrationRevision: 2 }))), search: '?view=plan' });
  await stale.api.start();
  await stale.settle();
  assert.doesNotMatch(stale.element('#sheet-stage').innerHTML, /data-layer="underlay"/);
  assert.equal(stale.element('#underlay-controls').classList.contains('hidden-view'), true);
  assert.match(stale.element('#inspector').innerHTML, /Source image[\s\S]*placement predates/);
});

// ---------------------------------------------------------------- writing through scripts/serve.mjs

const tick = () => new Promise(resolve => setImmediate(resolve));
const FLASH_KEY = 'architecture-studio:sources-flash';
const sourceFiles = (extra = {}) => ({ './models/building.json': JSON.stringify(fixture), './sources/sources.json': sourcesJson(), './sources/survey-plat.png': imageBytes, ...extra });
// Marks a 380 px scale line on the 400 x 300 test image and types its length.
function markLine({ element, tools }) {
  const click = (x, y) => {
    const at = { clientX: 16 + x * 1.92, clientY: 12 + y * 1.92, pointerId: 1 };
    element('#sheet-viewport').dispatch('pointerdown', at);
    element('#sheet-viewport').dispatch('pointerup', at);
  };
  tools[0].dispatch('click');
  click(10, 20);
  click(390, 20);
  Object.assign(element('#cal-distance'), { value: `12'-6"` }).dispatch('input');
}

test('the page writes only when serve.mjs served it with a token over http', () => {
  const { api } = loadStudio();
  const doc = content => ({ querySelector: selector => (selector === 'meta[name="architecture-studio-write"]' && content !== null ? { content } : null) });
  assert.equal(api.sourcesWritable(doc('t0k3n'), { protocol: 'http:' }), true);
  assert.equal(api.sourcesWritable(doc('t0k3n'), { protocol: 'https:' }), true);
  assert.equal(api.sourcesWritable(doc('t0k3n'), { protocol: 'file:' }), false, 'a saved copy opened from disk');
  assert.equal(api.sourcesWritable(doc(''), { protocol: 'http:' }), false);
  assert.equal(api.sourcesWritable(doc(null), { protocol: 'http:' }), false, 'a bundle, the preview, or a plain static server');
  assert.doesNotMatch(html, /<meta name="architecture-studio-write"/, 'the template never carries a token');
  assert.doesNotMatch(expectedPreview(), /<meta name="architecture-studio-write"/);

  assert.equal(api.uploadFileProblem({ name: 'plat.png', type: 'image/png' }), '');
  assert.equal(api.uploadFileProblem({ name: 'IMG_1001.JPG', type: '' }), '', 'a missing type falls back to the extension');
  assert.equal(api.uploadFileProblem({ name: 'plat.pdf', type: 'application/pdf' }), 'plat.pdf is not a PNG, JPEG, or WebP image. Export a PDF, HEIC, or TIFF as PNG or JPEG first, then add that file.');
  assert.match(api.uploadFileProblem({ name: 'IMG_1002.HEIC', type: 'image/heic' }), /is not a PNG, JPEG, or WebP image/);
  assert.equal(api.formatBytes(2_400_000), '2.3 MB');
  assert.equal(api.formatBytes(51_200), '50 KB');
});

test('the saved payload is the object inside the copied text', () => {
  const { api } = loadStudio();
  const source = testSource();
  const input = {
    calibration: { from: { x: 100.04, y: 200.06 }, to: { x: 3100.16, y: 200 }, distanceMm: 3810, entered: ` 12'-6" `, uncertaintyPx: 0.3 },
    references: [{ label: 'NE house corner', pixel: { x: 12.34, y: 6.78 } }],
    areas: [{ label: 'Bed', points: [{ x: 1, y: 1 }, { x: 50, y: 1 }, { x: 50, y: 40 }] }]
  };
  const text = api.calibrationPayload(source, input);
  assert.deepEqual(plain(api.calibrationPayloadObject(source, input)), JSON.parse(text.slice(text.indexOf('{'))));
  assert.throws(() => api.calibrationPayloadObject(source, {}), /a scale line, a labelled reference point, or a labelled area/);
});

test('with a write token the Sources tab shows before any image, as the uploader', async () => {
  const model = JSON.stringify(fixture);
  const plainPage = startHarness({ files: { './models/building.json': model }, search: '?view=sources' });
  await plainPage.api.start();
  assert.equal(plainPage.element('#tab-sources').hidden, true);
  assert.equal(plainPage.api.state.view, 'plan');
  assert.equal(plainPage.element('#add-image').classList.contains('hidden-view'), true);

  const served = startHarness({ files: { './models/building.json': model }, token: 'abc', search: '?view=sources' });
  await served.api.start();
  assert.equal(served.api.state.writable, true);
  assert.equal(served.element('#tab-sources').hidden, false);
  assert.equal(served.api.state.view, 'sources');
  const inspector = served.element('#inspector').innerHTML;
  assert.match(inspector, /<h2 id="upload-title">Source images<\/h2><p>Add a survey, plan, aerial view, or photo\./);
  assert.match(inspector, /<button type="button" class="drop-zone" id="upload-drop"[^>]*><b>Drop an image here<\/b>/);
  assert.match(inspector, /<input type="file" id="upload-file" accept="image\/png,image\/jpeg,image\/webp" hidden>/);
  assert.match(inspector, /<select id="upload-kind" required aria-required="true"><option value="">Choose a type<\/option><option value="satellite">Satellite<\/option>[\s\S]*<option value="other">Other<\/option><\/select>/);
  assert.doesNotMatch(inspector, /id="upload-cancel"/, 'the first image has nothing to cancel back to');
  assert.match(served.element('#stage-status').innerHTML, /No source images<\/strong><span>Drop an image here, or choose Add image in the toolbar\./);
  assert.equal(served.element('#add-image').classList.contains('hidden-view'), false);
  assert.equal(served.element('#source-control').classList.contains('hidden-view'), true, 'no empty Image select');

  const noModel = startHarness({ files: {}, token: 'abc' });
  await noModel.api.start();
  assert.equal(noModel.element('#tab-sources').hidden, false, 'images can be added before the model exists');
  assert.ok(noModel.tabs[0].listeners.click, 'the tabs are wired');

  const fromDisk = startHarness({ files: {}, token: 'abc', protocol: 'file:' });
  await fromDisk.api.start();
  assert.equal(fromDisk.element('#tab-sources').hidden, true);
});

test('Add image shows only on the Sources view of a writable page', async () => {
  const served = startHarness({ files: sourceFiles(), token: 'abc', search: '?view=plan' });
  await served.api.start();
  await served.settle();
  assert.equal(served.element('#add-image').classList.contains('hidden-view'), true);
  served.tabs.find(tab => tab.dataset.view === 'sources').dispatch('click');
  assert.equal(served.element('#add-image').classList.contains('hidden-view'), false);
  assert.equal(served.element('#add-image').attributes['aria-expanded'], 'false');
  assert.match(html, /<button type="button" class="tool add-image hidden-view" id="add-image" aria-controls="inspector" aria-expanded="false"><svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"/);
  assert.ok(html.indexOf('id="add-image"') > html.indexOf('id="source-control"') && html.indexOf('id="add-image"') < html.indexOf('id="level-control"'), 'right after the Image select');

  const plainPage = startHarness({ files: sourceFiles(), search: '?view=sources' });
  await plainPage.api.start();
  await plainPage.settle();
  assert.equal(plainPage.api.state.view, 'sources');
  assert.equal(plainPage.element('#add-image').classList.contains('hidden-view'), true);
  const transfer = { types: ['Files'], files: [{ name: 'plan.png', type: 'image/png', size: 10 }] };
  plainPage.element('.canvas-wrap').dispatch('drop', { dataTransfer: transfer });
  assert.equal(plainPage.api.state.upload, null, 'a page that cannot write ignores dropped files');
});

test('served by serve.mjs, step 3 saves the calibration instead of copying it', async () => {
  const notes = ['Note: cal-1 (manual, 10 mm/px) overrides the scale-bar estimate (cal-0, 9 mm/px), a 11% difference.'];
  let reply = [200, { ok: true, source: { id: 'survey-plat', kind: 'survey', path: 'sources/survey-plat.png', pixels: { width: 400, height: 300 }, revision: 2, calibrationRevision: 4 }, messages: ['Added cal-4 (manual).'], warnings: notes }];
  const h = startHarness({ files: sourceFiles(), token: 'abc', search: '?view=sources', post: async () => reply });
  await h.api.start();
  await h.settle();
  const before = h.element('#inspector').innerHTML;
  assert.match(before, /<li><b>Save it for your agent<\/b><p id="cal-copy-help">Saves to sources\/sources\.json\. Your agent reads it from there\.<\/p>/);
  assert.match(before, /<button type="button" class="tool primary" id="save-calibration" aria-describedby="cal-copy-help">Save calibration<\/button><button type="button" class="tool" id="cal-reset">Start over<\/button>/);
  assert.doesNotMatch(before, /Copy calibration|copy-calibration|Copy it for your agent|Paste it to your agent/);

  assert.equal(h.element('#save-calibration').disabled, true);
  markLine(h);
  assert.equal(h.element('#save-calibration').disabled, false);
  h.element('#save-calibration').dispatch('click');
  assert.match(h.element('#inspector').innerHTML, /<p id="cal-saving" class="field-note">Saving\.\.\.<\/p>/);
  assert.equal(h.element('#save-calibration').disabled, true, 'one save at a time');
  assert.equal(h.element('#source-live').textContent, 'Saving...');
  await tick();
  assert.equal(h.posts.length, 1);
  const [sent] = h.posts;
  assert.equal(sent.url, '/__architecture-studio/calibration');
  assert.deepEqual(plain(sent.headers), { 'Content-Type': 'application/json', 'X-Architecture-Studio-Token': 'abc' });
  const body = JSON.parse(sent.body);
  assert.equal(body.type, 'architecture-studio/source-calibration');
  assert.deepEqual(body.calibration, { from: { x: 10, y: 20 }, to: { x: 390, y: 20 }, distanceMm: 3810, entered: `12'-6"`, uncertaintyPx: 0.5 });
  assert.equal(h.clipboard.length, 0, 'nothing is copied');

  assert.match(h.element('#inspector').innerHTML, /Saved\. Reloading\.\.\./);
  assert.equal(h.api.state.draft.from, null, 'the draft is cleared');
  assert.deepEqual(JSON.parse(h.session.get(FLASH_KEY)), { ...JSON.parse(h.session.get(FLASH_KEY)), text: 'Saved.', sourceId: 'survey-plat', warnings: notes });
  assert.equal(h.reloads.length, 0, 'live reload gets the first chance');
  const fallback = h.timers.find(timer => timer.ms === 1500);
  fallback.fn();
  assert.equal(h.reloads.length, 1);

  // After the reload the head says Saved., with the server's notes.
  const after = startHarness({ files: sourceFiles(), token: 'abc', search: '?view=sources&source=survey-plat' });
  after.session.set(FLASH_KEY, h.session.get(FLASH_KEY));
  await after.api.start();
  await after.settle();
  assert.match(after.element('#inspector').innerHTML, /<\/div><div class="src-flash" id="src-flash"><p class="field-note">Saved\.<\/p><p class="field-note field-note--warning">Note: cal-1 \(manual, 10 mm\/px\) overrides/);
  assert.equal(after.element('#source-live').textContent, 'Saved.');
  markLine(after);
  assert.doesNotMatch(after.element('#inspector').innerHTML, /src-flash/, 'marking again clears it');

  // A stale save asks for a reload; another refusal shows the server's message.
  reply = [409, { ok: false, error: 'The pasted calibration is stale.', code: 'stale', id: 'survey-plat' }];
  const stale = startHarness({ files: sourceFiles(), token: 'abc', search: '?view=sources', post: async () => reply });
  await stale.api.start();
  await stale.settle();
  markLine(stale);
  stale.element('#save-calibration').dispatch('click');
  await tick();
  assert.match(stale.element('#inspector').innerHTML, /<div id="cal-save-error"><p class="field-note field-note--error">This image changed since the page loaded\. Reload and mark it again\.<\/p><div class="calibrate-actions"><button type="button" class="tool" id="cal-reload">Reload<\/button>/);
  assert.equal(stale.api.state.draft.to.x, 390, 'the marks stay until the reload');
  stale.element('#cal-reload').dispatch('click');
  assert.ok(stale.reloads.length >= 1);
  reply = [400, { ok: false, error: 'Area "Bed" has no area: its points lie on one line.', code: 'invalid' }];
  stale.element('#save-calibration').dispatch('click');
  await tick();
  assert.match(stale.element('#inspector').innerHTML, /<p id="cal-save-error" class="field-note field-note--error">Area &quot;Bed&quot; has no area: its points lie on one line\.<\/p>/);
  assert.equal(stale.element('#save-calibration').disabled, false);

  // Without a token the copy flow is unchanged.
  const plainPage = startHarness({ files: sourceFiles(), search: '?view=sources' });
  await plainPage.api.start();
  await plainPage.settle();
  assert.match(plainPage.element('#inspector').innerHTML, /<li><b>Copy it for your agent<\/b>[\s\S]*id="copy-calibration"/);
  assert.doesNotMatch(plainPage.element('#inspector').innerHTML, /save-calibration|Save it for your agent/);
});

test('Named features lists the recorded marks first, and saves new, renamed, and removed ones', async () => {
  const bed = [{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 150 }];
  const files = sourceFiles({ './sources/sources.json': sourcesJson({ calibrations: [cal('cal-1', 'scale-bar', 10, 0.01)], references: [{ label: 'Gate', pixel: { x: 5.25, y: 6 } }], areas: [{ label: 'Bed', points: bed }] }) });
  const h = startHarness({ files, token: 'abc', search: '?view=sources', post: async () => [200, { ok: true, source: {}, messages: [], warnings: [] }] });
  await h.api.start();
  await h.settle();
  let inspector = h.element('#inspector').innerHTML;
  assert.match(inspector, /<h4>Named features<\/h4><span aria-label="2 named features">2<\/span>/);
  assert.match(inspector, /<tbody><tr><td><svg[^]*?<\/svg><\/td><td><input id="cal-saved-ref-0" data-saved-ref-index="0" type="text" autocomplete="off" value="Gate" placeholder="Name it" aria-label="Label for reference point at 5\.25, 6"><\/td><td class="marks-where" title="5\.25, 6">5, 6<\/td><td><button type="button" class="marks-x" data-saved-ref-remove="0" aria-label="Remove Gate">&times;<\/button>/);
  assert.match(inspector, /<input id="cal-saved-area-0" data-saved-area-index="0" type="text" autocomplete="off" value="Bed" placeholder="Name it" aria-label="Label for area Bed" aria-describedby="cal-saved-area-0-size"><\/td><td class="marks-where">3 corners<\/td>/);
  assert.match(inspector, /<p id="marks-problem" class="field-note field-note--error"><\/p>/);
  assert.match(h.element('#cal-saved-area-0-size').textContent, /^5\.4 sq ft ± /, 'the recorded area is measured from the current scale');
  assert.equal(h.element('#save-calibration').disabled, true, 'recorded marks alone are nothing to save');

  // A new point takes the next free label and is tagged New, after the recorded marks.
  const click = (x, y) => {
    const at = { clientX: 16 + x * 1.92, clientY: 12 + y * 1.92, pointerId: 1 };
    h.element('#sheet-viewport').dispatch('pointerdown', at);
    h.element('#sheet-viewport').dispatch('pointerup', at);
  };
  const point = h.tools.find(tool => tool.dataset.tool === 'point');
  point.dispatch('click');
  click(200, 100);
  assert.deepEqual(plain(h.api.state.draft.references), [{ label: 'Point 1', pixel: { x: 200, y: 100 }, fresh: true }]);
  inspector = h.element('#inspector').innerHTML;
  assert.match(inspector, /<span aria-label="3 named features">3<\/span>/);
  assert.match(inspector, /value="Bed"[^]*<input id="cal-ref-0" data-ref-index="0" type="text" autocomplete="off" value="Point 1"[^>]*><\/td><td class="marks-where" title="200, 100">200, 100<span class="marks-new">New<\/span>/);
  assert.match(h.element('.source-overlay@child').innerHTML, />Point 1<\/text>/);
  assert.equal(h.element('#save-calibration').disabled, false);

  // Removing a recorded mark strikes it through until Save; Undo keeps it.
  h.api.state.draft.saved.references.Gate = { label: 'Gate', removed: true };
  h.api.state.draft.saved.areas.Bed = { label: 'Garden bed', removed: false };
  point.dispatch('click');
  inspector = h.element('#inspector').innerHTML;
  assert.match(inspector, /<tr class="marks-removed"><td><svg[^]*?<\/svg><\/td><td><span class="marks-gone">Gate<\/span><\/td><td class="marks-where">Removed on save<\/td><td><button type="button" class="marks-undo" data-saved-ref-keep="0" aria-label="Keep Gate">Undo<\/button><\/td><\/tr>/);
  assert.match(inspector, /<span aria-label="2 named features">2<\/span>/);
  assert.doesNotMatch(h.element('.source-overlay@child').innerHTML, />Gate<\/text>/, 'a removed mark is not drawn');
  assert.match(h.element('.source-overlay@child').innerHTML, />Garden bed<\/text>/, 'a renamed mark shows its new label');

  h.element('#save-calibration').dispatch('click');
  await tick();
  const body = JSON.parse(h.posts[0].body);
  assert.deepEqual(body.removeReferences, ['Gate']);
  assert.deepEqual(body.removeAreas, ['Bed']);
  assert.deepEqual(body.references, [{ label: 'Point 1', pixel: { x: 200, y: 100 } }]);
  assert.deepEqual(body.areas, [{ label: 'Garden bed', points: bed }]);
  assert.deepEqual(plain(h.api.state.draft.saved), { references: {}, areas: {} }, 'the edits are cleared once saved');

  // Start over drops the draft marks and the edits to recorded ones.
  const again = startHarness({ files, token: 'abc', search: '?view=sources' });
  await again.api.start();
  await again.settle();
  again.api.state.draft.saved.references.Gate = { label: 'Gate', removed: true };
  again.element('#cal-reset').dispatch('click');
  assert.deepEqual(plain(again.api.state.draft.saved), { references: {}, areas: {} });
  assert.match(again.element('#inspector').innerHTML, /value="Gate"/);
});

test('Add image imports a dropped or chosen file, offers to replace an existing id, and opens the new image', async () => {
  const replies = [];
  const h = startHarness({ files: sourceFiles(), token: 'abc', search: '?view=sources&level=level-ground', post: async () => replies.shift() });
  await h.api.start();
  await h.settle();

  h.element('#add-image').dispatch('click');
  assert.equal(h.element('#add-image').attributes['aria-expanded'], 'true');
  assert.match(h.element('#inspector').innerHTML, /<h2 id="upload-title">Add an image<\/h2>[\s\S]*No image chosen\.[\s\S]*id="upload-cancel">Cancel<\/button>/);
  Object.assign(h.element('#upload-file'), { files: [{ name: 'plat.pdf', type: 'application/pdf', size: 1000 }] }).dispatch('change');
  assert.match(h.element('#inspector').innerHTML, /<p id="upload-problem" class="field-note field-note--error">plat\.pdf is not a PNG, JPEG, or WebP image\. Export a PDF, HEIC, or TIFF as PNG or JPEG first, then add that file\.<\/p>/);
  assert.equal(h.api.state.upload.file, null);
  h.element('#upload-cancel').dispatch('click');
  assert.equal(h.api.state.upload, null);
  assert.equal(h.element('#add-image').attributes['aria-expanded'], 'false');
  assert.match(h.element('#inspector').innerHTML, /<h2>survey-plat<\/h2>/);

  // Dropping an image on the stage opens the form with it.
  const file = { name: 'Site Plan.png', type: 'image/png', size: 2_400_000 };
  const transfer = { types: ['Files'], files: [file], dropEffect: 'none' };
  const wrap = h.element('.canvas-wrap');
  wrap.dispatch('dragover', { dataTransfer: transfer });
  assert.ok(wrap.classList.contains('is-drop-target'));
  assert.equal(transfer.dropEffect, 'copy');
  wrap.dispatch('drop', { dataTransfer: transfer });
  assert.equal(wrap.classList.contains('is-drop-target'), false);
  assert.equal(h.api.state.upload.file, file);
  assert.match(h.element('#inspector').innerHTML, /<p class="upload-file" id="upload-chosen">Site Plan\.png, 2\.3 MB<\/p>/);
  assert.equal(h.element('#upload-submit').disabled, true);
  assert.equal(h.element('#upload-hint').textContent, 'Choose its type.');
  Object.assign(h.element('#upload-kind'), { value: 'site-plan' }).dispatch('change');
  assert.equal(h.element('#upload-submit').disabled, false);
  Object.assign(h.element('#upload-id'), { value: ' Lot plan ' }).dispatch('input');

  replies.push([409, { ok: false, error: 'A source with id "lot-plan" already exists.', code: 'exists', id: 'lot-plan' }]);
  h.element('#upload-form').dispatch('submit');
  assert.match(h.element('#inspector').innerHTML, /<p class="field-note" id="upload-status">Importing\.\.\.<\/p>/);
  assert.equal(h.element('#upload-submit').disabled, true);
  await tick();
  assert.equal(h.posts.length, 1);
  assert.equal(h.posts[0].url, '/__architecture-studio/sources?kind=site-plan&name=Site+Plan.png&id=Lot+plan');
  assert.equal(h.posts[0].body, file);
  assert.deepEqual(plain(h.posts[0].headers), { 'Content-Type': 'image/png', 'X-Architecture-Studio-Token': 'abc' });
  assert.match(h.element('#inspector').innerHTML, /An image named lot-plan already exists\.<\/p><div class="calibrate-actions"><button type="button" class="tool" id="upload-replace">Replace it<\/button>/);

  replies.push([200, { ok: true, source: { id: 'lot-plan', kind: 'site-plan', path: 'sources/lot-plan.png', pixels: { width: 400, height: 300 }, revision: 2, calibrationRevision: 3 }, messages: ['Replaced lot-plan.'], warnings: [] }]);
  h.element('#upload-replace').dispatch('click');
  await tick();
  assert.equal(h.posts.length, 2);
  assert.equal(h.posts[1].url, '/__architecture-studio/sources?kind=site-plan&name=Site+Plan.png&id=Lot+plan&replace=1');
  assert.equal(h.element('#source-live').textContent, 'Imported lot-plan.');
  assert.equal(h.urls.at(-1), '/?view=sources&level=level-ground&source=lot-plan', 'the reload lands on the new image, keeping the other parameters');
  assert.equal(JSON.parse(h.session.get(FLASH_KEY)).text, 'Imported lot-plan.');
  assert.ok(h.timers.some(timer => timer.ms === 1500));

  // A server error shows its message.
  const failing = startHarness({ files: sourceFiles(), token: 'abc', search: '?view=sources', post: async () => [400, { ok: false, error: 'PDF files are not supported: only PNG, JPEG, and WebP images can be imported.', code: 'invalid' }] });
  await failing.api.start();
  await failing.settle();
  failing.element('.canvas-wrap').dispatch('drop', { dataTransfer: { types: ['Files'], files: [{ name: 'scan.png', type: 'image/png', size: 10 }] } });
  Object.assign(failing.element('#upload-kind'), { value: 'survey' }).dispatch('change');
  failing.element('#upload-form').dispatch('submit');
  await tick();
  assert.match(failing.element('#inspector').innerHTML, /<p id="upload-problem" class="field-note field-note--error">PDF files are not supported/);
  assert.equal(failing.element('#upload-submit').disabled, false, 'it can be tried again');
});
test('Structure only leaves plants, fixtures and equipment, and site surfaces out of elevations and sections', () => {
  const { api } = loadStudio();
  const model = structuredClone(siteFixture);
  const surfaceIds = model.surfaces.map(item => item.id), plantingIds = model.plantings.map(item => item.id);
  const has = (svg, ids) => ids.filter(id => svg.includes(`data-entity="${id}"`));
  assert.equal(api.hasNonStructural(model), true);

  const full = api.renderSectionSheet(model, 'section-aa').svg, bare = api.renderSectionSheet(model, 'section-aa', { structureOnly: true }).svg;
  assert.match(full, /data-role="plants"/);
  assert.ok(has(full, surfaceIds).length > 0, 'the full section cuts a site surface');
  assert.doesNotMatch(bare, /data-role="plants"/);
  assert.deepEqual(has(bare, surfaceIds), []);
  assert.equal(svgAttr(bare, 'data-scale'), svgAttr(full, 'data-scale'), 'hiding never changes the scale');
  for (const id of model.walls.map(item => item.id)) assert.equal(bare.includes(`data-entity="${id}"`), full.includes(`data-entity="${id}"`), `${id} is structure`);

  const sides = ['north', 'east', 'south', 'west'];
  const shown = sides.flatMap(side => has(api.renderElevationSheet(model, side).svg, plantingIds));
  assert.ok(shown.length > 0, 'some elevation shows a plant');
  for (const side of sides) {
    const elevation = api.renderElevationSheet(model, side, { structureOnly: true }).svg;
    assert.deepEqual(has(elevation, plantingIds), [], side);
    assert.equal(svgAttr(elevation, 'data-scale'), svgAttr(api.renderElevationSheet(model, side).svg, 'data-scale'));
  }

  const objects = structuredClone(fixture), objectIds = [...objects.fixtures, ...objects.equipment].map(item => item.id);
  for (const section of objects.sections ?? []) assert.deepEqual(has(api.renderSectionSheet(objects, section.id, { structureOnly: true }).svg, objectIds), [], section.id);
  assert.equal(api.hasNonStructural({ ...structuredClone(fixture), fixtures: [], equipment: [], surfaces: [], plantings: [] }), false);
});
test('elevations share one scale set by the building; plants are drawn but clipped at the drawing edge', () => {
  const { api } = loadStudio();
  const model = structuredClone(siteFixture), bare = { ...structuredClone(siteFixture), plantings: [] };
  const sides = ['north', 'east', 'south', 'west'];
  const sheets = Object.fromEntries(sides.map(side => [side, api.renderElevationSheet(model, side)]));
  for (const side of sides) {
    assert.equal(sheets[side].scaleLabel, '1/4" = 1\'-0"', side);
    const without = api.renderElevationSheet(bare, side);
    assert.equal(without.scaleLabel, sheets[side].scaleLabel, `${side}: plants never change the scale`);
    assert.deepEqual(without.frame.extent, sheets[side].frame.extent, `${side}: plants never change the extent`);
  }
  const plantingIds = model.plantings.map(item => item.id), datumZ = model.project.coordinates.siteDatumMm ?? 0;
  for (const side of ['east', 'south']) {
    const { svg, frame } = sheets[side], clipStart = svg.indexOf(`<g clip-path="url(#clip-elev-plants-${side})">`);
    const shown = plantingIds.filter(id => svg.includes(`data-entity="${id}"`));
    assert.ok(shown.length > 0, `${side} shows a plant`);
    assert.ok(clipStart > 0 && svg.includes(`<clipPath id="clip-elev-plants-${side}">`), `${side} clips its plants`);
    for (const id of shown) assert.ok(svg.indexOf(`data-entity="${id}"`) > clipStart && groupDepth(svg.slice(clipStart, svg.indexOf(`data-entity="${id}"`))) > 0, `${side}: ${id} is inside the clip`);
    // The clip spans the frame's width and the drawing area's height, clear of the title block.
    const xs = pointXs(svg.slice(svg.indexOf(`<clipPath id="clip-elev-plants-${side}">`)).match(/<clipPath[^>]*>(.*?)<\/clipPath>/)[1]);
    near(Math.min(...xs), frame.place.x, 0.01, `${side} clip left`);
    near(Math.max(...xs), frame.place.x + frame.place.w, 0.01, `${side} clip right`);
    assert.ok(Math.max(...xs) < 431.8 - 10 - 64, `${side}: the clip stays off the title block`);
    const height = id => { const planting = model.plantings.find(item => item.id === id); return planting.heightMm ?? model.plants.find(plant => plant.id === planting.plantId).matureHeightMm; };
    assert.ok(shown.some(id => datumZ + height(id) > frame.extent.maxZ), `${side}: a tree rises past the building and is clipped, not fitted`);
  }
  assert.doesNotMatch(api.renderElevationSheet(model, 'east', { structureOnly: true }).svg, /clip-elev-plants/);
  assert.doesNotMatch(api.renderElevationSheet(bare, 'east').svg, /clip-elev-plants/, 'no clip without plants');
});
test('sections frame the building plus 3000 mm of site; plants and ground beyond are clipped', () => {
  const { api } = loadStudio();
  const model = structuredClone(siteFixture);
  // Scales before the building framed the sections: 1/16" (1:192) and 1/8" (1:96).
  const before = { 'section-aa': 192, 'section-bb': 96 };
  for (const section of model.sections) {
    const sheet = api.renderSectionSheet(model, section.id), geometry = api.sectionGeometry(model, section);
    assert.ok(sheet.ratio <= before[section.id], `${section.id} is no smaller than before`);
    assert.equal(svgAttr(sheet.svg, 'data-scale'), `1:${sheet.ratio}`);
    const span = item => item.profile ? item.profile.map(p => p.h) : item.hull ? item.hull.map(p => p.x) : item.shape ? [item.hc - item.shape.widthMm / 2, item.hc + item.shape.widthMm / 2] : [item.h0, item.h1];
    const hs = [...geometry.cut.filter(item => item.kind !== 'surface'), ...geometry.beyond.filter(item => item.kind !== 'object'), ...geometry.members].flatMap(span)
      .concat(geometry.roofCut.flatMap(piece => piece.points.map(p => p.h)));
    const ground = geometry.ground.map(p => p.h);
    near(sheet.frame.extent.minH, Math.max(Math.min(...hs) - 3000, Math.min(...ground)), 1, `${section.id} left edge`);
    near(sheet.frame.extent.maxH, Math.min(Math.max(...hs) + 3000, Math.max(...ground)), 1, `${section.id} right edge`);
    assert.ok(sheet.frame.extent.maxH - sheet.frame.extent.minH < Math.max(...ground) - Math.min(...ground), `${section.id} no longer spans the whole cut line`);
    // The section body is clipped; datums and dimensions stay outside the clip.
    const clipStart = sheet.svg.indexOf(`<g clip-path="url(#clip-section-${section.id})">`), datumAt = sheet.svg.indexOf('<g data-role="datum"');
    assert.ok(clipStart > 0, `${section.id} clips its body`);
    for (const role of ['plants', 'ground', 'earth']) {
      const at = sheet.svg.indexOf(`<g data-role="${role}"`);
      if (at >= 0) assert.ok(at > clipStart && groupDepth(sheet.svg.slice(clipStart, at)) > 0, `${section.id}: ${role} is inside the clip`);
    }
    assert.ok(datumAt > clipStart && groupDepth(sheet.svg.slice(clipStart, datumAt)) === 0, `${section.id}: datums are outside the clip`);
    const bare = api.renderSectionSheet(model, section.id, { structureOnly: true });
    assert.deepEqual(bare.frame.extent, sheet.frame.extent, `${section.id}: Structure only keeps the frame`);
  }
  // Plants beyond do not set the scale.
  const noPlants = { ...structuredClone(siteFixture), plantings: [] };
  for (const section of model.sections) assert.equal(api.renderSectionSheet(noPlants, section.id).ratio, api.renderSectionSheet(model, section.id).ratio, section.id);
});
test('a section that meets no building element keeps the whole cut line', () => {
  const { api } = loadStudio();
  const model = structuredClone(siteFixture);
  // Along the front lawn, looking away from the house: only site surfaces, ground, and plants.
  model.sections.push({ id: 'section-site', name: 'Site section', start: { x: 0, y: 1500 }, end: { x: 20000, y: 1500 }, lookDirection: 'right' });
  const section = model.sections.at(-1), geometry = api.sectionGeometry(model, section);
  assert.equal(geometry.cut.filter(item => item.kind !== 'surface').length + geometry.beyond.filter(item => item.kind !== 'object').length + geometry.members.length + geometry.roofCut.length, 0, 'the plane meets no building element');
  const sheet = api.renderSectionSheet(model, section.id);
  assert.ok(Object.values(sheet.frame.extent).every(Number.isFinite), 'the frame is finite');
  const ground = geometry.ground.map(p => p.h);
  near(sheet.frame.extent.minH, Math.min(...ground), 1, 'left edge');
  near(sheet.frame.extent.maxH, Math.max(...ground), 1, 'right edge');
  assert.equal(sheet.warnings.some(item => item.code === 'section.empty'), geometry.cut.length + geometry.roofCut.length + geometry.members.length === 0, 'section.empty follows what the plane cuts');
  assert.doesNotMatch(sheet.svg, /NaN|Infinity/);
  // Off the site, looking away: nothing is cut, and the sheet still draws with the empty warning.
  model.sections.push({ id: 'section-void', name: 'Void section', start: { x: 0, y: -5000 }, end: { x: 20000, y: -5000 }, lookDirection: 'right' });
  const empty = api.renderSectionSheet(model, 'section-void');
  assert.ok(empty.warnings.some(item => item.code === 'section.empty'));
  assert.ok(Object.values(empty.frame.extent).every(Number.isFinite));
  assert.doesNotMatch(empty.svg, /NaN|Infinity/);
});
test('the viewer applies Structure only to the drawn sheet, from the toggle and from ?structure=1', async () => {
  const files = { './models/building.json': JSON.stringify(siteFixture) };
  const h = startHarness({ files, search: '?view=section&section=section-aa' });
  await h.api.start();
  await h.settle();
  assert.equal(h.element('#structure-toggle').classList.contains('hidden-view'), false);
  assert.match(h.element('#sheet-stage').innerHTML, /data-role="plants"/);
  h.element('#structure-toggle').dispatch('click');
  assert.equal(h.element('#structure-toggle').attributes['aria-pressed'], 'true');
  assert.doesNotMatch(h.element('#sheet-stage').innerHTML, /data-role="plants"/);

  const start = startHarness({ files, search: '?view=elevation&elevation=south&structure=1' });
  await start.api.start();
  await start.settle();
  assert.equal(start.element('#structure-toggle').attributes['aria-pressed'], 'true');
  for (const planting of siteFixture.plantings) assert.doesNotMatch(start.element('#sheet-stage').innerHTML, new RegExp(`data-entity="${planting.id}"`));

  const plan = startHarness({ files, search: '?view=plan' });
  await plan.api.start();
  await plan.settle();
  assert.equal(plan.element('#structure-toggle').classList.contains('hidden-view'), true, 'only on elevations and sections');
});