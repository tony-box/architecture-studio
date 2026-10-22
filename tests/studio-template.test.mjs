import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
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
  model.walls.find(wall => wall.id === 'wall-g-north').baseOffsetMm = 500;
  assert.notEqual(api.elevationSvg(), baseline);
});

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
  const eastWall = Math.max(...pointXs(entityGroup(plan, 'wall-g-east')));
  const depth = entityGroup(plan, 'dimension-depth');
  assert.ok(depth, 'depth dimension is drawn');
  assert.ok(Math.min(...numbersIn(depth, 'x1'), ...numbersIn(depth, 'x2')) > eastWall, 'depth dimension clears the east wall');
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
  assert.equal(slab.z1 - slab.z0, 300);
  assert.equal(barn.roofCut.length, 1);
  assert.equal(Math.max(...barn.roofCut[0].points.map(point => point.z)), 9000);

  const metric = api.sectionGeometry(structuredClone(metricFixture), metricFixture.sections[0]);
  const stair = metric.cut.find(item => item.id === 'stair-main');
  assert.ok(stair.profile.length > 2 * 17, 'stair cut along its run shows every riser');
  const partition = metric.cut.filter(item => item.id === 'wall-u-partition');
  assert.equal(partition.length, 1, 'the sliding door leaves only the wall above its head');
  assert.equal(partition[0].z0, 3000 + 2100);
  const window = metric.cut.filter(item => item.id === 'wall-u-west');
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
  assert.deepEqual([...first.manifest.files.map(file => file.sheet)], ['A-101', 'A-102', 'A-201', 'A-202', 'A-203', 'A-204', 'A-301', 'M-101', 'M-102']);
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
  assert.equal(stairDims.Riser, '6 5/8"');
  assert.equal(stairDims['Total rise'], `12'-9 1/2"`);
  assert.match(stair.diagram, /^<svg[^>]*role="img"/);
  assert.ok(stair.openItems.includes('Guards and handrails'));

  const opening = Object.fromEntries(api.entityDetails(model, 'opening-bedroom-window').dims);
  assert.equal(opening['Head height'], `7'-4 5/8"`);
  assert.ok(!('Header' in opening), 'header size is an open item, not a value');
  assert.ok(api.entityDetails(model, 'opening-bedroom-window').openItems.includes('Header size and framing'));

  const room = Object.fromEntries(api.entityDetails(model, 'space-workshop').dims);
  assert.equal(room.Area, '930 SF');
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
    for (const slab of model.slabs) slab.materialId = 'mat-rc';
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

test('material detail falls back to poche without a catalog or at small scales', () => {
  const { api } = loadStudio();
  const legacy = api.renderPlanSheet(cloneFixture(), 'level-ground').svg;
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
  assert.equal(api.materialsActive(cloneFixture(), 12), false, 'no catalog, no detail');
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
  assert.ok(api.sectionGeometry(model, model.sections[1]).cut.some(item => item.id === 'surface-shop-walk'));
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

  const outer = { x0: 0, y0: 0, x1: 2000, y1: 2000, label: 'Plan' }, inner = { x0: 100, y0: 100, x1: 900, y1: 900, label: 'Detail' };
  const regional = testSource([cal('cal-1', 'printed-dimension', 10, 0.01), cal('cal-2', 'manual', 2, 0.01, { region: outer }), cal('cal-3', 'scale-bar', 1, 0.01, { region: inner })]);
  assert.equal(api.sourceScale(regional).mmPerPx, 10, 'whole-image calibrations by default');
  assert.equal(api.sourceScale(regional, [{ x: 200, y: 200 }, { x: 800, y: 800 }]).mmPerPx, 1, 'the smallest region containing both points');
  assert.equal(api.sourceScale(regional, [{ x: 200, y: 200 }, { x: 1500, y: 800 }]).region.label, 'Plan');
  assert.equal(api.sourceScale(regional, [{ x: 200, y: 200 }, { x: 3500, y: 800 }]).mmPerPx, 10, 'points outside every region use the whole image');
  assert.deepEqual(plain(api.sourceScaleGroups(regional).map(group => group.scale.mmPerPx)), [10, 2, 1]);
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
    + `"calibration":{"from":{"x":100,"y":200.1},"to":{"x":3100.2,"y":200},"distanceMm":3810,"entered":"12'-6\\"","uncertaintyPx":0.5,"region":{"x0":10,"y0":20,"x1":3200,"y1":2900,"label":"Main plan"}},`
    + '"references":[{"label":"NE house corner","pixel":{"x":12.3,"y":6.8}}]}');
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  assert.equal(json.calibration.entered, `12'-6"`);

  const referencesOnly = api.calibrationPayload(source, { references: [{ label: 'Gate', pixel: { x: 5, y: 5 } }] });
  const parsed = JSON.parse(referencesOnly.slice(referencesOnly.indexOf('{')));
  assert.equal(parsed.calibration, undefined);
  assert.deepEqual(parsed.references, [{ label: 'Gate', pixel: { x: 5, y: 5 } }]);
  const unlabelled = api.calibrationPayload(source, { calibration: { from: { x: 0, y: 0 }, to: { x: 3000, y: 0 }, distanceMm: 1000, entered: '1 m', uncertaintyPx: 2 } });
  assert.deepEqual(JSON.parse(unlabelled.slice(unlabelled.indexOf('{'))).calibration, { from: { x: 0, y: 0 }, to: { x: 3000, y: 0 }, distanceMm: 1000, entered: '1 m', uncertaintyPx: 2 });
  assert.throws(() => api.calibrationPayload(source, {}), /scale line or at least one labelled reference/);
});

test('a manual distance that disagrees with the estimate warns before copying', () => {
  const { api } = loadStudio();
  const source = testSource([cal('cal-1', 'scale-bar', 10, 0.01)]);
  const draft = text => ({ from: { x: 0, y: 0 }, to: { x: 3000, y: 0 }, fromU: 0.5, toU: 0.5, distanceText: text, region: null, regionLabel: '', references: [] });
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
// fixed set of project files, and the clipboard is captured.
function startHarness({ files, search = '' }) {
  const elements = new Map(), listeners = [];
  class Element {
    constructor(attrs = {}) { Object.assign(this, { innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, style: {}, dataset: {}, options: [], attributes: {}, listeners: {} }, attrs); const set = new Set(); this.classList = { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c), toggle: (c, on = !set.has(c)) => (on ? set.add(c) : set.delete(c), on) }; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); listeners.push(type); }
    dispatch(type, event = {}) { for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, target: this, ...event }); }
    querySelector(selector) { return element(`${selector}@child`); }
    querySelectorAll() { return []; }
    contains() { return false; }
    focus() {}
    select() {}
    setPointerCapture() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  }
  const element = selector => { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); };
  const tabs = [...html.matchAll(/<button class="tab" role="tab" id="(tab-[a-z]+)" data-view="([a-z]+)"[^>]*?( hidden)?>/g)].map(([, id, view, hidden]) => {
    const tab = element(`#${id}`); Object.assign(tab, { id, dataset: { view }, hidden: Boolean(hidden) }); return tab;
  });
  const tools = ['line', 'region', 'point'].map(tool => Object.assign(element(`tool-${tool}`), { dataset: { tool } }));
  const clipboard = [];
  const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => JSON.parse(body), arrayBuffer: async () => new Uint8Array(body).buffer });
  let api;
  const context = vm.createContext({
    console, structuredClone, TextEncoder, URLSearchParams, Blob, crypto: globalThis.crypto,
    URL: { createObjectURL: () => 'blob:source' },
    Image: class { set src(value) { this.url = value; } async decode() { this.naturalWidth = 400; this.naturalHeight = 300; } },
    CSS: { escape: value => value },
    navigator: { clipboard: { writeText: async text => { clipboard.push(text); } } },
    location: { search, pathname: '/', hash: '' },
    history: { replaceState() {} },
    window: { addEventListener() {} },
    fetch: async url => files[url] === undefined ? response('', 404) : response(files[url]),
    document: { querySelector: element, getElementById: id => element(`#${id}`), activeElement: null, querySelectorAll: selector => selector === '.tab' ? tabs : selector === '.source-tool' ? tools : [] },
    __ARCHITECTURE_STUDIO_API__(value) { api = value; }
  });
  vm.runInContext(extractStudioScript(html), context);
  const settle = () => api.sourcesChecked();
  return { api, element, tabs, tools, clipboard, settle };
}
const imageBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
const sourcesJson = (overrides = {}) => JSON.stringify({ schemaVersion: '1.0.0', sources: [testSource([], { pixels: { width: 400, height: 300 }, contentHash: `sha256:${crypto.createHash('sha256').update(imageBytes).digest('hex')}`, ...overrides })] });

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
