// Regenerate the synthetic barn study with `node examples/build-lakeside-barn-residence.mjs`.
// Use --check to detect a stale checked-in model.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../scripts/lib.mjs';

const ft = value => Math.round(value * 304.8);
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const evidence = (note, reference) => ({
  source: reference ? 'heuristic' : 'generated', confidence: 0.6, status: 'needs-review',
  ...(reference ? { reference } : {}), note
});
const G = 'level-ground', U = 'level-upper';

export function buildLakesideBarnResidence() {
  const W = ft(36), D = ft(48), Z = 3600, half = Math.round(W / 2);
  const livingEnd = ft(24), bedroomStart = ft(36), hallStart = ft(32), bathEnd = ft(10);
  // Nominal wood-frame assemblies, interior to exterior. The siding type is not chosen yet, so it is an
  // unspecified material; the sheathing behind it is ordinary wood structural panel.
  const layer = (id, materialId, thicknessMm) => ({ id, materialId, thicknessMm });
  const exteriorAssembly = [layer('gypsum', 'mat-gypsum', 13), layer('studs', 'mat-batt', 140), layer('sheathing', 'mat-sheathing', 12), layer('siding', 'mat-siding', 19)];
  const partitionAssembly = [layer('gypsum-left', 'mat-gypsum', 13), layer('studs', 'mat-timber', 90), layer('gypsum-right', 'mat-gypsum', 13)];
  const thickness = layers => layers.reduce((sum, item) => sum + item.thicknessMm, 0);
  // Room boundaries sit on finished faces: half of each wall's thickness from its centreline.
  const face = thickness(exteriorAssembly) / 2, partition = thickness(partitionAssembly) / 2, ceiling = 2800;
  // Objects placed against an exterior wall keep the clearance they had from the 300 mm allowance's face.
  const fromFace = distance => face + distance;
  const deckStart = ft(26), deckEnd = bedroomStart, deckInner = W + face, deckOuter = deckInner + ft(8);
  const stairX = Math.round((deckInner + deckOuter) / 2), stairRun = 19 * 280, stairStart = deckStart - stairRun;
  const levels = [
    { id: G, name: 'Workshop', elevationMm: 0, floorToFloorMm: Z, evidence: evidence('Synthetic workshop datum; 3250 mm below the floor assembly.') },
    { id: U, name: 'Residence', elevationMm: Z, floorToFloorMm: ceiling, evidence: evidence('Synthetic residence and deck datum.') }
  ];
  const walls = [];
  function wall(id, levelId, start, end, kind = 'interior') {
    const heightMm = levelId === G ? Z - 350 : ceiling, layers = kind === 'exterior' ? exteriorAssembly : partitionAssembly;
    walls.push({ id, levelId, start, end, kind, thicknessMm: thickness(layers), heightMm,
      ...(kind === 'exterior' ? { layerOrder: 'interior-to-exterior' } : {}), layers: layers.map(item => ({ ...item })),
      evidence: evidence(kind === 'exterior'
        ? 'Concept 2x6 wall: gypsum, batt-filled stud cavity, wood structural panel sheathing, and siding of a type not yet chosen. Not a specified or fire-rated assembly.'
        : 'Concept 2x4 stud partition with gypsum both sides. Not a fire-rated or acoustic assembly.') });
  }
  for (const [prefix, level] of [['g', G], ['u', U]]) {
    wall(`wall-${prefix}-south`, level, { x: 0, y: 0 }, { x: W, y: 0 }, 'exterior');
    wall(`wall-${prefix}-east`, level, { x: W, y: 0 }, { x: W, y: D }, 'exterior');
    wall(`wall-${prefix}-north`, level, { x: W, y: D }, { x: 0, y: D }, 'exterior');
    wall(`wall-${prefix}-west`, level, { x: 0, y: D }, { x: 0, y: 0 }, 'exterior');
  }
  wall('wall-g-core-south', G, { x: 0, y: livingEnd }, { x: half, y: livingEnd });
  wall('wall-g-core-east', G, { x: half, y: livingEnd }, { x: half, y: D });
  wall('wall-g-core-north', G, { x: 0, y: bedroomStart }, { x: half, y: bedroomStart });
  wall('wall-u-living', U, { x: 0, y: livingEnd }, { x: W, y: livingEnd });
  wall('wall-u-service-north', U, { x: 0, y: hallStart }, { x: half, y: hallStart });
  wall('wall-u-bath-east', U, { x: bathEnd, y: livingEnd }, { x: bathEnd, y: hallStart });
  wall('wall-u-laundry-east', U, { x: half, y: livingEnd }, { x: half, y: hallStart });
  wall('wall-u-bedroom-south', U, { x: 0, y: bedroomStart }, { x: W, y: bedroomStart });
  wall('wall-u-bedroom-divider', U, { x: half, y: bedroomStart }, { x: half, y: D });
  const spaces = [];
  function room(id, name, levelId, use, boundary) {
    spaces.push({ id, name, levelId, use, boundary, evidence: evidence('Synthetic room bounded by finished wall faces; furniture and access are coordinated concept allowances.') });
  }
  room('space-workshop', 'Workshop', G, 'two vehicle bays and rear workbench', [
    { x: face, y: face }, { x: W - face, y: face }, { x: W - face, y: D - face },
    { x: half + partition, y: D - face }, { x: half + partition, y: livingEnd - partition }, { x: face, y: livingEnd - partition }
  ]);
  room('space-utility', 'Utility', G, 'equipment and wash sink', rect(face, livingEnd + partition, half - partition, bedroomStart - partition));
  room('space-tool-store', 'Tool Store', G, 'workshop storage', rect(face, bedroomStart + partition, half - partition, D - face));
  room('space-great-room', 'Living / Kitchen', U, 'living, dining, and kitchen', rect(face, face, W - face, livingEnd - partition));
  room('space-bath', 'Bath', U, 'bathroom', rect(face, livingEnd + partition, bathEnd - partition, hallStart - partition));
  room('space-laundry', 'Laundry', U, 'laundry', rect(bathEnd + partition, livingEnd + partition, half - partition, hallStart - partition));
  room('space-hall', 'Entry / Hall', U, 'residential entry and bedroom corridor', [
    { x: face, y: hallStart + partition }, { x: half + partition, y: hallStart + partition },
    { x: half + partition, y: livingEnd + partition }, { x: W - face, y: livingEnd + partition },
    { x: W - face, y: bedroomStart - partition }, { x: face, y: bedroomStart - partition }
  ]);
  room('space-bedroom', 'Bedroom 1', U, 'sleeping', rect(face, bedroomStart + partition, half - partition, D - face));
  room('space-bedroom-2', 'Bedroom 2', U, 'sleeping', rect(half + partition, bedroomStart + partition, W - face, D - face));

  const openings = [];
  // Specify a physical centre; derive offsets even on north/west walls drawn in reverse.
  function opening(id, wallId, kind, centre, widthMm, heightMm = 2300, sillMm = 0, swing = 'none') {
    const host = walls.find(item => item.id === wallId);
    const axis = host.start.x === host.end.x ? 'y' : 'x';
    const sign = Math.sign(host.end[axis] - host.start[axis]);
    openings.push({ id, wallId, kind, offsetMm: Math.round(sign * (centre - host.start[axis]) - widthMm / 2),
      widthMm, heightMm, sillMm, swing, evidence: evidence('Synthetic opening; operation, safety glazing, headers, and egress performance require design review.') });
  }
  for (const [side, x] of [['west', Math.round(W / 4)], ['east', Math.round(3 * W / 4)]]) {
    opening(`opening-overhead-${side}`, 'wall-g-south', 'overhead-door', x, ft(10), ft(8));
    opening(`opening-clerestory-${side}`, 'wall-g-south', 'window', x, 1800, 300, 2850);
    opening(`opening-living-${side}`, 'wall-u-south', 'window', x, 1800, 1400, 900);
    opening(`opening-rear-${side}`, 'wall-g-north', 'window', x, 1800, 1400, 900);
    opening(side === 'west' ? 'opening-bedroom-window' : 'opening-bedroom-2-window', 'wall-u-north', 'window', x, 1800, 1400, 900);
  }
  const kitchenY = Math.round(D / 3), entryY = Math.round(2 * D / 3), bathY = Math.round((livingEnd + hallStart) / 2);
  opening('opening-entry', 'wall-g-west', 'door', kitchenY, 1000, 2300, 0, 'right');
  opening('opening-kitchen-window', 'wall-u-west', 'window', kitchenY, 1800, 1400, 900);
  opening('opening-utility-window', 'wall-g-west', 'window', bathY, 900, 900, 1400);
  opening('opening-bath-window', 'wall-u-west', 'window', bathY, 900, 900, 1400);
  opening('opening-shop-east', 'wall-g-east', 'window', kitchenY, 1800, 1400, 900);
  opening('opening-shop-rear-east', 'wall-g-east', 'window', entryY, 1000, 1400, 900);
  opening('opening-living-side-east', 'wall-u-east', 'window', kitchenY, 1800, 1400, 900);
  opening('opening-residence-entry', 'wall-u-east', 'door', entryY, 1000, 2300, 0, 'left');
  opening('opening-utility-door', 'wall-g-core-east', 'door', 9000, 1000, 2300, 0, 'right');
  opening('opening-store-door', 'wall-g-core-east', 'door', 12800, 1000, 2300, 0, 'right');
  opening('opening-living-hall', 'wall-u-living', 'opening', 8200, 1600);
  opening('opening-bath-door', 'wall-u-service-north', 'door', 2300, 900, 2100, 0, 'sliding');
  opening('opening-laundry-door', 'wall-u-service-north', 'door', 4550, 900, 2100, 0, 'sliding');
  opening('opening-bedroom-door', 'wall-u-bedroom-south', 'door', 2100, 900, 2100, 0, 'left');
  opening('opening-bedroom-2-door', 'wall-u-bedroom-south', 'door', 7600, 900, 2100, 0, 'left');

  const fixtures = [], equipment = [];
  function object(target, id, name, kind, levelId, x, y, sx, sy, sz, rotationDeg = 0, reference) {
    const value = { id, name, kind, levelId, position: { x, y, z: levelId === U ? Z : 0 }, rotationDeg,
      size: { x: sx, y: sy, z: sz }, connections: [], evidence: evidence('Illustrative footprint; verify manufacturer dimensions and service/operating clearances.', reference) };
    target.push(value);
    return value;
  }
  const wet = [
    object(fixtures, 'fixture-shop-sink', 'Utility Sink', 'utility-sink', G, fromFace(300), bathY, 700, 600, 900, 90, 'MEP-P1; IRC 2021 P2705'),
    object(fixtures, 'fixture-kitchen-sink', 'Kitchen Sink', 'kitchen-sink', U, fromFace(300), kitchenY, 900, 600, 900, 90, 'COMP-I1; MEP placement guide, NKBA kitchen design practice'),
    object(fixtures, 'fixture-upper-bath', 'Vanity', 'lavatory', U, fromFace(300), bathY, 900, 550, 850, 90, 'MEP-P1; IRC 2021 P2705'),
    object(fixtures, 'fixture-toilet', 'Toilet', 'toilet', U, 1500, 9300, 400, 700, 750, 180, 'MEP-P1; IRC 2021 R307.1'),
    object(fixtures, 'fixture-shower', 'Shower', 'shower', U, 2500, 7900, 900, 900, 100, 0, 'MEP-P2; IRC 2021 P2708.1'),
    object(fixtures, 'fixture-washer', 'Washer', 'washer', U, 3550, 7800, 700, 750, 1000, 0, 'MEP-P4; IRC 2021 P2706.2'),
    object(fixtures, 'fixture-dishwasher', 'Dishwasher', 'dishwasher', U, fromFace(325), 5700, 650, 650, 900, 90, 'MEP placement guide, NKBA kitchen design practice')
  ];
  object(fixtures, 'fixture-dryer', 'Electric Dryer', 'dryer', U, 4550, 7800, 700, 750, 1000);
  object(fixtures, 'fixture-range', 'Electric Range', 'range', U, 2200, 6875, 760, 650, 900);
  object(fixtures, 'fixture-refrigerator', 'Refrigerator', 'refrigerator', U, fromFace(400), 6500, 800, 800, 1850, 90);
  object(fixtures, 'fixture-counter', 'Prep Counter', 'counter', U, 3670, 6945, 2000, 600, 900);
  object(fixtures, 'fixture-island', 'Prep Island', 'counter', U, 3000, 4900, 1800, 900, 900);
  object(fixtures, 'fixture-dining', 'Dining Table', 'table', U, 8200, 5200, 1800, 950, 750);
  object(fixtures, 'fixture-sofa', 'Sofa', 'sofa', U, 3300, 1800, 2400, 950, 850);
  for (const [suffix, x] of [['1', 2700], ['2', 8200]]) {
    object(fixtures, `fixture-bed-${suffix}`, `Bed ${suffix}`, 'bed', U, x, 13200, 1630, 2030, 600);
    object(fixtures, `fixture-wardrobe-${suffix}`, `Wardrobe ${suffix}`, 'wardrobe', U, x + 1800, 11400, 1500, 600, 2200);
  }
  object(fixtures, 'fixture-workbench', 'Workbench', 'workbench', G, 8700, D - fromFace(400), 3000, 800, 900);
  object(fixtures, 'fixture-tool-shelves', 'Tool Shelves', 'shelving', G, fromFace(350), 12900, 600, 2400, 2100);
  const panel = object(equipment, 'equipment-panel', 'Electrical Panel', 'electrical-panel', G, half - 220, 10300, 500, 180, 900, 90, 'MEP-E1; NEC 110.26');
  panel.position.z = 1000;
  const heater = object(equipment, 'equipment-water-heater', 'Electric Water Heater', 'water-heater', G, 1100, 8000, 650, 650, 1500, 0, 'MEP-P5; IRC 2021 P2801');
  const heatPump = object(equipment, 'equipment-heat-pump', 'Dwelling Heat Pump', 'heat-pump', G, -850, 6500, 1000, 500, 900);
  heatPump.evidence.note = 'Dwelling-only multi-split allowance; reserve access on the open west side. Workshop has no shared air distribution.';

  const systems = [];
  function system(id, discipline, name) {
    const value = { id, discipline, name, status: 'concept', nodes: [], edges: [],
      evidence: evidence('Concept coordination only; loads, sizes, protection, penetrations, and local applicability remain unresolved.') };
    systems.push(value);
    return value;
  }
  function node(system, id, kind, levelId, x, y, height, reference, note = 'Concept placement; verify the applicable edition and final installation.') {
    const value = { id, kind, levelId, position: { x, y, z: (levelId === U ? Z : 0) + height }, evidence: evidence(note, reference) };
    system.nodes.push(value);
    return value;
  }
  function connect(system, id, from, to, note, via = []) {
    const points = [from.position, ...via, to.position], route = [{ ...points[0] }];
    for (const point of points.slice(1)) {
      for (const axis of ['z', 'x', 'y']) if (route.at(-1)[axis] !== point[axis]) route.push({ ...route.at(-1), [axis]: point[axis] });
    }
    system.edges.push({ id, from: from.id, to: to.id, path: route, nominalSize: 'unverified', evidence: evidence(note) });
  }
  const water = system('system-plumbing', 'plumbing', 'Water Supply');
  const main = node(water, 'plumbing-entry', 'main-shutoff', G, 1500, 8500, 700, 'MEP-P6; IRC 2021 P2903.9');
  const riser = node(water, 'plumbing-stack', 'vertical-stack', U, 1500, 8500, 600, 'MEP concept rules; stacked wet services');
  connect(water, 'plumbing-edge-entry-stack', main, riser, 'Reserved vertical supply riser below the bathroom; no waste or vent service is implied.');
  for (const item of wet) {
    const suffix = item.id.replace('fixture-', '');
    const port = node(water, `plumbing-${suffix}`, 'fixture-connection', item.levelId, item.position.x, item.position.y, 600, 'MEP-P6; IRC 2021 P2903.9');
    item.connections.push(port.id);
    connect(water, item.id === 'fixture-kitchen-sink' ? 'plumbing-edge-kitchen' : `plumbing-edge-${suffix}`, item.levelId === U ? riser : main, port,
      'Concept supply branch; hot/cold separation, shutoffs, traps, waste, vents, and penetrations need trade design.');
  }
  const heaterPort = node(water, 'plumbing-water-heater', 'fixture-connection', G, heater.position.x, heater.position.y, 600, 'MEP-P5; IRC 2021 P2801');
  heater.connections.push(heaterPort.id);
  connect(water, 'plumbing-edge-heater', main, heaterPort, 'Water-heater connection allowance; hot-water distribution and relief discharge omitted.');

  const electric = system('system-electrical', 'electrical', 'Power, Lighting and Alarms');
  const ePanel = node(electric, 'electrical-panel', 'panel', G, panel.position.x, panel.position.y, 1500, 'MEP-E1; NEC 110.26');
  panel.connections.push(ePanel.id);
  const upperHub = node(electric, 'electrical-upper', 'junction-box', U, 6800, 10000, 2600, 'MEP concept rules; accessible distribution');
  connect(electric, 'electrical-edge-upper', ePanel, upperHub, 'Dwelling distribution riser; access, feeder protection, and rated penetrations unresolved.');
  function circuit(id, level, devices, note) {
    let previous = level === G ? ePanel : upperHub;
    for (const [index, [kind, x, y, height, reference]] of devices.entries()) {
      const current = node(electric, `electrical-${id}-${index + 1}`, kind, level, x, y, height, reference);
      connect(electric, `electrical-edge-${id}-${index + 1}`, previous, current, note);
      previous = current;
    }
  }
  const lighting = 'COMP-I3; MEP-E14; NEC 2023 210.70(A)';
  const switching = 'MEP-E14; NEC 2023 210.70(A)';
  const general = 'MEP-E4; NEC 2023 210.52(A)';
  function lightGrid(spaceId, count) {
    const boundary = spaces.find(item => item.id === spaceId).boundary;
    const x0 = Math.min(...boundary.map(p => p.x)), x1 = Math.max(...boundary.map(p => p.x));
    const y0 = Math.min(...boundary.map(p => p.y)), y1 = Math.max(...boundary.map(p => p.y));
    const cols = Math.round(Math.sqrt(count * (x1 - x0) / (y1 - y0))), rows = count / cols;
    return Array.from({ length: count }, (_, i) => ['light-ceiling',
      Math.round(x0 + (i % cols + 0.5) * (x1 - x0) / cols),
      Math.round(y0 + (Math.floor(i / cols) + 0.5) * (y1 - y0) / rows), 2700, lighting]);
  }
  for (const [id, spaceId, x, y, count] of [
    ['living', 'space-great-room', 9100, livingEnd - partition, 6],
    ['bedroom', 'space-bedroom', 2700, bedroomStart + partition, 1],
    ['bedroom-2', 'space-bedroom-2', 8200, bedroomStart + partition, 1],
    ['bath', 'space-bath', 2900, hallStart - partition, 1],
    ['laundry', 'space-laundry', 5150, hallStart - partition, 1]
  ]) circuit(`${id}-lighting`, U, [['switch', x, y, 1100, switching], ...lightGrid(spaceId, count)], `${id} switched lighting group; final switching and protection unresolved.`);
  circuit('hall-lighting', U, [
    ['switch-3way', W - face, entryY - 700, 1100, 'MEP-E15; NEC 2023 210.70(A)(2)'],
    ['light-ceiling', 8200, 9000, 2700, lighting], ['light-ceiling', 3500, 10360, 2700, lighting]
  ], 'Entry and corridor switched lighting; L-shaped room follows its circulation rather than a rectangular grid.');
  circuit('shop-lighting', G, [
    ['switch', face, kitchenY + 700, 1100, switching],
    ...[[2743, 1900], [8229, 1900], [2743, 5500], [8229, 5500], [8229, 9200], [8229, 12800]]
      .map(([x, y]) => ['light-ceiling', x, y, 3000, lighting])
  ], 'Workshop lighting follows the vehicle bays and rear bench; lighting levels are not calculated.');
  for (const [id, spaceId, y] of [['utility', 'space-utility', 8400], ['store', 'space-tool-store', 13500]]) {
    circuit(`${id}-lighting`, G, [['switch', half - partition, y, 1100, switching], ...lightGrid(spaceId, 1)], `${id} switched service lighting.`);
  }
  for (const [id, x0, x1] of [['bedroom', face, half - partition], ['bedroom-2', half + partition, W - face]]) {
    circuit(`${id}-outlets`, U, [
      ['receptacle', x0, 12000, 400, general], ['receptacle', x0, 14000, 400, general],
      ['receptacle', Math.round((x0 + x1) / 2), D - face, 400, general],
      ['receptacle', x1, 14000, 400, general], ['receptacle', x1, 12000, 400, general],
      ['receptacle', Math.round((x0 + x1) / 2), bedroomStart + partition, 400, general]
    ], `${id} general receptacle group; spacing, AFCI, and tamper resistance need local review.`);
  }
  circuit('living-outlets', U, [[1800, face], [5000, face], [8500, face], [W - face, 2200], [W - face, 5600], [face, 1800]]
    .map(([x, y]) => ['receptacle', x, y, 400, general]), 'Living and dining general receptacles; final furniture and spacing review required.');
  circuit('kitchen-counter', U, [[face, 4000], [face, 5300], [3200, livingEnd - partition], [4300, livingEnd - partition]]
    .map(([x, y]) => ['receptacle-gfci', x, y, 1100, 'MEP-E5; MEP-E13; NEC 2023 210.52(C)']),
  'Kitchen small-appliance groups; diagram is conceptual, not a single sized circuit.');
  circuit('bath-outlet', U, [['receptacle-gfci', face, 9000, 1100, 'MEP-E7; NEC 2023 210.52(D), 406.9(C)']], 'Vanity receptacle outside the shower zone; dedicated bathroom circuit design unresolved.');
  circuit('shop-outlets', G, [[face, 1600], [W - face, 1600], [W - face, 6000], [W - face, 12000]]
    .map(([x, y]) => ['receptacle-gfci', x, y, 1100, 'MEP-E9; MEP-E13; NEC 2023 210.52(G)']), 'Workshop receptacles; vehicle, tool and welder loads unresolved.');
  for (const [id, x, y, kind] of [['washer', 3550, livingEnd + partition, 'receptacle-gfci'], ['dryer', 4550, livingEnd + partition, 'receptacle-240v'],
    ['range', 2200, livingEnd - partition, 'receptacle-240v'], ['refrigerator', face, 6500, 'receptacle-dedicated'], ['dishwasher', face, 5700, 'receptacle-dedicated']]) {
    circuit(id, U, [[kind, x, y, 450, 'MEP-E8; MEP-E13; MEP placement guide, appliance design practice']], `${id} dedicated conceptual appliance circuit; protection and disconnect requirements unresolved.`);
    fixtures.find(item => item.id === `fixture-${id}`).connections.push(`electrical-${id}-1`);
  }
  circuit('alarms', U, [
    ['smoke-alarm', 1500, 12100, 2700, 'MEP-E19; MEP-E20; IRC 2021 R314.3'],
    ['smoke-alarm', 7000, 12100, 2700, 'MEP-E19; MEP-E20; IRC 2021 R314.3'],
    ['smoke-co-alarm', 7000, 10400, 2700, 'MEP-E19; MEP-E21; IRC 2021 R314, R315']
  ], 'Interconnected dwelling alarm concept; backup, detector type, garage strategy, and local applicability unresolved.');
  circuit('stair', G, [
    ['switch-3way', deckOuter, stairStart - 400, 1100, 'MEP-E15; NEC 2023 210.70(A)(2)'],
    ['light-exterior', W + face, stairStart - 400, 2400, 'MEP-E14; NEC 2023 210.70(A)']
  ], 'Weather-rated lower stair lighting and two-location switching; reserved support and protection unresolved.');
  circuit('deck', U, [
    ['light-exterior', W + face, entryY + 800, 2300, 'MEP-E14; NEC 2023 210.70(A)'],
    ['receptacle-weather', W + face, deckStart + 600, 500, 'MEP-E10; NEC 2023 210.52(E)']
  ], 'Deck lighting and weatherproof receptacle; final switching and circuit separation unresolved.');
  connect(electric, 'electrical-stair-travellers', electric.nodes.find(n => n.id === 'electrical-stair-1'),
    electric.nodes.find(n => n.id === 'electrical-hall-lighting-1'), 'Concept link between the two stair switches, not a wiring or conductor schedule.');
  connect(electric, 'electrical-deck-switch-leg', electric.nodes.find(n => n.id === 'electrical-hall-lighting-1'),
    electric.nodes.find(n => n.id === 'electrical-deck-1'), 'Deck entrance light controlled from the entry switch group; not a wiring schedule.');

  const mechanical = system('system-mechanical', 'mechanical', 'Dwelling Multi-split');
  const outdoor = node(mechanical, 'mechanical-outdoor', 'outdoor-unit', G, heatPump.position.x, heatPump.position.y, 450, 'MEP placement guide; manufacturer clearances unresolved');
  heatPump.connections.push(outdoor.id);
  for (const [id, x, y] of [['living', face, 2000], ['bedroom', Math.round(W / 4), D - face], ['bedroom-2', Math.round(3 * W / 4), D - face]]) {
    const head = node(mechanical, `mechanical-${id}`, 'ductless-head', U, x, y, 2500, 'COMP-I4; MEP placement guide, Air Distribution design practice');
    connect(mechanical, `mechanical-edge-${id}`, outdoor, head, 'Dwelling refrigerant/controls route allowance; capacity, pipe lengths, condensate, and penetrations unresolved.',
      [{ x: outdoor.position.x, y: outdoor.position.y, z: Z + 2500 }, { x, y: outdoor.position.y, z: Z + 2500 }]);
  }
  for (const [id, kind, x, y, tx, ty] of [
    ['bath', 'exhaust-fan', 2400, 8800, -350, 8800],
    ['hood', 'range-hood', 2200, 6875, -350, 6875],
    ['dryer', 'dryer-exhaust', 4550, 7800, W + 350, 7800]
  ]) {
    const exhaust = system(`system-exhaust-${id}`, 'mechanical', `${id === 'hood' ? 'Kitchen' : id === 'bath' ? 'Bathroom' : 'Laundry'} Exhaust`);
    const terminal = node(exhaust, `mechanical-${id}-termination`, 'exhaust-termination', U, tx, ty, 2500, 'MEP placement guide; exhaust and intake separation');
    const fan = node(exhaust, `mechanical-${id}-exhaust`, kind, U, x, y, 2500, 'MEP-P3; MEP placement guide, exhaust design practice');
    connect(exhaust, `mechanical-edge-exhaust-${id}`, fan, terminal, 'Separate exhaust to outside, never into the workshop; route lengths, makeup air and opening clearances unresolved.');
  }

  const surfaces = [
    { id: 'surface-deck', name: 'Residence Deck Landing', levelId: U,
      boundary: [
        { anchor: { wallId: 'wall-u-east', alongMm: deckStart } },
        { anchor: { wallId: 'wall-u-east', alongMm: deckStart, offsetMm: ft(8) } },
        { anchor: { wallId: 'wall-u-east', alongMm: deckEnd, offsetMm: ft(8) } },
        { anchor: { wallId: 'wall-u-east', alongMm: deckEnd } }
      ], topElevationMm: Z, thicknessMm: 250, materialId: 'mat-decking',
      evidence: evidence('8 ft deep exterior deck landing, level with the residence entry. Ledger, flashing, loading and supports need design.') },
    { id: 'surface-stair-landing', name: 'Lower Stair Landing', levelId: G,
      boundary: rect(stairX - ft(2), stairStart - ft(4), stairX + ft(2), stairStart), topElevationMm: 0, thicknessMm: 150, materialId: 'mat-concrete',
      evidence: evidence('Ground landing covers the full stair width and provides 4 ft of clear approach.') },
    { id: 'surface-apron', name: 'Workshop Apron', levelId: G, boundary: rect(-face, -ft(8), W + face, -face),
      topElevationMm: 0, thicknessMm: 150, materialId: 'mat-concrete', evidence: evidence('Synthetic vehicle apron, not a driveway or site grading design.') },
    { id: 'surface-entry-pad', name: 'Workshop Entry Landing', levelId: G,
      boundary: rect(-face - 1500, kitchenY - 900, -face, kitchenY + 900), topElevationMm: 0, thicknessMm: 150, materialId: 'mat-concrete',
      evidence: evidence('Separate workshop entrance at grade; residence access is by the exterior stair only.') }
  ];
  const columns = [deckStart + 150, deckEnd - 150].map((y, i) => ({
    id: `column-deck-${i + 1}`, levelId: G, position: { x: deckOuter - 150, y }, baseElevationMm: 0, topElevationMm: Z - 250,
    shape: { kind: 'rectangular', widthMm: 180, depthMm: 180 }, materialId: 'mat-timber',
    evidence: evidence('Illustrative deck post allowance; member, connection, bracing, and footing design unresolved.')
  }));
  const beams = [{ id: 'beam-deck', levelId: U, start: { x: deckOuter - 150, y: deckStart }, end: { x: deckOuter - 150, y: deckEnd },
    topElevationMm: Z - 50, shape: { kind: 'rectangular', widthMm: 180, depthMm: 200 }, materialId: 'mat-timber',
    evidence: evidence('Deck edge-beam allowance; not a structural size selection.') }];
  const guardSegments = [
    [{ x: deckInner, y: deckEnd - 50 }, { x: deckOuter - 50, y: deckEnd - 50 }],
    [{ x: deckOuter - 50, y: deckStart + 50 }, { x: deckOuter - 50, y: deckEnd - 50 }],
    [{ x: deckInner, y: deckStart + 50 }, { x: stairX - ft(2) - 50, y: deckStart + 50 }],
    [{ x: stairX + ft(2) + 50, y: deckStart + 50 }, { x: deckOuter - 50, y: deckStart + 50 }]
  ];
  guardSegments.forEach(([start, end], i) => beams.push({ id: `beam-deck-guard-${i + 1}`, levelId: U, start, end,
    topElevationMm: Z + 1100, shape: { kind: 'rectangular', widthMm: 50, depthMm: 100 }, materialId: 'mat-timber',
    evidence: evidence('Top line of the required deck guard zone, not a complete guard. Infill, posts, openings and loads remain unresolved.') }));
  const guardPosts = [...new Map(guardSegments.flat().map(point => [`${point.x},${point.y}`, point])).values()];
  guardPosts.forEach((position, i) => columns.push({ id: `column-deck-guard-${i + 1}`, levelId: U, position,
    baseElevationMm: Z, topElevationMm: Z + 1100, shape: { kind: 'rectangular', widthMm: 100, depthMm: 100 }, materialId: 'mat-timber',
    evidence: evidence('Illustrative guard post; infill, spacing, connections and loads still require design.') }));
  const assumptions = [
    ['brief', 'Synthetic replacement brief: 36 by 48 ft, two workshop vehicle bays and rear bench, utility and tool storage, and a two-bedroom residence with full bath and laundry. Exterior stair and deck landing follow the requested access arrangement. Furniture and electric appliances are illustrative choices, not a confirmed real-project specification.'],
    ['access', 'The residence is reached only by the exterior stair and deck. There is no opening in the dwelling floor and no internal workshop-to-dwelling door. This is not an accessible route; accessibility and emergency access require professional review.'],
    ['guards', 'Deck top rails mark guard zones only. Complete guard infill, support posts, stair handrails and guards, slip resistance, frost-safe footings, snow shedding, landing drainage, and emergency escape/rescue performance are omitted or unresolved. Do not build from this model.'],
    ['structure', 'Walls are nominal 2x6 exterior and 2x4 interior wood-frame assemblies; stud spacing, plates, shear walls and the siding type are not chosen. Floor and deck dimensions are spatial allowances. Clear-span floor and roof structure, vehicle-door headers, deck ledger, bracing, foundations, loads and connections require engineered design. No member sizing or fire rating is established.'],
    ['separation', 'The dwelling floor is continuous above the workshop. Fire/smoke and acoustic separation, air sealing, rated penetrations, garage pollutant control and an independent workshop ventilation/heating design remain unresolved. Dwelling HVAC does not distribute workshop air.'],
    ['mep', 'Water supply, connected electrical devices and dwelling HVAC/exhaust are coordination examples. Waste and vent networks, hot/cold separation, condensate, protective devices, final circuit allocation, service clearances and full room coverage review are omitted or unresolved. No conductor, duct, pipe or equipment sizing is implied.'],
    ['site', 'Lakeside is an example name, not a surveyed location. No lake edge, property boundary, setback, topography, tree or utility location is asserted. Survey, shoreline restrictions, soils and drainage remain unknown.'],
    ['code', 'New York is contextual only. No actual municipality, adopted edition or amendment has been researched. Baseline references are design prompts, not findings of code compliance.']
  ].map(([topic, statement]) => ({ id: `assumption-${topic}`, topic, statement, impact: 'high', affectedEntityIds: [], evidence: evidence('Synthetic concept study; professional review required.') }));
  return {
    schemaVersion: '1.0.0',
    project: { id: 'lakeside-barn-residence', name: 'Lakeside Barn Residence', status: 'study',
      description: 'Synthetic 36 x 48 ft workshop residence with two bedrooms, separate exterior stair, deck landing, furnished rooms and conceptual services.',
      coordinates: { unit: 'mm', origin: { x: 0, y: 0, z: 0 }, siteDatumMm: 0, trueNorthDeg: 18, toleranceMm: 3, displayUnits: 'feet-inches' },
      jurisdiction: { country: 'US', stateOrRegion: 'New York', locality: 'Synthetic example, no actual site', codeReviewStatus: 'unavailable' } },
    composition: { strategy: 'symmetric', facades: { east: { strategy: 'balanced' }, west: { strategy: 'balanced' } },
      exceptions: ['opening-utility-window', 'opening-bath-window'].map(entityId => ({
        entityId, rules: ['thirds'], reason: 'Stacked wet-room windows centre on the utility sink and vanity within the service band, clear of its partitions.'
      })) },
    materials: [
      ['mat-siding', 'Exterior siding, type not yet chosen', 'generic'], ['mat-sheathing', 'Wood structural panel sheathing', 'engineered-wood'],
      ['mat-batt', 'Batt insulation in 2x6 stud cavity', 'insulation-batt'], ['mat-gypsum', 'Gypsum board', 'gypsum'],
      ['mat-concrete', 'Concrete', 'concrete'], ['mat-timber', 'Timber allowance', 'wood-framing'],
      ['mat-subfloor', 'Wood subfloor', 'engineered-wood'], ['mat-decking', 'Deck assembly', 'decking']
    ].map(([id, name, category]) => ({ id, name, category, evidence: evidence('Illustrative material category, not a product specification or rated assembly.') })),
    levels, spaces, walls, openings,
    slabs: [
      { id: 'slab-ground', levelId: G, boundary: rect(-face, -face, W + face, D + face), thicknessMm: 150, materialId: 'mat-concrete', evidence: evidence('Concept slab; reinforcement, insulation, moisture and foundation design unresolved.') },
      { id: 'slab-upper', levelId: U, boundary: rect(-face, -face, W + face, D + face), thicknessMm: 350,
        layers: [{ id: 'subfloor', materialId: 'mat-subfloor', thicknessMm: 20 }, { id: 'floor-zone', materialId: 'mat-timber', thicknessMm: 300 }, { id: 'lining', materialId: 'mat-gypsum', thicknessMm: 30 }],
        evidence: evidence('Continuous dwelling floor without an interior stair opening; layers reserve space and establish no span capacity or fire rating.') }
    ],
    roofs: [{ id: 'roof-main', levelId: U, kind: 'gable', footprint: rect(0, 0, W, D), eaveElevationMm: Z + ceiling,
      ridgeElevationMm: Z + ceiling + Math.round(W / 4), ridgeAxis: 'y', overhangMm: 450, evidence: evidence('Simple 6:12 gable envelope; structure, roof assembly and snow loads unresolved.') }],
    stairs: [{ id: 'stair-main', fromLevelId: G, toLevelId: U, start: { x: stairX, y: stairStart }, end: { x: stairX, y: deckStart },
      widthMm: ft(4), riserCount: 20, treadDepthMm: 280, materialId: 'mat-timber',
      evidence: evidence('Exterior straight flight, 20 rises of 180 mm, meeting a full-width lower pad and an 8 ft deep deck landing. Guards, handrails, landings and local stair rules require review.') }],
    fixtures, equipment, systems, surfaces, columns, beams,
    sections: [
      { id: 'section-aa', name: 'Transverse Section A-A', start: { x: -1800, y: 6000 }, end: { x: deckOuter + 600, y: 6000 }, lookDirection: 'left' },
      { id: 'section-bb', name: 'Exterior Stair and Deck B-B', start: { x: stairX, y: stairStart - ft(4) - 600 }, end: { x: stairX, y: deckEnd + 600 }, lookDirection: 'left' }
    ],
    dimensions: [G, U].flatMap(levelId => {
      const z = levelId === U ? Z : 0;
      return [
        { id: levelId === G ? 'dimension-width' : 'dimension-upper-width', kind: 'horizontal', from: { x: 0, y: 0, z }, to: { x: W, y: 0, z }, offsetMm: 3000 },
        { id: levelId === G ? 'dimension-depth' : 'dimension-upper-depth', kind: 'vertical', from: { x: 0, y: 0, z }, to: { x: 0, y: D, z }, offsetMm: 2200 }
      ];
    }),
    viewpoints: [{ id: 'view-arrival', name: 'Workshop and exterior residence stair', position: { x: W + 16000, y: -12000, z: 10000 }, target: { x: half, y: 6500, z: 3500 } }],
    assumptions
  };
}

if (isMain(import.meta)) {
  const target = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lakeside-barn-residence', 'building.json');
  const expected = `${JSON.stringify(buildLakesideBarnResidence(), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== expected) {
      console.error('Lakeside barn example is stale. Run examples/build-lakeside-barn-residence.mjs.');
      process.exitCode = 1;
    }
  } else {
    fs.writeFileSync(target, expected);
    console.log('Wrote lakeside-barn-residence/building.json.');
  }
}
