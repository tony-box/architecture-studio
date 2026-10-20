import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildDrawingSet, loadStudioApi } from '../scripts/export-drawings.mjs';

const skillRoot = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(skillRoot, 'assets', 'studio-template.html'), 'utf8');
const read = name => JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', name, 'building.json'), 'utf8'));
const site = read('hillside-garden-house'), siteMetric = read('hillside-garden-house-metric'), legacy = read('lakeside-barn-residence');
const { api } = loadStudioApi(html);
const clone = model => structuredClone(model);
const findings = model => { api.state.model = model; return [...api.validateModel(model)]; };
const errorCodes = model => findings(model).filter(item => item.severity === 'error').map(item => item.code);

test('only models with site content draw a site plan or offer the Site tab', () => {
  assert.equal(api.hasSiteContent(legacy), false);
  assert.equal(api.hasSiteContent({ ...clone(legacy), site: { groundMaterialId: 'mat-earth' } }), false, 'a ground material alone is not site content');
  assert.equal(api.hasSiteContent(site), true);
  assert.ok(![...api.availableViews(legacy)].includes('site'));
  assert.equal(api.resolveView('site', legacy), 'plan');
  assert.equal(api.resolveView('site', site), 'site');
  assert.equal(api.resolveView('nonsense', site), 'plan');
  const legacySet = buildDrawingSet(html, legacy);
  assert.ok(!legacySet.sheets.some(sheet => sheet.path.startsWith('exports/site/')));
});

test('the site examples validate and draw L-101 first in both profiles, deterministically', () => {
  for (const model of [site, siteMetric]) {
    assert.deepEqual(errorCodes(clone(model)), []);
    const first = buildDrawingSet(html, clone(model)), second = buildDrawingSet(html, clone(model));
    assert.equal(first.sheets[0].path, 'exports/site/site-plan.svg');
    assert.equal(first.sheets[0].sheetId, 'L-101');
    assert.deepEqual([...first.sheets.map(sheet => sheet.svg)], [...second.sheets.map(sheet => sheet.svg)]);
    const ladder = model.project.coordinates.displayUnits === 'metric' ? ['1:100', '1:200', '1:250', '1:500', '1:1000'] : ['1" = 10\'', '1" = 20\'', '1" = 30\'', '1" = 40\'', '1" = 50\'', '1" = 60\'', '1" = 100\''];
    assert.ok(ladder.includes(first.sheets[0].scaleLabel), `site scale ${first.sheets[0].scaleLabel}`);
    assert.deepEqual([...first.sheets.flatMap(sheet => sheet.warnings).filter(item => item.severity !== 'advisory').map(item => `${item.code}: ${item.message}`)], []);
  }
});

test('L-101 carries bearings, setbacks, grading, contours, spots, plants, and the material key', () => {
  const svg = api.renderSitePlanSheet(clone(site)).svg;
  for (const text of ['N 12°00&#39;00&quot; W', 'FRONT SETBACK', 'REAR SETBACK', 'LIMIT OF GRADING', 'PLANT SCHEDULE', 'AA REMOVE', 'EX QA', 'TURF LAWN', 'FF EL.']) assert.ok(svg.includes(text), `missing ${text}`);
  assert.match(svg, /R=\d+\.\d\d&#39;/, 'arc edge carries its radius');
  for (const entity of ['site-property-line', 'setback-front', 'site-grading-limit', 'contour-ex-0', 'contour-pr-0', 'spot-front-door', 'planting-oak', 'planting-pachysandra', 'surface-walk']) assert.ok(svg.includes(`data-entity="${entity}"`), `missing ${entity}`);
  assert.match(svg, /<pattern id="hatch-lawn"/);
  assert.match(svg, /<pattern id="hatch-planting"/);
  const metric = api.renderSitePlanSheet(clone(siteMetric)).svg;
  assert.ok(metric.includes('FFL +0.000') && metric.includes('6.00 M FRONT SETBACK'));
});

test('bearings read from true north in quadrant form', () => {
  assert.equal(api.bearingLabel({ x: 0, y: 1 }, 0), 'N 0°00\'00" E');
  assert.equal(api.bearingLabel({ x: 1, y: 0 }, 0), 'N 90°00\'00" E');
  assert.equal(api.bearingLabel({ x: -1, y: -1 }, 0), 'S 45°00\'00" W');
  assert.equal(api.bearingLabel({ x: 0, y: 1 }, 12), 'N 12°00\'00" W');
  assert.equal(api.bearingLabel({ x: 1, y: 2 }, 0), 'N 26°33\'54" E');
});

test('the plant schedule groups by plant and status and counts massed plantings at triangular spacing', () => {
  const model = clone(site), rows = [...api.plantSchedule(model)];
  const row = (key, status) => rows.find(item => item.plant.key === key && item.status === status);
  assert.equal(row('IG', 'proposed').quantity, 6);
  assert.equal(row('AR', 'proposed').quantity, 3);
  assert.equal(row('QA', 'existing').quantity, 1);
  assert.equal(row('AA', 'remove').quantity, 1);
  const area = api.polygonArea(api.ringOf(model.plantings.find(item => item.id === 'planting-pachysandra').boundary));
  assert.equal(row('PT', 'proposed').quantity, Math.ceil(area / (300 * 300 * Math.sqrt(3) / 2)));
  // Trees before shrubs before groundcover.
  const kinds = rows.map(item => item.plant.kind);
  assert.ok(kinds.indexOf('deciduous-tree') < kinds.indexOf('shrub') && kinds.indexOf('shrub') < kinds.indexOf('groundcover'));
});

test('a plant schedule that does not fit says so instead of dropping rows', () => {
  const model = clone(site);
  for (let i = 0; i < 40; i += 1) {
    model.plants.push({ ...model.plants[4], id: `plant-extra-${i}`, key: `X${i}` });
    model.plantings.push({ ...model.plantings.find(item => item.id === 'planting-inkberry-1'), id: `planting-extra-${i}`, plantId: `plant-extra-${i}`, position: { x: 3000 + i * 100, y: 12000 } });
  }
  const sheet = api.renderSitePlanSheet(model);
  const warning = sheet.warnings.find(item => item.code === 'site.schedule-overflow');
  assert.ok(warning, 'overflow warning');
  assert.match(sheet.svg, /\+\d+ rows not shown/);
});

test('terrain is exact on contours, continuous between them, and changes only inside the grading limit', () => {
  const model = clone(site), terrain = api.terrainOf(model);
  assert.equal(api.terrainOf(legacy), null);
  assert.deepEqual([...terrain.issues], []);
  for (const contour of model.site.contours.filter(item => item.status === 'existing')) {
    for (const p of api.curvePoints(contour.path, false).filter((_, i) => i % 7 === 0)) assert.ok(Math.abs(terrain.at(p, 'existing') - contour.elevationMm) < 15, `${contour.id} at ${p.x},${p.y}`);
  }
  // No jumps along a line across the lot.
  let previous = null, worst = 0;
  for (let y = 0; y <= 30480; y += 20) { const z = terrain.at({ x: 8000, y }, 'existing'); if (previous != null) worst = Math.max(worst, Math.abs(z - previous)); previous = z; }
  assert.ok(worst < 40, `largest step ${worst} mm over 20 mm`);
  // The pad: proposed grade differs inside the limit and matches outside it.
  const inside = { x: 9000, y: 7300 }, outside = { x: 1500, y: 2000 };
  assert.ok(Math.abs(terrain.at(inside) - terrain.at(inside, 'existing')) > 100);
  assert.ok(Math.abs(terrain.at(outside) - terrain.at(outside, 'existing')) < 1);
  assert.ok(Math.abs(terrain.at({ x: 9144, y: 14000 })) < 15, 'the closed pad contour sits at its elevation');
});

test('site validation catches survey, setback, grading, contour, plant, and surface errors', () => {
  const base = () => clone(site);
  const check = (mutate, code) => { const model = base(); mutate(model); assert.ok(errorCodes(model).includes(code), `${code} expected, got ${errorCodes(model).join(', ')}`); };
  assert.ok(findings(base()).some(item => item.code === 'site.survey' && item.severity === 'advisory'));
  check(model => { model.site.setbacks[0].edgeIndex = 9; }, 'site.setback');
  check(model => { delete model.site.gradingLimit; }, 'site.grading-limit');
  check(model => { model.site.contours.at(-1).path = [{ x: -9000, y: 0 }, { x: 0, y: 9000 }]; model.site.contours.at(-1).closed = false; }, 'site.grading-limit');
  check(model => { model.site.contours[0].elevationMm += 200; }, 'site.contour');
  check(model => { model.site.contours[1].path = [{ x: -1219, y: -4000 }, { x: 19507, y: 6000 }]; }, 'terrain.crossing-contours');
  check(model => { model.site.spotElevations.push({ ...model.site.spotElevations[1], id: 'spot-duplicate', elevationMm: model.site.spotElevations[1].elevationMm + 500 }); }, 'terrain.conflicting-sample');
  check(model => { model.site.propertyLine.boundary[1] = { ...model.site.propertyLine.boundary[1], c1: { x: 1, y: 1 }, c2: { x: 2, y: 2 } }; }, 'polygon.geometry');
  check(model => { model.plants[1].key = model.plants[0].key; }, 'plant.key');
  check(model => { model.plants[0].kind = 'cactus'; }, 'plant.kind');
  check(model => { model.plantings[0].boundary = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }]; }, 'planting.geometry');
  check(model => { delete model.plants.find(item => item.id === 'plant-pachysandra').spacingMm; }, 'planting.spacing');
  check(model => { model.plantings[0].plantId = 'plant-missing'; }, 'reference.plant');
  check(model => { delete model.surfaces.find(item => item.id === 'surface-patio').topElevationMm; }, 'surface.geometry');
  check(model => { model.surfaces[0].followsGrade = 'yes'; }, 'surface.geometry');
  const misuse = base();
  misuse.walls[0].layers[3].materialId = 'mat-lawn';
  assert.ok(findings(misuse).some(item => item.code === 'material.category-use'));
});

test('sections draw the ground profile, existing grade where it differs, and draped surfaces under grade', () => {
  const model = clone(site), section = model.sections.find(item => item.id === 'section-aa');
  const geometry = api.sectionGeometry(model, section);
  assert.ok(geometry.ground.length > 100);
  assert.ok(geometry.ground.some(p => p.under != null), 'the ground meets the slab under the building');
  const walk = geometry.cut.find(item => item.id === 'surface-walk');
  assert.ok(walk?.poly, 'the draped walk is a band, not a box');
  const svg = api.renderSectionSheet(model, 'section-aa').svg;
  assert.match(svg, /data-role="ground"/);
  assert.match(svg, /stroke-dasharray="3 1\.5"/, 'existing grade is dashed where it differs');
  assert.ok(geometry.plants.length > 0, 'plants beyond the cut');
});

test('floor plans of site models frame on the building and crop site features', () => {
  const plan = api.renderPlanSheet(clone(site), 'level-ground');
  assert.ok(['1/8" = 1\'-0"', '1/4" = 1\'-0"'].includes(plan.scaleLabel), plan.scaleLabel);
  assert.match(plan.svg, /<clipPath id="plan-frame-level-ground">/);
  assert.match(plan.svg, /<g data-layer="site" clip-path="url\(#plan-frame-level-ground\)">/);
  assert.match(plan.svg, /<pattern id="hatch-pavers"/);
});

test('the 3D scene adds terrain, draped surfaces, and plantings, and says when it coarsens', () => {
  const scene = { triangles: [], lines: [] };
  api.state.model = clone(site); api.state.systems = new Set();
  api.buildScene(scene);
  const withSite = scene.triangles.length;
  const bare = clone(site); bare.site = { groundMaterialId: 'mat-earth' }; bare.plantings = []; bare.surfaces = bare.surfaces.filter(item => !item.followsGrade);
  api.state.model = bare; api.buildScene(scene);
  assert.ok(withSite > scene.triangles.length + 18 * 1000, 'site geometry adds triangles');
  assert.ok(withSite / 18 < 200000);
  assert.deepEqual([...(scene.notes ?? [])], []);
  const huge = clone(site);
  huge.site.propertyLine.boundary = [{ x: -100000, y: -100000 }, { x: 200000, y: -100000 }, { x: 200000, y: 200000 }, { x: -100000, y: 200000 }];
  api.state.model = huge; api.buildScene(scene);
  assert.equal(scene.notes?.[0]?.code, 'scene.reduced-detail');
});

test('selected site elements explain themselves', () => {
  const model = clone(site);
  const details = id => api.entityDetails(model, id);
  assert.equal(details('site-property-line').type, 'Property line');
  assert.equal(details('setback-front').title, 'Front setback');
  assert.equal(details('contour-ex-0').type, 'Contour');
  assert.ok(details('plant-red-maple').dims.some(([label, value]) => label === 'Quantity' && value === '3'));
  assert.ok(details('planting-pachysandra').dims.some(([label]) => label === 'Quantity'));
  assert.ok(details('surface-front-lawn').dims.some(([label, value]) => label === 'Top' && value.startsWith('Follows grade')));
  assert.ok(details('spot-front-door').openItems.length > 0);
});

test('the hillside garden house examples are generated and structurally identical', async () => {
  const generator = await import('../examples/build-hillside-garden-house.mjs');
  for (const spec of generator.SPECS) {
    assert.equal(fs.readFileSync(generator.examplePath(spec), 'utf8').replace(/\r\n/g, '\n'), generator.serialize(generator.buildExample(spec)), `${spec.id} is current`);
  }
  const [imperial, metric] = generator.SPECS.map(spec => generator.buildExample(spec));
  const ids = model => JSON.stringify([...Object.values(model).filter(Array.isArray).flat(), ...Object.values(model.site).filter(Array.isArray).flat()].map(item => item.id ?? null));
  assert.equal(ids(imperial), ids(metric));
});

test('degenerate terrain inputs never crash validation, drawings, or 3D', () => {
  const noLimit = clone(site); noLimit.site.gradingLimit.boundary = [];
  assert.doesNotThrow(() => findings(noLimit));
  assert.ok(errorCodes(noLimit).includes('polygon.geometry'));
  const missing = clone(site); delete missing.site.gradingLimit.boundary;
  assert.doesNotThrow(() => findings(missing));
  // Two spot elevations and no lot: no surface, no crash, ground at the datum.
  const spots = clone(site);
  spots.site = { groundMaterialId: 'mat-earth', spotElevations: spots.site.spotElevations.filter(item => item.status === 'existing') };
  assert.deepEqual(errorCodes(spots), []);
  assert.ok(buildDrawingSet(html, spots).sheets.length > 0);
  const scene = { triangles: [], lines: [] };
  api.state.model = spots; api.state.systems = new Set();
  assert.doesNotThrow(() => api.buildScene(scene));
  // Collinear samples: a warning, and the ground holds the datum instead of falling to zero.
  const line = clone(site);
  line.project.coordinates.siteDatumMm = 1000;
  line.site = { groundMaterialId: 'mat-earth', spotElevations: [0, 1, 2].map(i => ({ id: `spot-line-${i}`, position: { x: i * 5000, y: 0 }, elevationMm: 5000, status: 'existing', evidence: site.levels[0].evidence })) };
  assert.ok(findings(line).some(item => item.code === 'terrain.degenerate' && item.severity === 'warning'));
  assert.equal(api.terrainOf(line).at({ x: 2500, y: 4000 }), 1000);
});

test('terrain for dense survey-sized contours builds in reasonable time', () => {
  const model = clone(site), evidence = site.levels[0].evidence;
  model.site = { groundMaterialId: 'mat-earth', contourIntervalMm: 300, contours: Array.from({ length: 60 }, (_, k) => ({ id: `contour-dense-${k}`, elevationMm: k * 300, status: 'existing', evidence, path: Array.from({ length: 41 }, (__, i) => ({ x: i * 5000, y: k * 300 + Math.round(200 * Math.sin(i / 3)) })) })) };
  const started = Date.now();
  const terrain = api.terrainOf(model);
  findings(model);
  const elapsed = Date.now() - started;
  assert.ok(terrain.existing, 'a surface is built');
  assert.ok(elapsed < 6000, `terrain took ${elapsed} ms`);
});

test('site plan layers can be hidden in the viewer without changing the scale or the export', () => {
  const model = clone(site);
  assert.deepEqual([...api.siteCategories(model)], ['trees', 'plants', 'surfaces', 'grading', 'lot']);
  assert.deepEqual([...api.siteCategories(legacy)], []);
  assert.deepEqual([...api.parseSiteHidden('trees,bogus,grading', model)], ['trees', 'grading']);
  const full = api.renderSitePlanSheet(model), noTrees = api.renderSitePlanSheet(model, { hidden: new Set(['trees']) });
  assert.equal(noTrees.scaleLabel, full.scaleLabel);
  assert.ok(!noTrees.svg.includes('data-entity="planting-oak"') && !noTrees.svg.includes('data-entity="plant-red-maple"'), 'trees and their schedule rows are gone');
  assert.ok(noTrees.svg.includes('data-entity="planting-inkberry-1"') && noTrees.svg.includes('data-entity="plant-inkberry"'), 'shrubs stay');
  const bare = api.renderSitePlanSheet(model, { hidden: new Set(['surfaces', 'grading', 'lot']) }).svg;
  for (const id of ['surface-walk', 'contour-ex-0', 'spot-front-door', 'site-grading-limit', 'site-property-line', 'setback-front']) assert.ok(!bare.includes(`data-entity="${id}"`), id);
  assert.ok(!bare.includes('TURF LAWN'), 'hidden surfaces leave the material key');
  assert.equal(buildDrawingSet(html, model).sheets[0].svg, full.svg, 'the export always draws every layer');
});

test('floor plans of site models show hard surfaces and leave lawn, beds, and water to the site plan', () => {
  const model = clone(site), plan = api.renderPlanSheet(model, 'level-ground').svg;
  for (const id of ['surface-walk', 'surface-patio', 'surface-stepping-path']) assert.ok(plan.includes(`data-entity="${id}"`), `${id} on the plan`);
  for (const id of ['surface-front-lawn', 'surface-front-bed', 'surface-pond']) assert.ok(!plan.includes(`data-entity="${id}"`), `${id} left off the plan`);
  assert.ok(!plan.includes('TURF LAWN'), 'the material key lists only what the plan draws');
  model.surfaces.find(item => item.id === 'surface-front-bed').onFloorPlans = true;
  model.surfaces.find(item => item.id === 'surface-walk').onFloorPlans = false;
  const overridden = api.renderPlanSheet(model, 'level-ground').svg;
  assert.ok(overridden.includes('data-entity="surface-front-bed"') && !overridden.includes('data-entity="surface-walk"'));
  assert.ok(api.renderSitePlanSheet(model).svg.includes('data-entity="surface-front-lawn"'), 'the site plan still shows the lawn');
});

test('dimension values stay off hatched walks and patios on floor plans', () => {
  const model = clone(site), plan = api.renderPlanSheet(model, 'level-ground');
  const value = plan.svg.match(/<text x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)" text-anchor="middle"[^>]*>24&#39;-0&quot;<\/text>/);
  assert.ok(value, 'the 24 ft dimension is drawn');
  const [x, y, s] = value.slice(1).map(Number), half = '24\'-0"'.length * s * 0.62 / 2;
  // The walk's paper outline, from the plan's own rendering of it.
  const d = plan.svg.match(/data-entity="surface-walk"><path d="([^"]+)"/)[1];
  const walk = [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)|A[\d.]+,[\d.]+ \d \d \d (-?[\d.]+),(-?[\d.]+)/g)].map(m => [Number(m[1] ?? m[3]), Number(m[2] ?? m[4])]);
  const inside = (p, poly) => { let hit = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ax, ay] = poly[i], [bx, by] = poly[j]; if ((ay > p.y) !== (by > p.y) && p.x < (bx - ax) * (p.y - ay) / (by - ay) + ax) hit = !hit; } return hit; };
  const samples = [];
  for (let i = 0; i <= 8; i += 1) for (const dy of [-0.7 * s, -0.35 * s, 0]) samples.push({ x: x - half + 2 * half * i / 8, y: y + dy });
  const overlapsWalk = samples.some(p => inside(p, walk));
  assert.ok(!overlapsWalk, 'the value moved off the walk');
  assert.match(plan.svg, /<polygon points="[^"]+" fill="#ffffff" pointer-events="none" stroke="none"\/><text x="[\d.]+" y="[\d.]+" font-size="[\d.]+" text-anchor="middle" fill="#1b1b1b">24&#39;-0&quot;/, 'a paper backing sits behind the value');
  assert.ok(!plan.warnings.some(item => item.code === 'dimension.placement'));
});
