// Generates the two mixed-material workshop examples from one layout, so the imperial and metric
// models stay structurally identical and differ only in sizes, names, and display units.
//
//   node examples/build-mixed-material-workshop.mjs           # write both building.json files
//   node examples/build-mixed-material-workshop.mjs --check   # fail if either file is stale
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXAMPLES = path.dirname(fileURLToPath(import.meta.url));
const ev = (note, confidence = 0.6, status = 'needs-review', source = 'generated') => ({ source, confidence, status, note });
const fixed = note => ev(note, 1, 'accepted');
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const sum = layers => layers.reduce((s, l) => s + l.thicknessMm, 0);

function build(s) {
  const { W, D } = s;
  const G = sum(s.groundWall), U = sum(s.upperWall), Pt = sum(s.partition), gH = G / 2, uH = U / 2;
  const slabG = sum(s.groundSlab), slabU = sum(s.upperSlab);
  const upperZ = s.f2f, beamTop = upperZ - slabU, beamBottom = beamTop - s.beam.depthMm;
  const eave = upperZ + s.upperWallHeight;
  const levels = [
    { id: 'level-ground', name: 'Ground Floor', elevationMm: 0, floorToFloorMm: s.f2f, evidence: fixed('Synthetic fixture datum.') },
    { id: 'level-upper', name: 'Upper Floor', elevationMm: upperZ, floorToFloorMm: s.upperWallHeight, evidence: fixed('Synthetic fixture datum.') }
  ];
  const wall = (id, levelId, start, end, layers, heightMm, kind, note) => ({ id, levelId, start, end, thicknessMm: sum(layers), heightMm, kind, ...(kind === 'exterior' ? { layerOrder: 'interior-to-exterior' } : {}), layers, evidence: ev(note) });
  const cmu = 'Concept masonry wall: gypsum, rigid insulation, and CMU.';
  const veneer = 'Concept wood-frame wall with brick veneer.';
  const part = 'Concept wood stud partition.';
  const walls = [
    wall('wall-g-south', 'level-ground', { x: 0, y: 0 }, { x: W, y: 0 }, s.groundWall, s.f2f, 'exterior', cmu),
    wall('wall-g-east', 'level-ground', { x: W, y: 0 }, { x: W, y: D }, s.groundWall, s.f2f, 'exterior', cmu),
    wall('wall-g-north', 'level-ground', { x: W, y: D }, { x: 0, y: D }, s.groundWall, s.f2f, 'exterior', cmu),
    wall('wall-g-west', 'level-ground', { x: 0, y: D }, { x: 0, y: 0 }, s.groundWall, s.f2f, 'exterior', cmu),
    wall('wall-g-office', 'level-ground', { x: s.officeX, y: 0 }, { x: s.officeX, y: D }, s.partition, beamTop, 'interior', part),
    wall('wall-u-south', 'level-upper', { x: 0, y: 0 }, { x: W, y: 0 }, s.upperWall, s.upperWallHeight, 'exterior', veneer),
    wall('wall-u-east', 'level-upper', { x: W, y: 0 }, { x: W, y: D }, s.upperWall, s.upperWallHeight, 'exterior', veneer),
    wall('wall-u-north', 'level-upper', { x: W, y: D }, { x: 0, y: D }, s.upperWall, s.upperWallHeight, 'exterior', veneer),
    wall('wall-u-west', 'level-upper', { x: 0, y: D }, { x: 0, y: 0 }, s.upperWall, s.upperWallHeight, 'exterior', veneer),
    wall('wall-u-bath-east', 'level-upper', { x: s.bathX, y: 0 }, { x: s.bathX, y: s.bathY }, s.partition, s.upperWallHeight, 'interior', part),
    wall('wall-u-bath-north', 'level-upper', { x: s.bathX, y: s.bathY }, { x: 0, y: s.bathY }, s.partition, s.upperWallHeight, 'interior', part)
  ];
  const op = (id, wallId, kind, o, note) => ({ id, wallId, kind, offsetMm: o.offset, widthMm: o.width, heightMm: o.height, sillMm: o.sill ?? 0, swing: o.swing ?? 'none', ...(o.headers ? { headers: o.headers } : {}), evidence: ev(note) });
  const H = s.headers;
  const openings = [
    op('opening-office-window', 'wall-g-south', 'window', { ...s.o.officeWindow, headers: [H.officeWindow, { ...H.officeWindow, face: 'outer' }] }, 'Concept office window with a pair of angle lintels in the block.'),
    op('opening-overhead-door', 'wall-g-south', 'overhead-door', { ...s.o.overhead, headers: [H.overhead] }, 'Concept shop door with a steel beam header.'),
    op('opening-shop-door', 'wall-g-east', 'door', { ...s.o.shopDoor, swing: 'right', headers: [H.shopDoor] }, 'Concept shop door with a precast lintel.'),
    op('opening-shop-window', 'wall-g-north', 'window', { ...s.o.shopWindow, headers: [H.shopWindow] }, 'Concept high window under a bond beam.'),
    op('opening-office-west-window', 'wall-g-west', 'window', s.o.officeWest, 'Header not yet chosen.'),
    op('opening-office-door', 'wall-g-office', 'door', { ...s.o.officeDoor, swing: 'left', headers: [H.officeDoor] }, 'Concept office door.'),
    op('opening-studio-window', 'wall-u-south', 'window', { ...s.o.studioWindow, headers: [H.studioWindow, H.angle] }, 'Concept picture window: built-up header plus veneer lintel.'),
    op('opening-studio-small-window', 'wall-u-south', 'window', { ...s.o.studioSmall, headers: [H.studioSmall, H.angle] }, 'Concept window: two-ply header plus veneer lintel.'),
    op('opening-studio-east-window', 'wall-u-east', 'window', { ...s.o.studioEast, headers: [H.studioEast, H.angle] }, 'Concept window: solid sawn header plus veneer lintel.'),
    op('opening-studio-north-window', 'wall-u-north', 'window', { ...s.o.studioNorth, headers: [H.studioNorth, H.angle] }, 'Concept window: engineered lumber header plus veneer lintel.'),
    op('opening-studio-west-window', 'wall-u-west', 'window', s.o.studioWest, 'Header not yet chosen.'),
    op('opening-bath-door', 'wall-u-bath-east', 'door', { ...s.o.bathDoor, swing: 'left', headers: [H.bathDoor] }, 'Concept bath door.')
  ];
  const pf = Math.round(Pt / 2);
  const spaces = [
    { id: 'space-office', name: 'Office', levelId: 'level-ground', use: 'office', boundary: rect(gH, gH, s.officeX - pf, D - gH), evidence: ev('Concept room.') },
    { id: 'space-shop', name: 'Shop', levelId: 'level-ground', use: 'workshop', boundary: rect(s.officeX + pf, gH, W - gH, D - gH), evidence: ev('Concept room.') },
    { id: 'space-bath', name: 'Bath', levelId: 'level-upper', use: 'bathroom', boundary: rect(uH, uH, s.bathX - pf, s.bathY - pf), evidence: ev('Concept room.') },
    { id: 'space-studio', name: 'Studio', levelId: 'level-upper', use: 'living', boundary: [{ x: s.bathX + pf, y: uH }, { x: W - uH, y: uH }, { x: W - uH, y: D - uH }, { x: uH, y: D - uH }, { x: uH, y: s.bathY + pf }, { x: s.bathX + pf, y: s.bathY + pf }], evidence: ev('Concept room.') }
  ];
  const slabs = [
    { id: 'slab-ground', levelId: 'level-ground', boundary: rect(s.stemInner, s.stemInner, W - s.stemInner, D - s.stemInner), thicknessMm: slabG, layers: s.groundSlab, evidence: ev('Concept slab on grade over insulation and a gravel base.') },
    { id: 'slab-upper', levelId: 'level-upper', boundary: rect(gH, gH, W - gH, D - gH), thicknessMm: slabU, layers: s.upperSlab, evidence: ev('Concept framed floor; joist depth is an allowance.') }
  ];
  const ridgeRise = s.ridge - eave;
  const roofs = [{ id: 'roof-main', levelId: 'level-upper', kind: 'gable', footprint: rect(0, 0, W, D), eaveElevationMm: eave, ridgeElevationMm: s.ridge, ridgeAxis: 'x', overhangMm: s.overhang, evidence: ev(`Concept gable roof, ${ridgeRise} mm rise.`) }];
  const stairs = [{ id: 'stair-shop', fromLevelId: 'level-ground', toLevelId: 'level-upper', start: { x: s.stair.x0, y: s.stair.y }, end: { x: s.stair.x0 + (s.stair.risers - 1) * s.stair.tread, y: s.stair.y }, widthMm: s.stair.width, riserCount: s.stair.risers, treadDepthMm: s.stair.tread, materialId: 'mat-lumber', evidence: ev('Concept straight timber stair along the north wall; headroom unverified.') }];
  const fixtures = [
    { id: 'fixture-shop-sink', name: 'Shop Sink', kind: 'sink', levelId: 'level-ground', position: { x: W - gH - 450, y: gH + 350, z: 0 }, rotationDeg: 0, size: { x: 600, y: 500, z: 900 }, connections: [], evidence: ev('Concept placement.') },
    { id: 'fixture-toilet', name: 'Toilet', kind: 'toilet', levelId: 'level-upper', position: { x: uH + 450, y: uH + 450, z: upperZ }, rotationDeg: 0, size: { x: 400, y: 700, z: 750 }, connections: [], evidence: ev('Concept placement.') },
    { id: 'fixture-bath-sink', name: 'Bath Sink', kind: 'sink', levelId: 'level-upper', position: { x: s.bathX - pf - 500, y: uH + 300, z: upperZ }, rotationDeg: 0, size: { x: 600, y: 450, z: 850 }, connections: [], evidence: ev('Concept placement.') }
  ];
  const M = s.mat;
  const beams = [
    { id: 'beam-floor', levelId: 'level-ground', start: { x: 0, y: D / 2 }, end: { x: W, y: D / 2 }, topElevationMm: beamTop, shape: s.beam, materialId: 'mat-steel', designation: s.beamName, evidence: ev('Concept steel beam carrying the upper floor; size is a placeholder.') },
    { id: 'beam-ridge', levelId: 'level-upper', start: { x: 0, y: D / 2 }, end: { x: W, y: D / 2 }, topElevationMm: s.ridgeBeamTop, shape: s.ridgeBeam, materialId: 'mat-glulam', designation: s.ridgeBeamName, evidence: ev('Concept glulam ridge beam; size is a placeholder.') }
  ];
  const columns = [
    ...[W / 3, (2 * W) / 3].map((x, i) => ({ id: `column-shop-${i + 1}`, levelId: 'level-ground', position: { x: Math.round(x), y: D / 2 }, rotationDeg: 0, baseElevationMm: 0, topElevationMm: beamBottom, shape: s.column, materialId: 'mat-steel', designation: s.columnName, evidence: ev('Concept steel column; size is a placeholder.') })),
    { id: 'column-ridge-post', levelId: 'level-upper', position: { x: W / 2, y: D / 2 }, rotationDeg: 0, baseElevationMm: upperZ, topElevationMm: s.ridgeBeamTop - s.ridgeBeam.depthMm, shape: s.post, materialId: 'mat-lumber', designation: s.postName, evidence: ev('Concept timber post under the ridge beam.') }
  ];
  const so = s.stemOuter, si = s.stemInner, fo = s.footOuter, fi = s.footInner;
  const stem = (id, b) => ({ id, kind: 'stem-wall', boundary: b, topElevationMm: 0, depthMm: s.stemDepth, materialId: 'mat-concrete-reinforced', evidence: ev('Concept foundation wall; frost depth assumed.') });
  const foot = (id, b) => ({ id, kind: 'strip-footing', boundary: b, topElevationMm: -s.stemDepth, depthMm: s.footDepth, materialId: 'mat-concrete-reinforced', evidence: ev('Concept strip footing; bearing capacity unknown.') });
  const foundations = [
    stem('foundation-stem-south', rect(-so, -so, W + so, si)), stem('foundation-stem-north', rect(-so, D - si, W + so, D + so)),
    stem('foundation-stem-west', rect(-so, si, si, D - si)), stem('foundation-stem-east', rect(W - si, si, W + so, D - si)),
    foot('foundation-footing-south', rect(-fo, -fo, W + fo, fi)), foot('foundation-footing-north', rect(-fo, D - fi, W + fo, D + fo)),
    foot('foundation-footing-west', rect(-fo, fi, fi, D - fi)), foot('foundation-footing-east', rect(W - fi, fi, W + fo, D - fi)),
    ...columns.slice(0, 2).map((c, i) => ({ id: `foundation-pad-${i + 1}`, kind: 'pad-footing', boundary: rect(c.position.x - s.pad / 2, c.position.y - s.pad / 2, c.position.x + s.pad / 2, c.position.y + s.pad / 2), topElevationMm: -slabG, depthMm: s.padDepth, materialId: 'mat-concrete-reinforced', evidence: ev('Concept pad footing under a steel column.') }))
  ];
  const A = s.apron, K = s.walk, door = s.o.shopDoor;
  const wx0 = W + gH, wx1 = wx0 + K.pad, wx2 = wx1 - K.leg, wyTop = door.offset + door.width + K.margin, wyBot = door.offset - K.margin;
  const surfaces = [
    { id: 'surface-apron', name: 'Concrete Apron', levelId: 'level-ground', boundary: rect(A.x0, -gH - A.depth, A.x1, -gH), topElevationMm: 0, thicknessMm: A.thickness, materialId: 'mat-concrete', evidence: ev('Concept apron at the overhead door.') },
    { id: 'surface-apron-base', name: 'Apron Base Course', levelId: 'level-ground', boundary: rect(A.x0, -gH - A.depth, A.x1, -gH), topElevationMm: -A.thickness, thicknessMm: A.base, materialId: 'mat-gravel', evidence: ev('Concept compacted gravel base under the apron.') },
    { id: 'surface-drip-edge', name: 'Gravel Drip Edge', levelId: 'level-ground', boundary: rect(-gH, -gH - A.drip, A.x0, -gH), topElevationMm: 0, thicknessMm: A.dripThickness, materialId: 'mat-gravel', evidence: ev('Concept gravel strip along the south wall.') },
    { id: 'surface-shop-walk', name: 'Shop Door Walk', levelId: 'level-ground', boundary: [{ x: wx0, y: wyBot }, { x: wx2, y: wyBot }, { x: wx2, y: -gH }, { x: wx1, y: -gH }, { x: wx1, y: wyTop }, { x: wx0, y: wyTop }], topElevationMm: 0, thicknessMm: A.thickness, materialId: 'mat-concrete', evidence: ev('Concept L-shaped walk from the shop door to the drive.') }
  ];
  const dimensions = [
    { id: 'dimension-width', kind: 'horizontal', from: { x: 0, y: 0, z: 0 }, to: { x: W, y: 0, z: 0 }, offsetMm: s.dimSouth },
    { id: 'dimension-depth', kind: 'vertical', from: { x: W, y: 0, z: 0 }, to: { x: W, y: D, z: 0 }, offsetMm: gH + K.pad + 400 },
    { id: 'dimension-upper-width', kind: 'horizontal', from: { x: 0, y: 0, z: upperZ }, to: { x: W, y: 0, z: upperZ }, offsetMm: s.dimSouth },
    { id: 'dimension-ridge', kind: 'elevation', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: s.ridge }, offsetMm: -1000 }
  ];
  const sections = [
    { id: 'section-aa', name: 'Transverse Section A-A', start: { x: s.sectionAX, y: -gH - A.depth - 250 }, end: { x: s.sectionAX, y: D + 600 }, lookDirection: 'left' },
    { id: 'section-bb', name: 'Longitudinal Section B-B', start: { x: -600, y: s.sectionBY }, end: { x: W + gH + K.pad + 600, y: s.sectionBY }, lookDirection: 'right' }
  ];
  const assumptions = [
    { id: 'assumption-site', topic: 'site', statement: 'No survey, setbacks, soils report, or utility locations are known for this synthetic fixture.', impact: 'high', affectedEntityIds: [], evidence: fixed('Fixture intentionally excludes survey data.') },
    { id: 'assumption-structure', topic: 'structure', statement: 'Beam, column, post, and header sizes are placeholders that exercise the drawings; a structural engineer must size every member and connection.', impact: 'high', affectedEntityIds: ['beam-floor', 'beam-ridge', 'column-shop-1', 'column-shop-2', 'column-ridge-post'], evidence: fixed('Fixture exercises material display, not structural design.') },
    { id: 'assumption-foundation', topic: 'foundation', statement: s.frostNote, impact: 'medium', affectedEntityIds: foundations.map(f => f.id), evidence: ev('Assumed frost depth; verify locally.', 0.4) },
    { id: 'assumption-veneer', topic: 'envelope', statement: 'Brick veneer bears on the masonry below; ties, flashing, weeps, and the drainage cavity are not modelled.', impact: 'medium', affectedEntityIds: ['wall-u-south', 'wall-u-east', 'wall-u-north', 'wall-u-west'], evidence: ev('Concept envelope only.') }
  ];
  return {
    schemaVersion: '1.0.0',
    project: { id: s.id, name: s.name, status: 'study', description: s.description, coordinates: { unit: 'mm', origin: { x: 0, y: 0, z: 0 }, siteDatumMm: 0, trueNorthDeg: 0, toleranceMm: 3, displayUnits: s.units }, jurisdiction: s.jurisdiction },
    materials: M, site: { groundMaterialId: 'mat-earth' },
    levels, spaces, walls, openings, slabs, roofs, stairs, fixtures, equipment: [], systems: [],
    beams, columns, foundations, surfaces, dimensions, sections, viewpoints: [], assumptions
  };
}

// Catalog names carry illustrative grades; the evidence says so rather than implying a specification.
const mat = (id, name, category) => ({ id, name, category, evidence: ev('Synthetic fixture material; any grade in the name is illustrative, not specified.') });
const L = (id, materialId, thicknessMm) => ({ id, materialId, thicknessMm });
const inch = n => Math.round(n * 25.4);

const imperial = {
  id: 'mixed-material-workshop', name: 'Mixed-Material Workshop', units: 'feet-inches',
  description: 'Synthetic imperial fixture for material display: CMU shop on concrete foundations with a steel beam and columns, a wood-frame studio with brick veneer above, seven header types, gravel, and site surfaces.',
  jurisdiction: { country: 'United States', stateOrRegion: 'Example State', locality: 'Example Township', codeReviewStatus: 'unavailable' },
  W: inch(360), D: inch(240), f2f: 3200, upperWallHeight: inch(96), ridge: inch(96) + 3200 + Math.round(inch(120) / 2),
  overhang: inch(12),
  mat: [
    mat('mat-earth', 'Undisturbed earth', 'earth'), mat('mat-gravel', 'Crushed stone, 3/4" clean', 'gravel'),
    mat('mat-concrete', 'Concrete, 4000 psi', 'concrete'), mat('mat-concrete-reinforced', 'Reinforced concrete', 'reinforced-concrete'),
    mat('mat-cmu', 'Concrete masonry unit, 8"', 'concrete-masonry'), mat('mat-brick', 'Brick veneer', 'brick'),
    mat('mat-steel', 'Structural steel', 'steel'), mat('mat-lumber', 'Sawn lumber, SPF', 'wood-framing'),
    mat('mat-glulam', 'Glued laminated timber', 'engineered-wood'), mat('mat-lvl', 'Laminated veneer lumber', 'engineered-wood'),
    mat('mat-sheathing', 'OSB sheathing', 'engineered-wood'), mat('mat-subfloor', 'Plywood subfloor', 'engineered-wood'),
    mat('mat-batt', 'Fiberglass batt insulation', 'insulation-batt'), mat('mat-rigid', 'XPS rigid insulation', 'insulation-rigid'),
    mat('mat-gypsum', 'Gypsum board', 'gypsum')
  ],
  groundWall: [L('gypsum', 'mat-gypsum', 16), L('insulation', 'mat-rigid', 38), L('cmu', 'mat-cmu', 194)],
  upperWall: [L('gypsum', 'mat-gypsum', 16), L('studs', 'mat-batt', 140), L('sheathing', 'mat-sheathing', 11), L('insulation', 'mat-rigid', 25), L('veneer', 'mat-brick', 92)],
  partition: [L('gypsum-left', 'mat-gypsum', 13), L('studs', 'mat-lumber', 89), L('gypsum-right', 'mat-gypsum', 13)],
  groundSlab: [L('slab', 'mat-concrete', 102), L('insulation', 'mat-rigid', 51), L('base', 'mat-gravel', 152)],
  upperSlab: [L('subfloor', 'mat-subfloor', 19), L('joists', 'mat-lumber', 241), L('ceiling', 'mat-gypsum', 16)],
  stemOuter: 124, stemInner: 79, stemDepth: inch(30), footOuter: 276, footInner: 232, footDepth: inch(10), pad: inch(30), padDepth: inch(12),
  beam: { kind: 'wide-flange', widthMm: 133, depthMm: 207, flangeThicknessMm: 8, webThicknessMm: 6 }, beamName: 'W8x18',
  column: { kind: 'hss', widthMm: 102, depthMm: 102, wallThicknessMm: 6 }, columnName: 'HSS4x4x1/4',
  ridgeBeam: { kind: 'rectangular', widthMm: 79, depthMm: 305 }, ridgeBeamName: '3-1/8" x 12" glulam', ridgeBeamTop: 7010,
  post: { kind: 'rectangular', widthMm: 140, depthMm: 140 }, postName: '6x6',
  officeX: inch(144), bathX: inch(108), bathY: inch(96),
  stair: { x0: 4150, y: inch(240) - 124 - 457, width: inch(36), risers: 17, tread: inch(10) },
  o: {
    officeWindow: { offset: inch(48), width: inch(48), height: inch(48), sill: inch(42) },
    overhead: { offset: inch(180), width: inch(120), height: inch(96) },
    shopDoor: { offset: inch(150), width: inch(36), height: inch(80) },
    shopWindow: { offset: inch(84), width: inch(48), height: inch(36), sill: inch(60) },
    officeWest: { offset: inch(60), width: inch(36), height: inch(48), sill: inch(42) },
    officeDoor: { offset: inch(144), width: inch(36), height: inch(80) },
    studioWindow: { offset: inch(216), width: inch(72), height: inch(48), sill: inch(36) },
    studioSmall: { offset: inch(144), width: inch(36), height: inch(48), sill: inch(36) },
    studioEast: { offset: inch(144), width: inch(36), height: inch(42), sill: inch(42) },
    studioNorth: { offset: inch(84), width: inch(48), height: inch(48), sill: inch(36) },
    studioWest: { offset: inch(54), width: inch(36), height: inch(48), sill: inch(36) },
    bathDoor: { offset: inch(48), width: inch(30), height: inch(80) }
  },
  headers: {
    officeWindow: { kind: 'steel-angle', layerId: 'cmu', depthMm: 102, widthMm: 89, legThicknessMm: 8, bearingMm: 203, materialId: 'mat-steel', designation: 'L4x3-1/2x5/16 pair' },
    overhead: { kind: 'steel-beam', layerId: 'cmu', depthMm: 207, widthMm: 133, flangeThicknessMm: 8, webThicknessMm: 6, bearingMm: 203, materialId: 'mat-steel', designation: 'W8x18' },
    shopDoor: { kind: 'concrete-lintel', layerId: 'cmu', depthMm: 194, bearingMm: 203, materialId: 'mat-concrete-reinforced', designation: '8" precast lintel' },
    shopWindow: { kind: 'masonry-bond-beam', layerId: 'cmu', depthMm: 203, bearingMm: 406, materialId: 'mat-cmu', designation: '8" bond beam, 2-#5' },
    officeDoor: { kind: 'sawn-lumber', layerId: 'studs', depthMm: 140, bearingMm: 38, materialId: 'mat-lumber', designation: '2x6' },
    studioWindow: { kind: 'built-up-lumber', layerId: 'studs', depthMm: 235, plies: 3, bearingMm: 76, materialId: 'mat-lumber', designation: '3-2x10' },
    studioSmall: { kind: 'built-up-lumber', layerId: 'studs', depthMm: 184, plies: 2, bearingMm: 38, materialId: 'mat-lumber', designation: '2-2x8' },
    studioEast: { kind: 'sawn-lumber', layerId: 'studs', depthMm: 184, bearingMm: 38, materialId: 'mat-lumber', designation: '4x8' },
    studioNorth: { kind: 'engineered-lumber', layerId: 'studs', depthMm: 235, bearingMm: 38, materialId: 'mat-lvl', designation: '1-3/4" x 9-1/4" LVL' },
    angle: { kind: 'steel-angle', layerId: 'veneer', depthMm: 102, widthMm: 89, legThicknessMm: 8, bearingMm: 203, materialId: 'mat-steel', designation: 'L4x3-1/2x5/16' },
    bathDoor: { kind: 'sawn-lumber', layerId: 'studs', depthMm: 140, bearingMm: 38, materialId: 'mat-lumber', designation: '2x6' }
  },
  apron: { x0: inch(174), x1: inch(306), depth: inch(48), thickness: inch(5), base: inch(6), drip: inch(18), dripThickness: inch(4) },
  walk: { pad: inch(72), leg: inch(36), margin: inch(6) },
  dimSouth: 1900, sectionAX: inch(252), sectionBY: inch(165),
  frostNote: 'Footings assume a 30 in frost depth. Verify the local frost depth and soil bearing.'
};

const metric = {
  id: 'mixed-material-workshop-metric', name: 'Mixed-Material Workshop (Metric)', units: 'metric',
  description: 'Synthetic metric companion to mixed-material-workshop: the same layout in metric sizes, for comparing the ISO-informed material hatching with the NCS-informed one.',
  jurisdiction: { country: 'Example Country', stateOrRegion: 'Example Region', locality: 'Example Municipality', codeReviewStatus: 'unavailable' },
  W: 9000, D: 6000, f2f: 3200, upperWallHeight: 2400, ridge: 3200 + 2400 + 1732, overhang: 400,
  mat: [
    mat('mat-earth', 'Natural ground', 'earth'), mat('mat-gravel', 'Gravel 16/32', 'gravel'),
    mat('mat-concrete', 'Concrete C25/30', 'concrete'), mat('mat-concrete-reinforced', 'Reinforced concrete C30/37', 'reinforced-concrete'),
    mat('mat-cmu', 'Concrete block 175', 'concrete-masonry'), mat('mat-brick', 'Facing brick 115', 'brick'),
    mat('mat-steel', 'Structural steel S355', 'steel'), mat('mat-lumber', 'Solid timber C24', 'wood-framing'),
    mat('mat-glulam', 'Glulam GL24h', 'engineered-wood'), mat('mat-lvl', 'Laminated veneer lumber', 'engineered-wood'),
    mat('mat-sheathing', 'OSB/3 sheathing', 'engineered-wood'), mat('mat-subfloor', 'OSB/3 floor deck', 'engineered-wood'),
    mat('mat-batt', 'Mineral wool batt', 'insulation-batt'), mat('mat-rigid', 'XPS insulation board', 'insulation-rigid'),
    mat('mat-gypsum', 'Gypsum plasterboard', 'gypsum')
  ],
  groundWall: [L('gypsum', 'mat-gypsum', 15), L('insulation', 'mat-rigid', 50), L('cmu', 'mat-cmu', 175)],
  upperWall: [L('gypsum', 'mat-gypsum', 15), L('studs', 'mat-batt', 160), L('sheathing', 'mat-sheathing', 16), L('insulation', 'mat-rigid', 60), L('veneer', 'mat-brick', 115)],
  partition: [L('gypsum-left', 'mat-gypsum', 15), L('studs', 'mat-lumber', 100), L('gypsum-right', 'mat-gypsum', 15)],
  groundSlab: [L('slab', 'mat-concrete-reinforced', 150), L('insulation', 'mat-rigid', 100), L('base', 'mat-gravel', 200)],
  upperSlab: [L('subfloor', 'mat-subfloor', 22), L('joists', 'mat-lumber', 220), L('ceiling', 'mat-gypsum', 15)],
  stemOuter: 120, stemInner: 80, stemDepth: 800, footOuter: 270, footInner: 230, footDepth: 300, pad: 800, padDepth: 300,
  beam: { kind: 'wide-flange', widthMm: 200, depthMm: 190, flangeThicknessMm: 10, webThicknessMm: 7 }, beamName: 'HEA 200',
  column: { kind: 'hss', widthMm: 100, depthMm: 100, wallThicknessMm: 5 }, columnName: 'SHS 100x100x5',
  ridgeBeam: { kind: 'rectangular', widthMm: 120, depthMm: 320 }, ridgeBeamName: 'GL24h 120 x 320', ridgeBeamTop: 7200,
  post: { kind: 'rectangular', widthMm: 140, depthMm: 140 }, postName: 'C24 140 x 140',
  officeX: 3600, bathX: 2700, bathY: 2400,
  stair: { x0: 4000, y: 6000 - 120 - 450, width: 900, risers: 18, tread: 260 },
  o: {
    officeWindow: { offset: 1200, width: 1200, height: 1200, sill: 1000 },
    overhead: { offset: 4500, width: 3000, height: 2500 },
    shopDoor: { offset: 3800, width: 1000, height: 2100 },
    shopWindow: { offset: 2100, width: 1200, height: 900, sill: 1500 },
    officeWest: { offset: 1500, width: 1000, height: 1200, sill: 1000 },
    officeDoor: { offset: 3600, width: 900, height: 2100 },
    studioWindow: { offset: 5400, width: 1800, height: 1200, sill: 900 },
    studioSmall: { offset: 3600, width: 900, height: 1200, sill: 900 },
    studioEast: { offset: 3600, width: 1000, height: 1000, sill: 1000 },
    studioNorth: { offset: 2100, width: 1200, height: 1200, sill: 900 },
    studioWest: { offset: 1400, width: 1000, height: 1200, sill: 900 },
    bathDoor: { offset: 1200, width: 800, height: 2100 }
  },
  headers: {
    officeWindow: { kind: 'steel-angle', layerId: 'cmu', depthMm: 100, widthMm: 75, legThicknessMm: 8, bearingMm: 200, materialId: 'mat-steel', designation: 'L 100x75x8 pair' },
    overhead: { kind: 'steel-beam', layerId: 'cmu', depthMm: 152, widthMm: 160, flangeThicknessMm: 9, webThicknessMm: 6, bearingMm: 200, materialId: 'mat-steel', designation: 'HEA 160' },
    shopDoor: { kind: 'concrete-lintel', layerId: 'cmu', depthMm: 175, bearingMm: 200, materialId: 'mat-concrete-reinforced', designation: 'Precast lintel 175' },
    shopWindow: { kind: 'masonry-bond-beam', layerId: 'cmu', depthMm: 240, bearingMm: 250, materialId: 'mat-cmu', designation: 'U-block bond beam' },
    officeDoor: { kind: 'sawn-lumber', layerId: 'studs', depthMm: 120, bearingMm: 50, materialId: 'mat-lumber', designation: 'Timber 100 x 120' },
    studioWindow: { kind: 'built-up-lumber', layerId: 'studs', depthMm: 200, plies: 3, bearingMm: 80, materialId: 'mat-lumber', designation: '3 x 50 x 200' },
    studioSmall: { kind: 'built-up-lumber', layerId: 'studs', depthMm: 160, plies: 2, bearingMm: 50, materialId: 'mat-lumber', designation: '2 x 60 x 160' },
    studioEast: { kind: 'sawn-lumber', layerId: 'studs', depthMm: 200, bearingMm: 50, materialId: 'mat-lumber', designation: 'Timber 160 x 200' },
    studioNorth: { kind: 'engineered-lumber', layerId: 'studs', depthMm: 240, bearingMm: 50, materialId: 'mat-lvl', designation: 'LVL 75 x 240' },
    angle: { kind: 'steel-angle', layerId: 'veneer', depthMm: 100, widthMm: 100, legThicknessMm: 8, bearingMm: 200, materialId: 'mat-steel', designation: 'L 100x100x8' },
    bathDoor: { kind: 'sawn-lumber', layerId: 'studs', depthMm: 120, bearingMm: 50, materialId: 'mat-lumber', designation: 'Timber 100 x 120' }
  },
  apron: { x0: 4350, x1: 7650, depth: 1200, thickness: 150, base: 200, drip: 500, dripThickness: 100 },
  walk: { pad: 1800, leg: 900, margin: 150 },
  dimSouth: 1900, sectionAX: 6200, sectionBY: 4100,
  frostNote: 'Footings assume an 800 mm frost depth. Verify the local frost depth and soil bearing.'
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
      if (current !== next) { stale += 1; console.error(`${path.relative(EXAMPLES, file)} is stale. Run examples/build-mixed-material-workshop.mjs.`); }
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, next);
      console.log(`Wrote ${path.relative(EXAMPLES, file)}.`);
    }
  }
  if (stale) process.exitCode = 1;
}