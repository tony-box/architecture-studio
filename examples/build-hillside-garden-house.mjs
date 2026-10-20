// Generates the two hillside garden house examples from one layout, so the imperial and metric models
// stay structurally identical and differ only in sizes, names, and display units. The layout is drawn
// on a module `u`: one foot imperial, 300 mm metric.
//
//   node examples/build-hillside-garden-house.mjs           # write both building.json files
//   node examples/build-hillside-garden-house.mjs --check   # fail if either file is stale
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXAMPLES = path.dirname(fileURLToPath(import.meta.url));
const ev = (note, confidence = 0.6, status = 'needs-review', source = 'generated') => ({ source, confidence, status, note });
const fixed = note => ev(note, 1, 'accepted');
const sum = layers => layers.reduce((s, l) => s + l.thicknessMm, 0);

function build(s) {
  const U = n => Math.round(n * s.u), P = (x, y, extra = {}) => ({ x: U(x), y: U(y), ...extra });
  const rect = (x0, y0, x1, y1) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
  // A cubic segment from (x0, y0) toward the next vertex with controls given in modules.
  const C = (x, y, c1, c2) => P(x, y, { c1: P(...c1), c2: P(...c2) });
  const E = s.extWall, h = sum(E) / 2 / s.u, ip = s.partitionThickness / 2 / s.u;
  const levels = [{ id: 'level-ground', name: 'Ground Floor', elevationMm: 0, floorToFloorMm: 3000, evidence: fixed('Synthetic fixture datum; finished floor is project zero.') }];
  const wall = (id, start, end, extra, note) => ({ id, levelId: 'level-ground', start, end, thicknessMm: sum(E), heightMm: s.wallHeight, kind: 'exterior', layerOrder: 'interior-to-exterior', layers: E, ...extra, evidence: ev(note) });
  const frame = 'Concept wood-frame wall with board cladding.';
  const walls = [
    wall('wall-south', P(18, 30), P(42, 30), {}, frame),
    wall('wall-east-south', P(42, 30), P(42, 36), {}, frame),
    wall('wall-bay', P(42, 36), P(42, 48), { bulge: 0.3 }, 'Concept curved bay wall bowing east; radius follows from the 0.3 bulge.'),
    wall('wall-east-north', P(42, 48), P(42, 60), {}, frame),
    wall('wall-north', P(42, 60), P(18, 60), {}, frame),
    wall('wall-west', P(18, 60), P(18, 30), {}, frame),
    { id: 'wall-bedroom', levelId: 'level-ground', start: P(18, 52), end: P(42, 52), thicknessMm: s.partitionThickness, heightMm: s.wallHeight, kind: 'interior', materialId: 'mat-lumber', evidence: ev('Concept stud partition.') }
  ];
  const op = (id, wallId, kind, o, note) => ({ id, wallId, kind, offsetMm: U(o.offset), widthMm: o.width, heightMm: o.height, sillMm: o.sill ?? 0, swing: o.swing ?? 'none', evidence: ev(note) });
  const openings = [
    op('opening-front-door', 'wall-south', 'door', { offset: 10.5, width: s.door, height: s.doorHeight, swing: 'left' }, 'Concept entry door.'),
    op('opening-living-window', 'wall-south', 'window', { offset: 3, width: s.window, height: s.windowHeight, sill: s.sill }, 'Concept living room window.'),
    op('opening-bay-window', 'wall-bay', 'window', { offset: 3.5, width: s.bayWindow, height: s.windowHeight, sill: s.sill }, 'Concept curved bay window, measured along the wall centreline.'),
    op('opening-deck-door', 'wall-north', 'door', { offset: 9, width: s.slider, height: s.doorHeight, swing: 'sliding' }, 'Concept sliding door to the deck.'),
    op('opening-bedroom-window', 'wall-west', 'window', { offset: 2.5, width: s.window, height: s.windowHeight, sill: s.sill }, 'Concept bedroom window.'),
    op('opening-bedroom-door', 'wall-bedroom', 'door', { offset: 16, width: s.door, height: s.doorHeight, swing: 'right' }, 'Concept bedroom door.')
  ];
  const spaces = [
    { id: 'space-great-room', name: 'Great Room', levelId: 'level-ground', use: 'living', boundary: [P(18 + h, 30 + h), P(42 - h, 30 + h), P(42 - h, 36, { bulge: 0.3 }), P(42 - h, 48), P(42 - h, 52 - ip), P(18 + h, 52 - ip)], evidence: ev('Concept room; the east side follows the bay.') },
    { id: 'space-bedroom', name: 'Bedroom', levelId: 'level-ground', use: 'bedroom', boundary: rect(18 + h, 52 + ip, 42 - h, 60 - h), evidence: ev('Concept room.') }
  ];
  const slabs = [
    { id: 'slab-ground', levelId: 'level-ground', boundary: [P(18, 30), P(42, 30), P(42, 36, { bulge: 0.3 }), P(42, 48), P(42, 60), P(18, 60)], thicknessMm: sum(s.slab), layers: s.slab, evidence: ev('Concept slab on grade; the bay follows the curved wall.') },
    { id: 'slab-deck', levelId: 'level-ground', boundary: [P(22, 60 + h), P(40, 60 + h), P(40, 66, { bulge: 0.35 }), P(22, 66)], thicknessMm: sum(s.deck), layers: s.deck, evidence: ev('Concept timber deck with a curved north edge, level with the floor.') }
  ];
  const roofs = [{ id: 'roof-main', levelId: 'level-ground', kind: 'gable', footprint: rect(18, 30, 42, 60), eaveElevationMm: s.wallHeight, ridgeElevationMm: s.ridge, ridgeAxis: 'y', overhangMm: s.overhang, evidence: ev('Concept gable roof; the bay has its own low roof, not modelled.') }];
  // A surface takes an outline (an array of vertices) or a centreline path ({ centerline, widthMm, cornerRadiusMm }).
  const surface = (id, name, shape, materialId, extra, note) => ({ id, name, levelId: 'level-ground', ...(Array.isArray(shape) ? { boundary: shape } : { path: shape }), ...extra, materialId, evidence: ev(note) });
  const path = (points, width, radius) => ({ centerline: points.map(([x, y]) => P(x, y)), widthMm: U(width), cornerRadiusMm: U(radius) });
  const draped = thicknessMm => ({ followsGrade: true, gradeOffsetMm: 0, thicknessMm });
  const surfaces = [
    surface('surface-front-lawn', 'Front Lawn', [P(1, 4), P(45, 4), C(45, 27, [36, 29], [26, 25]), P(16, 27), P(1, 27)], 'mat-lawn', draped(s.lawn), 'Concept lawn on the existing slope.'),
    surface('surface-back-lawn', 'Back Lawn', [C(1, 72, [20, 68], [40, 76]), P(59, 71), P(59, 99), P(1, 99)], 'mat-lawn', draped(s.lawn), 'Concept rear lawn.'),
    surface('surface-front-bed', 'Front Planting Bed', [C(17, 25.5, [24, 23], [36, 23]), P(43, 26), P(43, 29.4), P(17, 29.4)], 'mat-mulch', draped(s.mulch), 'Concept mulch bed along the entry.'),
    // The walk starts at the front door's centre and takes the door's width, so its edges run on from the jambs.
    surface('surface-walk', 'Entry Walk', { centerline: [{ anchor: { openingId: 'opening-front-door', at: 'center', matchWidth: true } }, P(30, 20), P(23.5, 13), P(23.5, 4)], cornerRadiusMm: U(8) }, 'mat-concrete', draped(s.walk), 'Concept concrete walk as wide as the front door, from the door to the street on two 8 ft radius curves.'),
    surface('surface-drive', 'Driveway', rect(46, 1, 56, 34), 'mat-asphalt', draped(s.drive), 'Concept asphalt drive.'),
    surface('surface-patio', 'Paver Patio', rect(8, 36, 17.4, 49), 'mat-pavers', { topElevationMm: -s.step, thicknessMm: s.patio }, 'Concept paver patio one step below the floor.'),
    surface('surface-stepping-path', 'Stepping-Stone Path', path([[11.5, 49], [11.5, 58], [19.5, 70]], 3, 10), 'mat-flagstone', draped(s.walk), 'Concept 3 ft flagstone path from the patio to the back lawn, one 10 ft radius curve.'),
    surface('surface-pond', 'Pond', [P(6, 14, { bulge: 1 }), P(14, 14, { bulge: 1 })], 'mat-water', { topElevationMm: s.pondTop, thicknessMm: s.pondDepth }, 'Concept lined pond; the water level is held flat.')
  ];
  const interval = s.interval, contour = (k, status, path, extra = {}) => ({ id: `contour-${status === 'existing' ? 'ex' : 'pr'}-${k < 0 ? `m${-k}` : k}`, elevationMm: Math.round(k * interval), status, path, ...extra, evidence: status === 'existing' ? ev('Concept contour sketched for the fixture; no topographic survey.', 0.4) : ev('Concept finished grade around the house pad.') });
  // Existing ground falls about one interval every 11 modules toward the street.
  const existing = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map(k => {
    const y = 45 + 11 * k;
    return contour(k, 'existing', [C(-4, y - 1, [8, y + 1.5], [20, y + 2]), C(30, y + 0.5, [40, y - 1], [52, y - 2]), P(64, y + 1)]);
  });
  // The house pad: a closed proposed contour at the floor elevation inside the limit of grading.
  const proposed = [contour(0, 'proposed', [C(15, 27, [24, 25], [36, 25]), C(45, 27, [46, 40], [46, 60]), C(45, 69, [36, 71], [24, 71]), C(15, 69, [14, 60], [14, 40])], { closed: true })];
  const site = {
    groundMaterialId: 'mat-earth',
    propertyLine: { id: 'site-property-line', boundary: [P(0, 0, { bulge: 0.06 }), P(60, 0), P(60, 100), P(0, 100)], evidence: ev('Synthetic lot for the fixture; not from a survey or plat.', 0.3) },
    setbacks: [
      { id: 'setback-front', edgeIndex: 0, distanceMm: U(20), label: 'Front setback', evidence: ev('Assumed zoning setback; verify with the jurisdiction.', 0.3) },
      { id: 'setback-east', edgeIndex: 1, distanceMm: U(6), label: 'Side setback', evidence: ev('Assumed zoning setback; verify with the jurisdiction.', 0.3) },
      { id: 'setback-rear', edgeIndex: 2, distanceMm: U(25), label: 'Rear setback', evidence: ev('Assumed zoning setback; verify with the jurisdiction.', 0.3) },
      { id: 'setback-west', edgeIndex: 3, distanceMm: U(6), label: 'Side setback', evidence: ev('Assumed zoning setback; verify with the jurisdiction.', 0.3) }
    ],
    gradingLimit: { id: 'site-grading-limit', boundary: rect(10, 22, 50, 74), evidence: ev('Concept limit of grading around the house pad.') },
    contourIntervalMm: interval,
    contours: [...existing, ...proposed],
    spotElevations: [
      { id: 'spot-front-door', position: P(30, 29), elevationMm: -s.step, status: 'proposed', evidence: ev('Concept landing one step below the floor.') },
      { id: 'spot-street-west', position: P(2, 2), elevationMm: Math.round(-4.1 * interval), status: 'existing', evidence: ev('Concept street edge elevation.', 0.4) },
      { id: 'spot-street-east', position: P(58, 2), elevationMm: Math.round(-4.2 * interval), status: 'existing', evidence: ev('Concept street edge elevation.', 0.4) }
    ]
  };
  const plant = (id, key, botanicalName, commonName, kind, size, matureHeightMm, matureSpreadMm, spacingMm) => ({ id, key, botanicalName, commonName, kind, size, matureHeightMm, matureSpreadMm, ...(spacingMm ? { spacingMm } : {}), evidence: ev('Illustrative plant choice; confirm hardiness and availability.') });
  const T = s.plantSizes;
  const plants = [
    plant('plant-white-oak', 'QA', 'Quercus alba', 'White oak', 'deciduous-tree', T.existing, 20000, 15000),
    plant('plant-tree-of-heaven', 'AA', 'Ailanthus altissima', 'Tree of heaven', 'deciduous-tree', T.existing, 15000, 9000),
    plant('plant-red-maple', 'AR', 'Acer rubrum', 'Red maple', 'deciduous-tree', T.tree, 15000, 10000),
    plant('plant-white-pine', 'PS', 'Pinus strobus', 'Eastern white pine', 'evergreen-tree', T.evergreen, 18000, 8000),
    plant('plant-inkberry', 'IG', 'Ilex glabra', 'Inkberry', 'shrub', T.shrub, 2000, 1500),
    plant('plant-oakleaf-hydrangea', 'HQ', 'Hydrangea quercifolia', 'Oakleaf hydrangea', 'shrub', T.shrub, 2000, 2000),
    plant('plant-switchgrass', 'PV', 'Panicum virgatum', 'Switchgrass', 'ornamental-grass', T.grass, 1500, 900, 600),
    plant('plant-pachysandra', 'PT', 'Pachysandra terminalis', 'Japanese pachysandra', 'groundcover', T.groundcover, 250, 450, 300)
  ];
  const at = (id, plantId, status, x, y, extra = {}) => ({ id, plantId, status, position: P(x, y), ...extra, evidence: status === 'proposed' ? ev('Concept planting location.') : ev('Approximate location of an existing tree; no tree survey.', 0.4) });
  const plantings = [
    at('planting-oak', 'plant-white-oak', 'existing', 12, 86, { canopyDiameterMm: U(40), trunkDiameterMm: 700 }),
    at('planting-ailanthus', 'plant-tree-of-heaven', 'remove', 51, 22, { canopyDiameterMm: U(18), trunkDiameterMm: 300 }),
    at('planting-maple-1', 'plant-red-maple', 'proposed', 7, 22),
    at('planting-maple-2', 'plant-red-maple', 'proposed', 38, 12),
    at('planting-maple-3', 'plant-red-maple', 'proposed', 52, 46),
    at('planting-pine-1', 'plant-white-pine', 'proposed', 50, 88),
    at('planting-pine-2', 'plant-white-pine', 'proposed', 54, 78),
    ...[19, 22.5, 26, 34.5, 38, 41.5].map((x, i) => at(`planting-inkberry-${i + 1}`, 'plant-inkberry', 'proposed', x, 27.5)),
    at('planting-hydrangea-1', 'plant-oakleaf-hydrangea', 'proposed', 7, 51),
    at('planting-hydrangea-2', 'plant-oakleaf-hydrangea', 'proposed', 7, 34),
    { id: 'planting-switchgrass', plantId: 'plant-switchgrass', status: 'proposed', boundary: [C(3, 18, [3, 23], [9, 25]), C(14, 21, [18, 18], [18, 11]), C(16, 9, [12, 7], [3, 10])], evidence: ev('Concept massed grass beside the pond.') },
    { id: 'planting-pachysandra', plantId: 'plant-pachysandra', status: 'proposed', boundary: [P(7, 82, { bulge: 1 }), P(17, 82, { bulge: 1 })], evidence: ev('Concept groundcover ring under the oak.') }
  ];
  const sections = [
    { id: 'section-aa', name: 'Site Section A-A', start: P(27, -3), end: P(27, 103), lookDirection: 'left' },
    { id: 'section-bb', name: 'Section B-B through the Bay', start: P(4, 42), end: P(58, 42), lookDirection: 'right' }
  ];
  const dimensions = [
    { id: 'dimension-width', kind: 'horizontal', from: { ...P(18, 30), z: 0 }, to: { ...P(42, 30), z: 0 }, offsetMm: U(5) },
    { id: 'dimension-depth', kind: 'vertical', from: { ...P(18, 30), z: 0 }, to: { ...P(18, 60), z: 0 }, offsetMm: U(13) }
  ];
  const assumptions = [
    { id: 'assumption-survey', topic: 'site', statement: 'The lot, setbacks, contours, and existing trees are synthetic. A boundary and topographic survey, a tree survey, and the zoning setbacks are required before any site decision.', impact: 'high', affectedEntityIds: ['site-property-line', 'setback-front', 'setback-rear', 'planting-oak'], evidence: fixed('Fixture intentionally excludes survey data.') },
    { id: 'assumption-grading', topic: 'grading', statement: 'The house pad grading is a concept. Drainage away from the foundation, cut and fill balance, and the drive slope need a civil review.', impact: 'medium', affectedEntityIds: ['site-grading-limit', 'contour-pr-0'], evidence: ev('Concept grading only.') },
    { id: 'assumption-planting', topic: 'planting', statement: 'Plant choices are illustrative. Confirm hardiness, invasiveness rules, and nursery availability locally.', impact: 'low', affectedEntityIds: plants.map(item => item.id), evidence: ev('Illustrative planting.') }
  ];
  return {
    schemaVersion: '1.0.0',
    project: { id: s.id, name: s.name, status: 'study', description: s.description, coordinates: { unit: 'mm', origin: { x: 0, y: 0, z: 0 }, siteDatumMm: 0, trueNorthDeg: 12, toleranceMm: 3, displayUnits: s.units }, jurisdiction: s.jurisdiction },
    materials: s.materials, site,
    levels, spaces, walls, openings, slabs, roofs, stairs: [], fixtures: [], equipment: [], systems: [],
    surfaces, plants, plantings, dimensions, sections, viewpoints: [], assumptions
  };
}

const mat = (id, name, category) => ({ id, name, category, evidence: ev('Synthetic fixture material.') });
const L = (id, materialId, thicknessMm) => ({ id, materialId, thicknessMm });
const inch = n => Math.round(n * 25.4);
const materials = names => Object.entries(names).map(([id, [name, category]]) => mat(id, name, category));

const imperial = {
  id: 'hillside-garden-house', name: 'Hillside Garden House', units: 'feet-inches', u: 304.8,
  description: 'Synthetic imperial fixture for site plans: a sloping lot with a curved frontage, setbacks, contours and a graded house pad, a curved bay wall, a curved deck, draped lawn, beds, and walks, a pond, existing and proposed trees, shrubs, and massed plantings.',
  jurisdiction: { country: 'United States', stateOrRegion: 'Example State', locality: 'Example Township', codeReviewStatus: 'unavailable' },
  interval: 609.6, wallHeight: inch(108), ridge: inch(108) + inch(84), overhang: inch(18), step: inch(6),
  door: inch(36), slider: inch(72), doorHeight: inch(80), window: inch(48), bayWindow: inch(60), windowHeight: inch(48), sill: inch(36),
  extWall: [L('gypsum', 'mat-gypsum', 13), L('studs', 'mat-batt', 140), L('sheathing', 'mat-sheathing', 11), L('cladding', 'mat-cladding', 19)],
  partitionThickness: 114,
  slab: [L('slab', 'mat-concrete', 102), L('base', 'mat-gravel', 152)],
  deck: [L('decking', 'mat-decking', 25), L('joists', 'mat-lumber', 184)],
  lawn: inch(4), mulch: inch(3), walk: inch(4), drive: inch(6), patio: inch(6), pondTop: -1800, pondDepth: inch(24),
  plantSizes: { existing: 'Existing', tree: '2-1/2" cal.', evergreen: "6-8' ht.", shrub: '#5 cont.', grass: '#1 cont.', groundcover: '4" pot' },
  materials: materials({
    'mat-earth': ['Undisturbed earth', 'earth'], 'mat-gravel': ['Crushed stone base', 'gravel'], 'mat-concrete': ['Concrete', 'concrete'],
    'mat-lumber': ['Sawn lumber', 'wood-framing'], 'mat-batt': ['Fiberglass batt insulation', 'insulation-batt'], 'mat-sheathing': ['Plywood sheathing', 'engineered-wood'],
    'mat-cladding': ['Cedar board cladding', 'wood-framing'], 'mat-gypsum': ['Gypsum board', 'gypsum'],
    'mat-lawn': ['Turf lawn', 'lawn'], 'mat-mulch': ['Shredded hardwood mulch', 'mulch'], 'mat-asphalt': ['Asphalt paving', 'asphalt'],
    'mat-pavers': ['Concrete unit pavers', 'unit-pavers'], 'mat-flagstone': ['Bluestone flagging', 'flagstone'], 'mat-water': ['Pond water', 'water'], 'mat-decking': ['Composite decking', 'decking']
  })
};

const metric = {
  id: 'hillside-garden-house-metric', name: 'Hillside Garden House (Metric)', units: 'metric', u: 300,
  description: 'Synthetic metric companion to hillside-garden-house: the same site and house on a 300 mm module, for comparing the ISO-informed site plan with the NCS-informed one.',
  jurisdiction: { country: 'Example Country', stateOrRegion: 'Example Region', locality: 'Example Municipality', codeReviewStatus: 'unavailable' },
  interval: 500, wallHeight: 2700, ridge: 2700 + 2100, overhang: 450, step: 150,
  door: 900, slider: 1800, doorHeight: 2100, window: 1200, bayWindow: 1500, windowHeight: 1200, sill: 900,
  extWall: [L('gypsum', 'mat-gypsum', 15), L('studs', 'mat-batt', 150), L('sheathing', 'mat-sheathing', 15), L('cladding', 'mat-cladding', 20)],
  partitionThickness: 120,
  slab: [L('slab', 'mat-concrete', 150), L('base', 'mat-gravel', 200)],
  deck: [L('decking', 'mat-decking', 25), L('joists', 'mat-lumber', 175)],
  lawn: 100, mulch: 75, walk: 100, drive: 150, patio: 150, pondTop: -1500, pondDepth: 600,
  plantSizes: { existing: 'Existing', tree: '16-18 cm girth', evergreen: '175-200 cm', shrub: 'C5', grass: 'C2', groundcover: 'P9' },
  materials: materials({
    'mat-earth': ['Natural ground', 'earth'], 'mat-gravel': ['Gravel sub-base', 'gravel'], 'mat-concrete': ['Concrete C25/30', 'concrete'],
    'mat-lumber': ['Solid timber C24', 'wood-framing'], 'mat-batt': ['Mineral wool batt', 'insulation-batt'], 'mat-sheathing': ['OSB/3 sheathing', 'engineered-wood'],
    'mat-cladding': ['Larch board cladding', 'wood-framing'], 'mat-gypsum': ['Gypsum plasterboard', 'gypsum'],
    'mat-lawn': ['Lawn', 'lawn'], 'mat-mulch': ['Bark mulch', 'mulch'], 'mat-asphalt': ['Asphalt surfacing', 'asphalt'],
    'mat-pavers': ['Concrete block paving', 'unit-pavers'], 'mat-flagstone': ['Natural stone flags', 'flagstone'], 'mat-water': ['Pond water', 'water'], 'mat-decking': ['Hardwood decking', 'decking']
  })
};

export const SPECS = [imperial, metric];
export const buildExample = build;
export const examplePath = spec => path.join(EXAMPLES, spec.id, 'building.json');
export const serialize = model => `${JSON.stringify(model, null, 2)}\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let stale = 0;
  for (const spec of SPECS) {
    const next = serialize(build(spec)), file = examplePath(spec);
    if (process.argv.includes('--check')) {
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';
      if (current !== next) { stale += 1; console.error(`${path.relative(EXAMPLES, file)} is stale. Run examples/build-hillside-garden-house.mjs.`); }
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, next);
      console.log(`Wrote ${path.relative(EXAMPLES, file)}.`);
    }
  }
  if (stale) process.exitCode = 1;
}
