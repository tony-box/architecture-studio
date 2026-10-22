import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initProject } from '../scripts/init.mjs';
import {
  applyTransform, checkEvidenceReference, findDisagreement, fitPlacement, formatLength, measureUncertainty, parseCalibrationPayload,
  parseLength, parsePixel, parseSeen, readImageInfo, readManifest, registerInBrief, run, selectScale, sourceFile
} from '../scripts/import-image.mjs';

const skillRoot = path.resolve(import.meta.dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'lakeside-barn-residence', 'building.json'), 'utf8'));
const sourcesSchema = JSON.parse(fs.readFileSync(path.join(skillRoot, 'references', 'sources.schema.json'), 'utf8'));
const briefSchema = JSON.parse(fs.readFileSync(path.join(skillRoot, 'references', 'brief.schema.json'), 'utf8'));
const SCRIPT = path.join(skillRoot, 'scripts', 'import-image.mjs');

// ---------------------------------------------------------------- dependency-free schema check (as in schema.test.mjs)

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', 'default']);
const KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'enum', 'const', '$ref', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'if', 'then', 'else', 'not', 'oneOf', 'anyOf', '$defs']);
const typeOf = value => (value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value);

function check(schema, node, value, at = '$', errors = []) {
  for (const key of Object.keys(node)) if (!ANNOTATIONS.has(key) && !KEYWORDS.has(key)) throw new Error(`Unsupported schema keyword ${key} at ${at}`);
  if (node.$ref) check(schema, node.$ref.slice(2).split('/').reduce((item, key) => item[key], schema), value, at, errors);
  if (node.type) {
    const types = [].concat(node.type), actual = typeOf(value);
    if (!types.some(type => type === actual || (type === 'number' && actual === 'integer'))) { errors.push(`${at}: expected ${types.join('|')}, got ${actual}`); return errors; }
  }
  if ('const' in node && JSON.stringify(node.const) !== JSON.stringify(value)) errors.push(`${at}: expected ${JSON.stringify(node.const)}`);
  if (node.enum && !node.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) errors.push(`${at}: ${JSON.stringify(value)} not in enum`);
  if (typeof value === 'number') {
    if (node.minimum != null && value < node.minimum) errors.push(`${at}: below minimum ${node.minimum}`);
    if (node.maximum != null && value > node.maximum) errors.push(`${at}: above maximum ${node.maximum}`);
    if (node.exclusiveMinimum != null && value <= node.exclusiveMinimum) errors.push(`${at}: not above ${node.exclusiveMinimum}`);
    if (node.exclusiveMaximum != null && value >= node.exclusiveMaximum) errors.push(`${at}: not below ${node.exclusiveMaximum}`);
  }
  if (typeof value === 'string') {
    if (node.pattern && !new RegExp(node.pattern, 'u').test(value)) errors.push(`${at}: does not match ${node.pattern}`);
    if (node.minLength != null && value.length < node.minLength) errors.push(`${at}: shorter than ${node.minLength}`);
  }
  if (Array.isArray(value)) {
    if (node.minItems != null && value.length < node.minItems) errors.push(`${at}: fewer than ${node.minItems} items`);
    if (node.items) value.forEach((item, i) => check(schema, node.items, item, `${at}[${i}]`, errors));
  }
  if (typeOf(value) === 'object') {
    for (const key of node.required ?? []) if (!(key in value)) errors.push(`${at}: missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (node.properties?.[key]) check(schema, node.properties[key], item, `${at}.${key}`, errors);
      else if (node.additionalProperties === false) errors.push(`${at}: unexpected property ${key}`);
    }
  }
  const passes = sub => check(schema, sub, value, at, []).length === 0;
  if (node.if) {
    if (passes(node.if)) { if (node.then) check(schema, node.then, value, at, errors); }
    else if (node.else) check(schema, node.else, value, at, errors);
  }
  if (node.not && passes(node.not)) errors.push(`${at}: matches a forbidden shape`);
  if (node.anyOf && !node.anyOf.some(passes)) errors.push(`${at}: matches none of anyOf`);
  if (node.oneOf && node.oneOf.filter(passes).length !== 1) errors.push(`${at}: must match exactly one of oneOf`);
  return errors;
}

// ---------------------------------------------------------------- synthetic images

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function png(width, height, salt = 'a') {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('tEXt', Buffer.from(`Comment\0${salt}`, 'latin1')), pngChunk('IEND', Buffer.alloc(0))]);
}
function jpeg(width, height, { orientation = null, littleEndian = true } = {}) {
  const parts = [Buffer.from([0xff, 0xd8])];
  if (orientation !== null) {
    const tiff = Buffer.alloc(26);
    const u16 = (value, at) => (littleEndian ? tiff.writeUInt16LE(value, at) : tiff.writeUInt16BE(value, at));
    const u32 = (value, at) => (littleEndian ? tiff.writeUInt32LE(value, at) : tiff.writeUInt32BE(value, at));
    tiff.write(littleEndian ? 'II' : 'MM', 0, 'latin1');
    u16(42, 2);
    u32(8, 4);
    u16(1, 8);
    u16(0x0112, 10);
    u16(3, 12);
    u32(1, 14);
    u16(orientation, 18);
    u32(0, 22);
    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const header = Buffer.from([0xff, 0xe1, 0, 0]);
    header.writeUInt16BE(payload.length + 2, 2);
    parts.push(header, payload);
  }
  // A DHT segment (C4) sits in the SOF marker range and must be skipped.
  parts.push(Buffer.from([0xff, 0xc4, 0x00, 0x05, 0x00, 0x01, 0x02]));
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  parts.push(sof, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}
function webp(chunk, data) {
  const body = Buffer.concat([Buffer.from(chunk, 'latin1'), Buffer.alloc(4), data]);
  body.writeUInt32LE(data.length, 4);
  const head = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1')]);
  head.writeUInt32LE(body.length + 4, 4);
  return Buffer.concat([head, body]);
}
function webpLossy(width, height) {
  const data = Buffer.from([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, 0, 0, 0, 0]);
  data.writeUInt16LE(width, 6);
  data.writeUInt16LE(height, 8);
  return webp('VP8 ', data);
}
function webpLossless(width, height) {
  const data = Buffer.alloc(5);
  data[0] = 0x2f;
  data.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 1);
  return webp('VP8L', data);
}
function webpExtended(width, height) {
  const data = Buffer.alloc(10);
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  return webp('VP8X', data);
}

// ---------------------------------------------------------------- project helpers

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-studio-import-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

function setup(t, { model = fixture } = {}) {
  const base = tempDir(t);
  const dir = path.join(base, 'project');
  initProject(dir);
  if (model) fs.writeFileSync(path.join(dir, 'models', 'building.json'), `${JSON.stringify(model, null, 2)}\n`);
  const incoming = path.join(base, 'incoming');
  fs.mkdirSync(incoming);
  const image = (name, bytes) => {
    const file = path.join(incoming, name);
    fs.writeFileSync(file, bytes);
    return file;
  };
  return { dir, image };
}

async function cli(...argv) {
  const out = [];
  const err = [];
  const code = await run(argv.map(String), { log: line => out.push(line), error: line => err.push(line), warn: line => err.push(line), readStdin: async () => '' });
  return { code, out: out.join('\n'), err: err.join('\n') };
}
async function ok(...argv) {
  const result = await cli(...argv);
  assert.equal(result.code, 0, `${argv.join(' ')} failed:\n${result.err}\n${result.out}`);
  return result;
}

const manifestOf = dir => JSON.parse(fs.readFileSync(path.join(dir, 'sources', 'sources.json'), 'utf8'));
const sourceOf = (dir, id) => manifestOf(dir).sources.find(item => item.id === id);
function assertValid(dir) {
  assert.deepEqual(check(sourcesSchema, sourcesSchema, manifestOf(dir)), [], 'sources.json does not match sources.schema.json');
}
const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not ${expected}`);

// A 1000x800 plan imported as "plan".
async function planProject(t, kind = 'floor-plan', options) {
  const project = setup(t, options);
  await ok('add', project.dir, project.image('plan.png', png(1000, 800)), '--kind', kind);
  return project;
}

async function measureJson(dir, ...extra) {
  const result = await cli('measure', dir, 'plan', ...extra, '--json');
  return { ...result, json: result.code === 0 ? JSON.parse(result.out) : null };
}

// ---------------------------------------------------------------- headers

test('image headers: PNG, JPEG with every EXIF orientation in both byte orders, WebP', () => {
  assert.deepEqual(readImageInfo(png(640, 480)), { format: 'png', width: 640, height: 480, exifOrientation: 1 });
  assert.deepEqual(readImageInfo(jpeg(640, 480)), { format: 'jpeg', width: 640, height: 480, exifOrientation: 1 });
  for (const littleEndian of [true, false]) {
    for (let orientation = 1; orientation <= 8; orientation += 1) {
      const info = readImageInfo(jpeg(640, 480, { orientation, littleEndian }));
      const swapped = orientation >= 5;
      assert.deepEqual(info, { format: 'jpeg', width: swapped ? 480 : 640, height: swapped ? 640 : 480, exifOrientation: orientation }, `orientation ${orientation} ${littleEndian ? 'II' : 'MM'}`);
    }
  }
  assert.deepEqual(readImageInfo(webpLossy(300, 200)), { format: 'webp', width: 300, height: 200, exifOrientation: 1 });
  assert.deepEqual(readImageInfo(webpLossless(300, 200)), { format: 'webp', width: 300, height: 200, exifOrientation: 1 });
  assert.deepEqual(readImageInfo(webpExtended(5000, 3000)), { format: 'webp', width: 5000, height: 3000, exifOrientation: 1 });
});

test('image headers: PDF, HEIC, TIFF, and garbage are refused with export advice', () => {
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic\0\0\0\0mif1heic', 'latin1')]);
  const cases = [
    [Buffer.from('%PDF-1.7\n%...', 'latin1'), /PDF files are not supported/],
    [heic, /HEIC files are not supported/],
    [Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmif1', 'latin1'), Buffer.alloc(8)]), /HEIC/],
    [Buffer.from('II*\0\x08\0\0\0', 'latin1'), /TIFF files are not supported/],
    [Buffer.from('MM\0*\0\0\0\x08', 'latin1'), /TIFF/],
    [Buffer.from('not an image at all'), /not a PNG, JPEG, or WebP/]
  ];
  for (const [bytes, message] of cases) {
    assert.throws(() => readImageInfo(bytes), message);
    assert.throws(() => readImageInfo(bytes), /Export it to PNG or JPEG/);
  }
});

// ---------------------------------------------------------------- inputs

test('lengths need units; feet-inches forms all parse', () => {
  const cases = { '3810mm': 3810, '3.81m': 3810, '381cm': 3810, '12.5ft': 3810, "12'": 3657.6, "12'-6\"": 3810, "12' 6\"": 3810, "12'6\"": 3810, '150in': 3810, '150"': 3810, "12'-6 1/2\"": 3822.7, '3810 mm': 3810 };
  for (const [input, mm] of Object.entries(cases)) close(parseLength(input), mm, 1e-3);
  for (const bad of ['12', '3810', '12 apples', '0mm', '', "12'-6", 'm', '1/0"']) assert.throws(() => parseLength(bad), /distance/, bad);
  assert.throws(() => parseLength('12'), /bare number is ambiguous/);
});

test('--seen rescales a resized copy and refuses crops and unrotated sizes', () => {
  const source = { id: 'plan', pixels: { width: 1000, height: 800 }, references: [{ label: 'corner', pixel: { x: 10, y: 20 } }] };
  assert.deepEqual(parsePixel('50,50', source, parseSeen('500x400', source.pixels)), { x: 100, y: 100 });
  assert.deepEqual(parsePixel('ref:corner', source, parseSeen('500x400', source.pixels)), { x: 10, y: 20 }, 'stored references are already canonical');
  assert.throws(() => parseSeen('500x500', source.pixels), /crop/);
  assert.throws(() => parseSeen('400x500', source.pixels), /before EXIF rotation/);
  assert.throws(() => parsePixel('1200,10', source), /outside/);
  assert.throws(() => parsePixel('ref:missing', source), /no reference point/);
});

// ---------------------------------------------------------------- calibration

test('calibrations: uncertainty, the inverse-variance mean, and measured uncertainty', async t => {
  const { dir } = await planProject(t);
  await ok('calibrate', dir, 'plan', '--method', 'printed-dimension', '--from', '100,700', '--to', '600,700', '--distance', '5000mm', '--provenance', 'printed 16\'-5" dimension, south wall');
  let source = sourceOf(dir, 'plan');
  assert.equal(source.calibrations[0].id, 'cal-1');
  assert.equal(source.calibrations[0].mmPerPx, 10);
  assert.equal(source.calibrations[0].estimated, true);
  assert.equal(source.calibrations[0].uncertaintyPx, 3);
  close(source.calibrations[0].relativeUncertainty, 0.012);
  assert.equal(source.calibrationRevision, 1);

  await ok('calibrate', dir, 'plan', '--method', 'printed-dimension', '--from', '100,100', '--to', '600,100', '--distance', '5.01m', '--provenance', 'north wall dimension');
  source = sourceOf(dir, 'plan');
  const scale = selectScale(source.calibrations);
  close(scale.mmPerPx, (10 + 10.02) / 2);
  close(scale.relativeUncertainty, 0.012 / Math.SQRT2);

  const { json } = await measureJson(dir, '--from', '100,400', '--to', '500,400');
  assert.equal(json.distanceMm, Math.round(400 * 10.01));
  close(json.relativeUncertainty, measureUncertainty(0.012 / Math.SQRT2, 3, 400), 1e-4);
  close(json.relativeUncertainty, Math.sqrt((0.012 / Math.SQRT2) ** 2 + (6 / 400) ** 2), 1e-4);
  assert.deepEqual(json.calibrationIds, ['cal-1', 'cal-2']);
  assert.equal(json.estimated, true);
  assert.equal(json.confidence, 0.4);
  assert.equal(json.reference, 'source:plan@1.2');
  assertValid(dir);

  // --seen rescales the points, never --uncertainty-px: it is always in full-size pixels.
  const seen = await measureJson(dir, '--from', '50,200', '--to', '250,200', '--seen', '500x400', '--uncertainty-px', '3');
  assert.equal(seen.json.lengthPx, 400);
  assert.equal(seen.json.relativeUncertainty, json.relativeUncertainty);

  const text = await ok('measure', dir, 'plan', '--from', '100,400', '--to', '500,400');
  assert.match(text.out, /13'-1 5\/8" \(4004 mm\)/);
});

test('calibrations: a disagreement disables measuring, --force overrides, and perpendicular lines get a hint', async t => {
  const { dir } = await planProject(t);
  await ok('calibrate', dir, 'plan', '--method', 'printed-dimension', '--from', '100,700', '--to', '600,700', '--distance', '5000mm', '--provenance', 'south wall');
  await ok('calibrate', dir, 'plan', '--method', 'scale-bar', '--from', '100,650', '--to', '600,650', '--distance', '5500mm', '--provenance', 'scale bar');
  let refused = await measureJson(dir, '--from', '100,400', '--to', '500,400');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /disagree by 10%/);
  assert.doesNotMatch(refused.err, /perpendicular/);
  const forced = await measureJson(dir, '--from', '100,400', '--to', '500,400', '--force');
  assert.equal(forced.code, 0);
  assert.equal(forced.json.distanceMm, 4000, 'printed-dimension wins over scale-bar; the scale bar is only compared');

  await ok('uncalibrate', dir, 'plan', 'cal-2');
  assert.equal((await measureJson(dir, '--from', '100,400', '--to', '500,400')).code, 0);
  await ok('calibrate', dir, 'plan', '--method', 'printed-dimension', '--from', '900,100', '--to', '900,700', '--distance', '6600mm', '--provenance', 'east wall');
  refused = await measureJson(dir, '--from', '100,400', '--to', '500,400');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /perpendicular/);
  assert.equal(sourceOf(dir, 'plan').calibrations.at(-1).id, 'cal-4', 'calibration ids are never reused');

  const parallel = findDisagreement([{ id: 'a', mmPerPx: 10, from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }, { id: 'b', mmPerPx: 10.4, from: { x: 0, y: 5 }, to: { x: 0, y: 9 } }]);
  assert.equal(parallel, null, '4% is within tolerance');
});

test('calibrations: regions isolate their scale', async t => {
  const { dir } = await planProject(t);
  await ok('calibrate', dir, 'plan', '--method', 'printed-dimension', '--from', '100,700', '--to', '600,700', '--distance', '5000mm', '--provenance', 'plan dimension');
  await ok('calibrate', dir, 'plan', '--method', 'printed-dimension', '--from', '10,10', '--to', '290,10', '--distance', '14000mm', '--region', '0,0,300,300,detail', '--provenance', 'detail dimension');
  const inside = await measureJson(dir, '--from', '20,50', '--to', '220,50');
  assert.equal(inside.json.distanceMm, 10000);
  assert.equal(inside.json.region.label, 'detail');
  const outside = await measureJson(dir, '--from', '400,400', '--to', '600,400');
  assert.equal(outside.json.distanceMm, 2000);
  assert.equal(outside.json.region, null);
  assertValid(dir);
});

test('calibrations: close points, photos, and unaccepted known objects are refused', async t => {
  const { dir, image } = await planProject(t);
  const tooClose = await cli('calibrate', dir, 'plan', '--method', 'printed-dimension', '--from', '100,100', '--to', '150,100', '--distance', '1000mm', '--provenance', 'short');
  assert.equal(tooClose.code, 1);
  assert.match(tooClose.err, /at least 128\.1 px apart/);
  const bare = await cli('calibrate', dir, 'plan', '--method', 'printed-dimension', '--from', '100,100', '--to', '600,100', '--distance', '5000', '--provenance', 'x');
  assert.match(bare.err, /bare number/);

  const known = await cli('calibrate', dir, 'plan', '--method', 'known-object', '--from', '100,100', '--to', '600,100', '--distance', "36'", '--provenance', 'garage door width');
  assert.equal(known.code, 1);
  assert.match(known.err, /--accepted/);
  await ok('calibrate', dir, 'plan', '--method', 'known-object', '--from', '100,100', '--to', '600,100', '--distance', '5000mm', '--provenance', 'garage door width', '--accepted');
  assert.equal(sourceOf(dir, 'plan').calibrations[0].acceptedByUser, true);
  assert.equal((await measureJson(dir, '--from', '100,400', '--to', '500,400')).json.confidence, 0.2);

  await ok('add', dir, image('porch.jpg', jpeg(1200, 900)), '--kind', 'photo');
  const photo = await cli('calibrate', dir, 'porch', '--method', 'printed-dimension', '--from', '100,100', '--to', '600,100', '--distance', '5000mm', '--provenance', 'x');
  assert.equal(photo.code, 1);
  assert.match(photo.err, /never calibrated/);
  assertValid(dir);
});

// ---------------------------------------------------------------- placement

test('placement: two pairs at a fixed scale, with north and trueNorthDeg set', async t => {
  const { dir } = await planProject(t);
  await ok('calibrate', dir, 'plan', '--method', 'printed-dimension', '--from', '100,700', '--to', '600,700', '--distance', '5000mm', '--provenance', 'south wall');
  await ok('north', dir, 'plan', '--deg', '108', '--source', 'north-arrow');
  await ok('place', dir, 'plan', '--view', 'level-ground', '--pair', '100,100=0,0=NW corner', '--pair', '500,100=0,4000=NE corner');
  const { placement } = sourceOf(dir, 'plan');
  // θ = 90°: model.x = 10·py − 1000, model.y = 10·px − 1000.
  assert.equal(placement.rotationDeg, 90);
  assert.equal(placement.usesNorth, false);
  assert.deepEqual(placement.transform, { a: 0, b: 10, c: 10, d: 0, e: -1000, f: -1000 });
  assert.deepEqual(placement.residualsMm, [0, 0]);
  assert.deepEqual(placement.pairs[0], { label: 'NW corner', pixel: { x: 100, y: 100 }, model: { x: 0, y: 0 } });
  const result = await ok('to-model', dir, 'plan', '300,400', '1000,0', '--json');
  assert.deepEqual(JSON.parse(result.out).points.map(point => point.model), [{ x: 3000, y: 2000 }, { x: -1000, y: 9000 }]);
  assertValid(dir);

  // list --json is how a later session learns everything the manifest knows about an image.
  await ok('reference', dir, 'plan', '--label', 'Gate', '--at', '250,640');
  const [listed] = JSON.parse((await ok('list', dir, '--json')).out);
  assert.deepEqual(listed.scales[0].methods, ['printed-dimension']);
  assert.equal(listed.scales[0].estimated, true);
  assert.deepEqual(listed.calibrations.map(cal => [cal.id, cal.method, cal.provenance]), [['cal-1', 'printed-dimension', 'south wall']]);
  assert.deepEqual(listed.north, { deg: 108, source: 'north-arrow' });
  assert.equal(listed.placement.pairs[1].label, 'NE corner');
  assert.deepEqual(listed.references, [{ label: 'Gate', pixel: { x: 250, y: 640 } }]);
});

test('placement: one pair and north', async t => {
  const { dir } = await planProject(t, 'site-plan');
  await ok('calibrate', dir, 'plan', '--method', 'printed-dimension', '--from', '100,700', '--to', '600,700', '--distance', '5000mm', '--provenance', 'south wall');
  const noNorth = await cli('place', dir, 'plan', '--view', 'site', '--pair', '200,300=5000,6000');
  assert.equal(noNorth.code, 1);
  assert.match(noNorth.err, /needs north/);
  // north 108° on an image, trueNorthDeg 18° in the model: θ = 90°.
  await ok('north', dir, 'plan', '--deg', '108', '--source', 'survey-basis');
  await ok('place', dir, 'plan', '--view', 'site', '--pair', '200,300=5000,6000');
  const { placement } = sourceOf(dir, 'plan');
  assert.equal(placement.usesNorth, true);
  assert.deepEqual(placement.transform, { a: 0, b: 10, c: 10, d: 0, e: 2000, f: 4000 });
  const result = await ok('to-model', dir, 'plan', '400,500', '--json');
  assert.deepEqual(JSON.parse(result.out).points[0].model, { x: 7000, y: 8000 });
  assert.equal((await cli('place', dir, 'plan', '--view', 'level-attic', '--pair', '200,300=5000,6000')).code, 1);
  assert.equal(placement.trueNorthDeg, 18);
  assertValid(dir);

  // Turning the model's true north leaves the stored transform behind: it is stale until placed again.
  const turned = structuredClone(fixture);
  turned.project.coordinates.trueNorthDeg = 0;
  fs.writeFileSync(path.join(dir, 'models', 'building.json'), JSON.stringify(turned));
  const refused = await cli('to-model', dir, 'plan', '400,500');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /trueNorthDeg 18°, but the model now says 0°\. Re-run place/);
  const checked = await cli('check', dir, '--json');
  assert.equal(checked.code, 1);
  assert.equal(JSON.parse(checked.out).sources[0].placementStale, true);
  assert.match(JSON.parse(checked.out).problems.join('\n'), /Re-run place/);
  await ok('place', dir, 'plan', '--view', 'site', '--pair', '200,300=5000,6000');
  // θ = 108° − 0° now.
  assert.equal(sourceOf(dir, 'plan').placement.rotationDeg, 108);
  assert.equal(sourceOf(dir, 'plan').placement.trueNorthDeg, 0);
  assert.equal((await cli('check', dir)).code, 0);
});

test('moving a placement bumps calibrationRevision, so check flags geometry traced through it', async t => {
  const { dir } = await planProject(t);
  await ok('calibrate', dir, 'plan', '--method', 'printed-dimension', '--from', '100,700', '--to', '600,700', '--distance', '5000mm', '--provenance', 'south wall');
  await ok('place', dir, 'plan', '--view', 'level-ground', '--pair', '100,500=0,0', '--pair', '500,500=4000,0');
  assert.equal(sourceOf(dir, 'plan').calibrationRevision, 1, 'a first placement moves nothing');
  const traced = structuredClone(fixture);
  traced.walls[0].evidence = { source: 'attachment', confidence: 0.6, status: 'needs-review', note: 'Traced through the placement.', reference: 'source:plan@1.1' };
  fs.writeFileSync(path.join(dir, 'models', 'building.json'), JSON.stringify(traced));
  assert.equal((await cli('check', dir)).code, 0);

  await ok('place', dir, 'plan', '--view', 'level-ground', '--pair', '100,500=0,0', '--pair', '500,500=4000,0');
  assert.equal(sourceOf(dir, 'plan').calibrationRevision, 1, 'the same placement again changes nothing');

  const moved = await ok('place', dir, 'plan', '--view', 'level-ground', '--pair', '100,500=100,0', '--pair', '500,500=4100,0');
  assert.match(moved.out, /source:plan@1\.2/);
  const source = sourceOf(dir, 'plan');
  assert.equal(source.calibrationRevision, 2);
  assert.equal(source.placement.calibrationRevision, 2);
  const result = await cli('check', dir, '--json');
  assert.equal(result.code, 1);
  assert.deepEqual(JSON.parse(result.out).evidence.map(item => item.entityId), [traced.walls[0].id]);
  assert.equal(JSON.parse(result.out).sources[0].placementStale, false);
  assertValid(dir);
});

test('a north change that moves a north-derived placement bumps calibrationRevision', async t => {
  const { dir } = await planProject(t, 'site-plan');
  await ok('calibrate', dir, 'plan', '--method', 'printed-dimension', '--from', '100,700', '--to', '600,700', '--distance', '5000mm', '--provenance', 'south wall');
  await ok('north', dir, 'plan', '--deg', '108', '--source', 'north-arrow');
  await ok('place', dir, 'plan', '--view', 'site', '--pair', '200,300=5000,6000');
  assert.equal(sourceOf(dir, 'plan').calibrationRevision, 1);
  await ok('north', dir, 'plan', '--deg', '108', '--source', 'user');
  assert.equal(sourceOf(dir, 'plan').calibrationRevision, 1, 'the same north leaves the transform alone');
  const turned = await ok('north', dir, 'plan', '--deg', '100', '--source', 'user');
  assert.match(turned.out, /Evidence reference: source:plan@1\.2/);
  const source = sourceOf(dir, 'plan');
  assert.equal(source.calibrationRevision, 2);
  assert.equal(source.placement.calibrationRevision, 2);
  assert.equal(source.placement.rotationDeg, 82);
  assert.equal((await cli('to-model', dir, 'plan', '200,300')).code, 0);
});

test('a manifest path outside sources/ is refused before anything is read or deleted', async t => {
  const { dir, image } = await planProject(t);
  const outside = path.join(dir, 'outside.txt');
  fs.writeFileSync(outside, 'keep me');
  const manifest = manifestOf(dir);
  manifest.sources[0].path = '../outside.txt';
  fs.writeFileSync(path.join(dir, 'sources', 'sources.json'), JSON.stringify(manifest));
  const replaced = await cli('add', dir, image('plan.jpg', jpeg(1000, 800)), '--id', 'plan', '--replace');
  assert.equal(replaced.code, 1);
  assert.match(replaced.err, /entry 1 \(plan\) has the path "\.\.\/outside\.txt"; a source path must be sources\/<file name>/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep me');
  assert.equal(fs.existsSync(path.join(dir, 'sources', 'plan.jpg')), false);
  for (const command of [['list', dir], ['check', dir], ['measure', dir, 'plan', '--from', '1,1', '--to', '500,1']]) assert.equal((await cli(...command)).code, 1, command[0]);
  for (const bad of ['sources/..', 'sources/.', 'sources/a/b.png', 'sources\\..\\x.png', '/etc/passwd']) {
    manifest.sources[0].path = bad;
    fs.writeFileSync(path.join(dir, 'sources', 'sources.json'), JSON.stringify(manifest));
    assert.throws(() => readManifest(dir), /a source path must be sources\/<file name>/, bad);
  }
  assert.throws(() => sourceFile(dir, { id: 'plan', path: 'sources/..' }), /outside the project's sources folder/);
  assert.equal(sourceFile(dir, { id: 'plan', path: 'sources/plan.png' }), path.join(dir, 'sources', 'plan.png'));
});

test('placement: three pairs report residuals and warn past the limits', async t => {
  const { dir } = await planProject(t);
  await ok('calibrate', dir, 'plan', '--method', 'printed-dimension', '--from', '100,700', '--to', '600,700', '--distance', '5000mm', '--provenance', 'south wall');
  // Ideal: θ = 0, model = (10·px − 1000, −10·py + 5000). The third model point is 30 mm high,
  // which moves the fit up 10 mm: residuals 10, 10, 20.
  const quiet = await ok('place', dir, 'plan', '--view', 'level-ground', '--pair', '100,500=0,0', '--pair', '500,500=4000,0', '--pair', '300,100=2000,4030');
  let { placement } = sourceOf(dir, 'plan');
  assert.equal(placement.rotationDeg, 0);
  assert.deepEqual(placement.transform, { a: 10, b: 0, c: 0, d: -10, e: -1000, f: 5010 });
  assert.deepEqual(placement.residualsMm, [10, 10, 20]);
  assert.doesNotMatch(quiet.err, /Warning/);

  const loud = await ok('place', dir, 'plan', '--view', 'level-ground', '--pair', '100,500=0,0', '--pair', '500,500=4000,0', '--pair', '300,100=2000,4600');
  ({ placement } = sourceOf(dir, 'plan'));
  assert.deepEqual(placement.residualsMm, [200, 200, 400]);
  assert.match(loud.err, /more than 150 mm/);
  assertValid(dir);
});

test('placement: without a calibration, pairs fit the scale as a control-points calibration', async t => {
  const { dir } = await planProject(t);
  assert.equal((await cli('place', dir, 'plan', '--view', 'site', '--pair', '100,100=0,0')).code, 1);
  await ok('place', dir, 'plan', '--view', 'site', '--pair', '100,100=0,0', '--pair', '600,100=10000,0');
  const source = sourceOf(dir, 'plan');
  const [cal] = source.calibrations;
  assert.equal(cal.method, 'control-points');
  assert.equal(cal.mmPerPx, 20);
  close(cal.relativeUncertainty, 2 * 2 / 500);
  assert.equal(cal.baselinePx, 500);
  assert.equal(cal.distanceMm, 10000);
  assert.equal(source.calibrationRevision, 1);
  assert.equal(source.placement.calibrationRevision, 1);
  assert.deepEqual(source.placement.transform, { a: 20, b: 0, c: 0, d: -20, e: -2000, f: 2000 });
  assertValid(dir);
});

test('placement: recalibrating recomputes the placement from its pairs', async t => {
  const { dir } = await planProject(t);
  await ok('calibrate', dir, 'plan', '--method', 'printed-dimension', '--from', '100,700', '--to', '600,700', '--distance', '5000mm', '--provenance', 'south wall');
  const first = await ok('place', dir, 'plan', '--view', 'site', '--pair', '100,100=0,0', '--pair', '600,100=10000,0');
  assert.deepEqual(sourceOf(dir, 'plan').placement.residualsMm, [2500, 2500]);
  assert.match(first.err, /Warning/);

  const recal = await ok('calibrate', dir, 'plan', '--method', 'manual', '--from', '100,700', '--to', '600,700', '--distance', '10000mm', '--provenance', 'checked on site');
  assert.match(recal.out, /Recomputed the placement/);
  const source = sourceOf(dir, 'plan');
  assert.equal(source.placement.mmPerPx, 20);
  assert.deepEqual(source.placement.residualsMm, [0, 0]);
  assert.deepEqual(source.placement.transform, { a: 20, b: 0, c: 0, d: -20, e: -2000, f: 2000 });
  assert.equal(source.placement.calibrationRevision, source.calibrationRevision);
  assert.equal(source.calibrations[1].estimated, false);
  assert.equal(source.calibrations[1].uncertaintyPx, 1);
});

test('fitPlacement solves the similarity directly', () => {
  const fit = fitPlacement({ pairs: [{ pixel: { x: 0, y: 0 }, model: { x: 0, y: 0 } }, { pixel: { x: 0, y: 100 }, model: { x: 1000, y: 0 } }] });
  // Image-down maps to model +x: θ = 90°, s = 10.
  assert.equal(fit.rotationDeg, 90);
  close(fit.mmPerPx, 10);
  assert.deepEqual(applyTransform(fit.transform, { x: 100, y: 0 }), { x: 0, y: 1000 });
  assert.ok(fit.transform.a * fit.transform.d - fit.transform.b * fit.transform.c < 0, 'the y flip makes the determinant negative');
});

test('place needs a model and a known view', async t => {
  const project = setup(t, { model: null });
  await ok('add', project.dir, project.image('plan.png', png(1000, 800)), '--kind', 'floor-plan');
  const result = await cli('place', project.dir, 'plan', '--view', 'site', '--pair', '100,100=0,0', '--pair', '600,100=10000,0');
  assert.equal(result.code, 1);
  assert.match(result.err, /models\/building\.json/);
});

// ---------------------------------------------------------------- staleness and replace

test('a changed file is stale until it is replaced, and add refuses an existing id', async t => {
  const { dir, image } = await planProject(t);
  await ok('calibrate', dir, 'plan', '--method', 'printed-dimension', '--from', '100,700', '--to', '600,700', '--distance', '5000mm', '--provenance', 'south wall');
  const original = fs.readFileSync(path.join(dir, 'sources', 'plan.png'));
  const changed = png(1000, 800, 'b');
  assert.equal(changed.length, original.length);
  fs.writeFileSync(path.join(dir, 'sources', 'plan.png'), changed);

  const measured = await cli('measure', dir, 'plan', '--from', '100,400', '--to', '500,400');
  assert.equal(measured.code, 1);
  assert.match(measured.err, /stale/);
  for (const command of [['calibrate', dir, 'plan', '--method', 'manual', '--from', '100,700', '--to', '600,700', '--distance', '5000mm', '--provenance', 'x'], ['to-model', dir, 'plan', '1,1'], ['place', dir, 'plan', '--view', 'site', '--pair', '100,100=0,0', '--pair', '600,100=1000,0']]) {
    assert.match((await cli(...command)).err, /stale/, command[0]);
  }
  const checked = await cli('check', dir, '--json');
  assert.equal(checked.code, 1);
  assert.equal(JSON.parse(checked.out).sources[0].stale, true);
  assert.match((await ok('list', dir)).out, /STALE/);

  const file = image('plan.png', changed);
  const refused = await cli('add', dir, file, '--kind', 'floor-plan');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /--replace/);
  await ok('add', dir, file, '--replace');
  const source = sourceOf(dir, 'plan');
  assert.equal(source.revision, 2);
  assert.equal(source.calibrationRevision, 2);
  assert.deepEqual(source.calibrations, []);
  assert.equal(source.kind, 'floor-plan');
  assert.equal((await cli('check', dir)).code, 0);
  assertValid(dir);
});

test('add refuses a destination file it does not own, and slugs ids', async t => {
  const { dir, image } = setup(t);
  fs.writeFileSync(path.join(dir, 'sources', 'site-plan.png'), 'someone else');
  const refused = await cli('add', dir, image('Site Plan.PNG', png(800, 600)), '--kind', 'site-plan');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /sources\/site-plan\.png already exists/);
  await ok('add', dir, image('2019 Survey.jpeg', jpeg(800, 600, { orientation: 6 })), '--kind', 'survey');
  const survey = sourceOf(dir, 'source-2019-survey');
  assert.equal(survey.path, 'sources/source-2019-survey.jpeg');
  assert.deepEqual(survey.pixels, { width: 600, height: 800 });
  assert.equal(survey.exifOrientation, 6);
  assert.equal((await cli('add', dir, image('x.png', png(10, 10)), '--kind', 'plan')).code, 1, 'plan is a brief kind, not a source kind');
  assert.equal((await cli('add', dir, image('x.png', png(10, 10)), '--kind', 'other', '--id', 'Bad_Id')).code, 1);
  assert.equal((await cli('add', dir, image('scan.pdf', Buffer.from('%PDF-1.4')), '--kind', 'survey')).code, 1);
  assertValid(dir);
});

// ---------------------------------------------------------------- apply

function payloadFor(source, overrides = {}) {
  const payload = {
    type: 'architecture-studio/source-calibration',
    version: 1,
    sourceId: source.id,
    contentHash: source.contentHash,
    pixels: source.pixels,
    sourceRevision: source.revision,
    calibrationRevision: source.calibrationRevision,
    calibration: { from: { x: 100.2, y: 700 }, to: { x: 600.2, y: 700 }, distanceMm: 5000, entered: '16\'-4 7/8"', uncertaintyPx: 0.5 },
    references: [{ label: 'NE house corner', pixel: { x: 812.3, y: 140.5 } }],
    ...overrides
  };
  return `Architecture Studio calibration for ${source.id}. Paste this to your agent; it applies it with scripts/import-image.mjs apply.\n${JSON.stringify(payload)}\n`;
}

test('a manual calibration that disagrees with the estimate warns but still wins', async t => {
  const { dir } = await planProject(t);
  await ok('calibrate', dir, 'plan', '--method', 'scale-bar', '--from', '100,700', '--to', '600,700', '--distance', '5000mm', '--provenance', 'bar');
  const agreeing = await ok('apply', dir, payloadFor(sourceOf(dir, 'plan'), { references: [] }));
  assert.doesNotMatch(agreeing.err, /differs from/);
  const wrong = { from: { x: 100, y: 700 }, to: { x: 600, y: 700 }, distanceMm: 2500, entered: '2.5 m', uncertaintyPx: 0.5 };
  const result = await ok('apply', dir, payloadFor(sourceOf(dir, 'plan'), { calibration: wrong, references: [] }));
  assert.match(result.err, /Warning: cal-3 \(manual, 5 mm\/px\) differs from the scale-bar estimate \(cal-1, 10 mm\/px\) by 100%/);
  assert.match(result.err, /remove it with uncalibrate/);
});

test('apply takes the viewer payload and refuses stale or mismatched ones', async t => {
  const { dir } = await planProject(t);
  let source = sourceOf(dir, 'plan');
  const wrongHash = await cli('apply', dir, payloadFor(source, { contentHash: `sha256:${'0'.repeat(64)}` }));
  assert.equal(wrongHash.code, 1);
  assert.match(wrongHash.err, /different version/);
  const wrongPixels = await cli('apply', dir, payloadFor(source, { pixels: { width: 500, height: 400 } }));
  assert.match(wrongPixels.err, /500x400/);
  const wrongRevision = await cli('apply', dir, payloadFor(source, { sourceRevision: 2 }));
  assert.match(wrongRevision.err, /revision 2/);
  assert.match((await cli('apply', dir, '{"type":"something-else"}')).err, /not an Architecture Studio/);

  const good = await ok('apply', dir, payloadFor(source));
  assert.match(good.out, /Added cal-1 \(manual\)/);
  source = sourceOf(dir, 'plan');
  const [cal] = source.calibrations;
  assert.equal(cal.method, 'manual');
  assert.equal(cal.estimated, false);
  assert.equal(cal.provenance, 'manual calibration in the viewer: 16\'-4 7/8"');
  assert.equal(cal.mmPerPx, 10);
  close(cal.relativeUncertainty, 2 * 0.5 / 500);
  assert.deepEqual(source.references, [{ label: 'NE house corner', pixel: { x: 812.3, y: 140.5 } }]);
  assert.equal(source.calibrationRevision, 1);

  const stale = await cli('apply', dir, payloadFor({ ...source, calibrationRevision: 0 }));
  assert.equal(stale.code, 1);
  assert.match(stale.err, /stale.*Reload the viewer/s);

  const file = path.join(dir, 'paste.txt');
  fs.writeFileSync(file, payloadFor(source, { calibration: undefined, references: [{ label: 'NE house corner', pixel: { x: 800, y: 150 } }] }));
  await ok('apply', dir, '--file', file);
  source = sourceOf(dir, 'plan');
  assert.deepEqual(source.references, [{ label: 'NE house corner', pixel: { x: 800, y: 150 } }], 'a reference with the same label is replaced');
  assert.equal(source.calibrationRevision, 1, 'references do not change calibrations');
  await ok('place', dir, 'plan', '--view', 'site', '--pair', 'ref:NE house corner=9000,4000', '--pair', '100,700=0,0');
  assert.equal(sourceOf(dir, 'plan').placement.pairs[0].label, 'NE house corner');
  assertValid(dir);

  assert.throws(() => parseCalibrationPayload('no json here'), /No calibration found/);
  assert.throws(() => parseCalibrationPayload('{"type":"architecture-studio/source-calibration","version":2}'), /version/);
});

// ---------------------------------------------------------------- check

test('check flags outdated and unknown evidence references and accepted ones', async t => {
  const model = structuredClone(fixture);
  model.walls[0].evidence = { source: 'attachment', confidence: 0.6, status: 'accepted', note: 'Traced from the plan.', reference: 'source:plan@1.0' };
  model.walls[1].evidence = { source: 'attachment', confidence: 0.6, status: 'needs-review', note: 'Traced from the plan.', reference: 'source:plan@1.1' };
  const { dir } = await planProject(t, 'floor-plan', { model });
  const variant = structuredClone(fixture);
  variant.walls[2].evidence = { source: 'attachment', confidence: 0.4, status: 'needs-review', note: 'From the survey.', reference: 'source:ghost@1.0' };
  fs.writeFileSync(path.join(dir, 'models', 'variants', 'option-b.json'), JSON.stringify(variant));
  await ok('calibrate', dir, 'plan', '--method', 'printed-dimension', '--from', '100,700', '--to', '600,700', '--distance', '5000mm', '--provenance', 'south wall');

  const result = await cli('check', dir, '--json');
  assert.equal(result.code, 1);
  const report = JSON.parse(result.out);
  assert.deepEqual(report.evidence.map(item => [item.file, item.entityId, item.accepted]), [
    ['models/building.json', model.walls[0].id, true],
    ['models/variants/option-b.json', variant.walls[2].id, false]
  ]);
  assert.match(report.problems.join('\n'), /approve it again/);
  assert.match(report.problems.join('\n'), /unknown source "ghost"/);
  assert.equal(checkEvidenceReference('source:plan@1.1', { sources: [{ id: 'plan', revision: 1, calibrationRevision: 1 }] }), null);
  assert.match(checkEvidenceReference('source:plan@2.0', { sources: [{ id: 'plan', revision: 1, calibrationRevision: 1 }] }), /does not exist yet/);
  assert.match(checkEvidenceReference('source:plan', { sources: [] }), /not source:/);
});

// ---------------------------------------------------------------- brief

const brief = {
  schemaVersion: '1.0.0',
  status: 'in-progress',
  project: { name: 'Cabin', use: 'residence' },
  location: { country: 'US', stateOrRegion: 'Vermont', locality: 'Stowe' },
  levels: 1,
  units: 'feet-inches',
  program: [{ name: 'Living room' }],
  targetArea: 'derive-from-program',
  assumptions: [],
  sources: [
    { path: 'incoming/plat.png', kind: 'survey', calibration: { description: 'north lot line 120 ft', valueMm: 36576 } },
    { path: 'sources/notes.pdf', kind: 'code-document' }
  ]
};

test('add registers the image in brief.json once and keeps a legacy calibration', async t => {
  const { dir, image } = setup(t);
  const base = path.dirname(dir);
  const briefFile = path.join(dir, 'brief.json');
  fs.writeFileSync(briefFile, `${JSON.stringify({ ...brief, sources: brief.sources.map(item => ({ ...item, path: item.path === 'incoming/plat.png' ? path.relative(dir, path.join(base, 'incoming', 'plat.png')).split(path.sep).join('/') : item.path })) }, null, 2)}\n`);
  const file = image('plat.png', png(1200, 900));
  const added = await ok('add', dir, file, '--kind', 'survey');
  assert.match(added.out, /Registered it in brief\.json/);
  const written = fs.readFileSync(briefFile, 'utf8');
  assert.ok(written.endsWith('}\n'));
  assert.match(written, /\n  "status": "in-progress",\n/);
  const parsed = JSON.parse(written);
  assert.deepEqual(check(briefSchema, briefSchema, parsed), []);
  assert.deepEqual(parsed.sources[0], { path: 'sources/plat.png', kind: 'survey', calibration: brief.sources[0].calibration, sourceId: 'plat' });
  assert.equal(parsed.sources.length, 2);
  assert.deepEqual(sourceOf(dir, 'plat').legacyCalibration, brief.sources[0].calibration);

  assert.equal(registerInBrief(dir, { originalPath: file, path: 'sources/plat.png', kind: 'survey', sourceId: 'plat' }).changed, false);
  assert.equal(fs.readFileSync(briefFile, 'utf8'), written);
  await ok('add', dir, file, '--replace');
  assert.equal(fs.readFileSync(briefFile, 'utf8'), written, 're-adding the same file changes nothing');

  await ok('add', dir, image('roof.webp', webpLossless(400, 300)), '--kind', 'framing-plan');
  const again = JSON.parse(fs.readFileSync(briefFile, 'utf8'));
  assert.deepEqual(again.sources[2], { path: 'sources/roof.webp', kind: 'framing-plan', sourceId: 'roof' });
  assert.deepEqual(check(briefSchema, briefSchema, again), []);
  assertValid(dir);

  fs.writeFileSync(briefFile, '{ broken');
  const warned = await ok('add', dir, image('sat.png', png(400, 300)), '--kind', 'satellite');
  assert.match(warned.err, /not valid JSON/);
  assert.equal(fs.readFileSync(briefFile, 'utf8'), '{ broken');
});

test('formatLength shows feet-inches to 1/8 inch and metric', () => {
  assert.equal(formatLength(3810, 'feet-inches'), '12\'-6"');
  assert.equal(formatLength(3813.175, 'feet-inches'), '12\'-6 1/8"');
  assert.equal(formatLength(3810, 'metric'), '3810 mm');
  assert.equal(formatLength(38100, 'metric'), '38.10 m');
});

// ---------------------------------------------------------------- end to end

test('the CLI runs end to end in a child process', t => {
  const { dir, image } = setup(t);
  const node = (...args) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  assert.match(node('add', dir, image('site.png', png(1000, 800)), '--kind', 'site-plan'), /Imported site/);
  node('calibrate', dir, 'site', '--method', 'scale-bar', '--from', '50,350', '--to', '300,350', '--seen', '500x400', '--distance', "16'-4 7/8\"", '--estimated', 'false', '--provenance', 'scale bar, lower left');
  const placed = node('place', dir, 'site', '--view', 'site', '--pair', '100,100=0,0=SW', '--pair', '600,100=5000,0=SE');
  // 16'-4 7/8" is 5000.625 mm over 500 px; the pairs imply 5000 mm, so each is off by 0.3 mm.
  assert.match(placed, /Residuals: SW 0.3 mm, SE 0.3 mm/);
  assert.equal(sourceOf(dir, 'site').calibrations[0].estimated, false);
  const points = JSON.parse(node('to-model', dir, 'site', '350,350', '--json')).points;
  assert.deepEqual(points[0].model, { x: 2500, y: -2500 });
  assert.match(node('list', dir), /site-plan/);
  assert.match(node('--help'), /Usage/);
  assert.throws(() => node('measure', dir, 'site', '--from', '1,1'), error => error.status === 1 && /--to needs a value/.test(error.stderr));
  assertValid(dir);
});
