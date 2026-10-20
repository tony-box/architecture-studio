import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildDrawingSet, loadStudioApi } from '../scripts/export-drawings.mjs';
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

  const unsupportedSlab = cloneFixture();
  unsupportedSlab.slabs[0].boundary = [{ x: 0, y: 0 }, { x: 9600, y: 0 }, { x: 9600, y: 6000 }, { x: 4800, y: 6000 }, { x: 4800, y: 13200 }, { x: 0, y: 13200 }];
  assert.ok(errorCodes(api, unsupportedSlab).includes('renderer.unsupported-slab'));
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
  assert.doesNotMatch(imperial, /url\(#hatch-diagonal-wide\)/, 'NCS shows reinforced concrete as plain concrete');
  assert.match(metric, /url\(#hatch-diagonal-wide\)/, 'ISO/DIN practice adds 45-degree lines for reinforcement');

  // Rigid insulation: zig-zag (NCS) against crosshatch (ISO/DIN). Sawn lumber end grain: X against rings.
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
  expectError('opening.header', model => { model.openings.find(item => item.id === 'opening-studio-window').headers[0].layerIndex = 9; });
  expectError('opening.header', model => { delete model.openings.find(item => item.id === 'opening-studio-window').headers[0].plies; });
  expectError('opening.header', model => { model.openings.find(item => item.id === 'opening-studio-window').headers[1].layerIndex = 1; });
  expectError('opening.header-fit', model => { model.openings.find(item => item.id === 'opening-studio-window').headers[0].depthMm = 900; });
  expectError('opening.header-fit', model => { model.openings.find(item => item.id === 'opening-overhead-door').headers[0].bearingMm = 5000; });
  expectError('member.profile', model => { delete model.beams[0].shape.flangeThicknessMm; });
  expectError('member.profile', model => { model.columns[0].shape.wallThicknessMm = 80; });
  expectError('member.geometry', model => { model.columns[0].topElevationMm = -10; });
  expectError('renderer.unsupported-foundation', model => { model.foundations[0].boundary = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }]; });
  expectError('renderer.unsupported-surface', model => { model.surfaces[0].boundary = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }]; });
  assert.ok(api.validateModel(structuredClone(materialFixture)).some(finding => finding.code === 'structure.review' && finding.severity === 'advisory'));
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
  const lastBrick = materials.lastIndexOf('url(#hatch-diagonal)'), firstAngle = materials.search(/<polygon points="(?:[^ "]+ ){5}[^ "]+" fill="#1b1b1b"/);
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
  assert.ok(!/data-role="earth"/.test(tallSheet.svg) || tallSheet.ratio <= 100);

  const inherited = structuredClone(materialFixture);
  inherited.materials[0].category = 'toString';
  assert.ok(errorCodes(api, inherited).includes('material.category'));
  const badHeader = structuredClone(materialFixture);
  badHeader.openings[0].headers[0].kind = 'constructor';
  assert.ok(errorCodes(api, badHeader).includes('opening.header'));
});
