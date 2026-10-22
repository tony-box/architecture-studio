// Imports the images a user supplies (satellite images, surveys, site and floor plans, framing
// plans, elevations, photos) into a project, and records their scale and placement in
// sources/sources.json. See references/coordinate-contract.md, "Source Images".
//
//   node <skill>/scripts/import-image.mjs <command> <project> ...   (--help lists the commands)
//
// Pixels are canonical: after EXIF orientation, origin at the top-left corner, y down.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isMain, parseArgs } from './lib.mjs';

export const SCHEMA_VERSION = '1.0.0';
export const MANIFEST_PATH = 'sources/sources.json';
export const KINDS = ['satellite', 'survey', 'site-plan', 'floor-plan', 'framing-plan', 'elevation', 'photo', 'sketch', 'other'];
export const NORTH_SOURCES = ['north-arrow', 'survey-basis', 'user', 'assumed'];
export const PRECISE_METHODS = ['manual', 'control-points'];
export const AUTOMATIC_METHODS = ['printed-dimension', 'scale-bar', 'stated-scale', 'map-metadata'];
const TWO_POINT_METHODS = ['printed-dimension', 'scale-bar', 'manual', 'known-object'];
const SCALE_ONLY_METHODS = ['stated-scale', 'map-metadata'];
const ESTIMATED_BY_DEFAULT = ['printed-dimension', 'scale-bar', 'known-object'];
export const DISAGREEMENT_RATIO = 1.05;
export const MIN_SEPARATION = 0.1;
export const RESIDUAL_LIMIT_MM = 150;
export const RESIDUAL_LIMIT_RATIO = 0.02;
export const PAYLOAD_TYPE = 'architecture-studio/source-calibration';
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const EXTENSIONS = { png: ['.png'], jpeg: ['.jpg', '.jpeg'], webp: ['.webp'] };
const EXPORT_ADVICE = 'Export it to PNG or JPEG (a screenshot or "Save as" works) and import that file.';

export class CliError extends Error {}
const fail = message => { throw new CliError(message); };

const round = (value, digits) => {
  const factor = 10 ** digits;
  const out = Math.round(value * factor) / factor;
  return Object.is(out, -0) ? 0 : out;
};
const now = () => new Date().toISOString();

// ---------------------------------------------------------------- image headers

export function readExifOrientation(buf, start, end = buf.length) {
  if (end - start < 8) return 1;
  const order = buf.toString('latin1', start, start + 2);
  const le = order === 'II';
  if (!le && order !== 'MM') return 1;
  const u16 = at => (le ? buf.readUInt16LE(at) : buf.readUInt16BE(at));
  const u32 = at => (le ? buf.readUInt32LE(at) : buf.readUInt32BE(at));
  if (u16(start + 2) !== 42) return 1;
  const ifd = start + u32(start + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

function readPng(buf) {
  if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') fail('The PNG file has no IHDR header; it may be damaged.');
  return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), exifOrientation: 1 };
}

function readJpeg(buf) {
  let orientation = 1;
  let exifSeen = false;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) break;
    while (buf[i] === 0xff) i += 1;
    const marker = buf[i];
    i += 1;
    if (marker === undefined) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) break;
    if (i + 2 > buf.length) break;
    const start = i + 2;
    const end = i + buf.readUInt16BE(i);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (start + 5 > buf.length) break;
      const height = buf.readUInt16BE(start + 1);
      const width = buf.readUInt16BE(start + 3);
      const swap = orientation >= 5;
      return { format: 'jpeg', width: swap ? height : width, height: swap ? width : height, exifOrientation: orientation };
    }
    if (marker === 0xe1 && !exifSeen && buf.toString('latin1', start, start + 6) === 'Exif\0\0') {
      exifSeen = true;
      orientation = readExifOrientation(buf, start + 6, Math.min(end, buf.length));
    }
    i = end;
  }
  fail('Could not find the JPEG frame header (its pixel size); the file may be damaged.');
}

function readWebp(buf) {
  const chunk = buf.toString('latin1', 12, 16);
  const data = 20;
  if (chunk === 'VP8 ' && buf.length >= data + 10 && buf[data + 3] === 0x9d && buf[data + 4] === 0x01 && buf[data + 5] === 0x2a) {
    return { format: 'webp', width: buf.readUInt16LE(data + 6) & 0x3fff, height: buf.readUInt16LE(data + 8) & 0x3fff, exifOrientation: 1 };
  }
  if (chunk === 'VP8L' && buf.length >= data + 5 && buf[data] === 0x2f) {
    const bits = buf.readUInt32LE(data + 1);
    return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, exifOrientation: 1 };
  }
  if (chunk === 'VP8X' && buf.length >= data + 10) {
    return { format: 'webp', width: buf.readUIntLE(data + 4, 3) + 1, height: buf.readUIntLE(data + 7, 3) + 1, exifOrientation: 1 };
  }
  fail('The WebP file has no VP8, VP8L, or VP8X header; it may be damaged.');
}

// Returns { format, width, height, exifOrientation } with width and height already oriented.
export function readImageInfo(buf) {
  const ascii = (from, to) => buf.toString('latin1', from, to);
  let info;
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) info = readPng(buf);
  else if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) info = readJpeg(buf);
  else if (buf.length >= 16 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') info = readWebp(buf);
  else {
    let name = null;
    if (ascii(0, 5) === '%PDF-' || ascii(0, 4) === '%PDF') name = 'PDF';
    else if (ascii(4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevx', 'mif1', 'msf1'].includes(ascii(8, 12))) name = 'HEIC';
    else if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) name = 'AVIF';
    else if (ascii(0, 4) === 'II*\0' || ascii(0, 4) === 'MM\0*') name = 'TIFF';
    else if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') name = 'GIF';
    fail(name
      ? `${name} files are not supported: only PNG, JPEG, and WebP images can be imported. ${EXPORT_ADVICE}`
      : `This is not a PNG, JPEG, or WebP image. ${EXPORT_ADVICE} (PDF, HEIC, and TIFF files need the same export.)`);
  }
  if (!(info.width > 0 && info.height > 0)) fail(`Could not read the ${info.format.toUpperCase()} image size. ${EXPORT_ADVICE}`);
  return info;
}

export const hashBytes = buf => `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;

// ---------------------------------------------------------------- parsing inputs

const LENGTH_HELP = 'Give the distance with its unit, for example 3810mm, 3.81m, 381cm, 12.5ft, 12\'-6", or 150in. A bare number is ambiguous.';
const NUM = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
const INCHES = `(\\d+(?:\\.\\d+)?(?:[\\s-]+\\d+\\/\\d+)?|\\d+\\/\\d+)`;

function inchValue(text) {
  const [whole, fraction] = text.includes('/') ? (text.trim().match(/^(?:(\d+(?:\.\d+)?)[\s-]+)?(\d+\/\d+)$/)?.slice(1) ?? [text]) : [text];
  let value = whole ? Number(whole) : 0;
  if (fraction) {
    const [n, d] = fraction.split('/').map(Number);
    if (!d) return NaN;
    value += n / d;
  }
  return value;
}

// Parses a length with units into millimetres. Throws on a bare number or an unknown unit.
export function parseLength(input) {
  const text = String(input).trim().replace(/[′’‘]/g, "'").replace(/[″”“]/g, '"').replace(/''/g, '"');
  let mm = NaN;
  let m;
  if ((m = text.match(new RegExp(`^${NUM}\\s*(mm|cm|m)$`, 'i')))) mm = Number(m[1]) * { mm: 1, cm: 10, m: 1000 }[m[2].toLowerCase()];
  else if ((m = text.match(new RegExp(`^${NUM}\\s*(ft|feet|foot)$`, 'i')))) mm = Number(m[1]) * 304.8;
  else if ((m = text.match(new RegExp(`^${INCHES}\\s*(in|inch|inches|")$`, 'i')))) mm = inchValue(m[1]) * 25.4;
  else if ((m = text.match(new RegExp(`^${NUM}\\s*'(?:\\s*-?\\s*${INCHES}\\s*")?$`)))) mm = Number(m[1]) * 304.8 + (m[2] ? inchValue(m[2]) * 25.4 : 0);
  if (!Number.isFinite(mm)) fail(`Cannot read the distance "${input}". ${LENGTH_HELP}`);
  if (mm <= 0) fail(`The distance "${input}" must be greater than zero.`);
  return round(mm, 3);
}

export function parseNumber(value, name, { min, positive = false, integer = false } = {}) {
  const text = Array.isArray(value) ? fail(`--${name} was given more than once.`) : value;
  const number = typeof text === 'string' && text.trim() !== '' ? Number(text) : NaN;
  if (!Number.isFinite(number)) fail(`--${name} needs a number, got ${text === true ? 'nothing' : JSON.stringify(text)}.`);
  if (positive && number <= 0) fail(`--${name} must be greater than zero.`);
  if (min !== undefined && number < min) fail(`--${name} must be at least ${min}.`);
  if (integer && !Number.isInteger(number)) fail(`--${name} must be a whole number.`);
  return number;
}

// Parses "WxH", the size of the copy the coordinates were read from, and checks it is a resize.
export function parseSeen(value, pixels) {
  if (value === undefined) return null;
  const m = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/i);
  if (!m || !(Number(m[1]) > 0 && Number(m[2]) > 0)) fail(`--seen needs the size as WIDTHxHEIGHT, for example 1024x768, got ${JSON.stringify(value)}.`);
  const seen = { width: Number(m[1]), height: Number(m[2]) };
  const matches = (w, h) => Math.abs(w / seen.width - h / seen.height) / Math.max(w / seen.width, h / seen.height) <= 0.02 + 1 / Math.min(seen.width, seen.height);
  if (!matches(pixels.width, pixels.height)) {
    if (pixels.width !== pixels.height && matches(pixels.height, pixels.width)) fail(`--seen ${value} matches the image before EXIF rotation. Coordinates must be read from the upright image (${pixels.width}x${pixels.height}).`);
    fail(`--seen ${value} does not have the image's proportions (${pixels.width}x${pixels.height}). Coordinates read from a crop are not accepted; read them from the whole image.`);
  }
  return seen;
}

export function scalePoint(point, seen, pixels) {
  if (!seen) return point;
  return { x: point.x * pixels.width / seen.width, y: point.y * pixels.height / seen.height };
}

function checkInImage(point, pixels, label) {
  if (point.x < 0 || point.y < 0 || point.x > pixels.width || point.y > pixels.height) {
    fail(`${label} (${round(point.x, 2)}, ${round(point.y, 2)}) is outside the ${pixels.width}x${pixels.height} image.`);
  }
}

// Parses "x,y" (rescaled by --seen) or "ref:<label>" (a stored reference point, already canonical).
export function parsePixel(text, source, seen = null, label = 'The point') {
  const value = String(text).trim();
  if (value.startsWith('ref:')) {
    const name = value.slice(4).trim();
    const ref = source.references.find(item => item.label === name);
    if (!ref) fail(`${label}: no reference point labelled "${name}" on ${source.id}. Known: ${source.references.map(item => item.label).join(', ') || 'none'}.`);
    return { ...ref.pixel };
  }
  const m = value.match(/^(-?\d+(?:\.\d+)?|-?\.\d+)\s*,\s*(-?\d+(?:\.\d+)?|-?\.\d+)$/);
  if (!m) fail(`${label}: expected pixel coordinates as x,y or ref:<label>, got ${JSON.stringify(text)}.`);
  const point = scalePoint({ x: Number(m[1]), y: Number(m[2]) }, seen, source.pixels);
  checkInImage(point, source.pixels, label);
  return { x: round(point.x, 2), y: round(point.y, 2) };
}

export function parseRegion(text, pixels, seen = null) {
  const parts = String(text).split(',');
  const numbers = parts.slice(0, 4).map(item => Number(item.trim()));
  if (parts.length < 4 || parts.slice(0, 4).some(item => item.trim() === '') || numbers.some(item => !Number.isFinite(item))) fail(`--region needs x0,y0,x1,y1[,label], got ${JSON.stringify(text)}.`);
  const a = scalePoint({ x: numbers[0], y: numbers[1] }, seen, pixels);
  const b = scalePoint({ x: numbers[2], y: numbers[3] }, seen, pixels);
  checkInImage(a, pixels, 'The region corner');
  checkInImage(b, pixels, 'The region corner');
  const region = { x0: round(Math.min(a.x, b.x), 2), y0: round(Math.min(a.y, b.y), 2), x1: round(Math.max(a.x, b.x), 2), y1: round(Math.max(a.y, b.y), 2) };
  if (region.x1 - region.x0 <= 0 || region.y1 - region.y0 <= 0) fail('--region must have a width and a height.');
  const label = parts.slice(4).join(',').trim();
  return label ? { label, ...region } : region;
}

function parseBool(value, name, fallback) {
  if (value === undefined) return fallback;
  if (value === true || value === 'true' || value === 'yes') return true;
  if (value === 'false' || value === 'no') return false;
  fail(`--${name} takes true or false, got ${JSON.stringify(value)}.`);
}

function single(args, name) {
  const value = args[name];
  if (Array.isArray(value)) fail(`--${name} was given more than once.`);
  return value;
}

function text(args, name, { required = false } = {}) {
  const value = single(args, name);
  if (value === undefined || value === true) {
    if (required || value === true) fail(`--${name} needs a value.`);
    return undefined;
  }
  return String(value);
}

// ---------------------------------------------------------------- scale

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const diagonal = pixels => Math.hypot(pixels.width, pixels.height);

export function checkSeparation(a, b, pixels, what = 'The two points') {
  const min = MIN_SEPARATION * diagonal(pixels);
  const span = distance(a, b);
  if (span < min) fail(`${what} are ${round(span, 1)} px apart; they must be at least ${round(min, 1)} px apart (10% of the image diagonal). Use points farther apart, such as the two ends of a long dimension.`);
}

const regionKey = region => (region ? `${region.x0},${region.y0},${region.x1},${region.y1}` : '');
const regionContains = (region, point) => point.x >= region.x0 && point.x <= region.x1 && point.y >= region.y0 && point.y <= region.y1;
const regionName = region => (region ? `region ${region.label ? `"${region.label}" ` : ''}(${region.x0},${region.y0})-(${region.x1},${region.y1})` : 'whole image');

// The calibrations that apply to a set of points: the smallest region containing all of them,
// otherwise the calibrations without a region.
export function calibrationGroup(source, points) {
  const regions = new Map();
  for (const cal of source.calibrations) if (cal.region) regions.set(regionKey(cal.region), cal.region);
  const containing = [...regions.values()]
    .filter(region => points.every(point => regionContains(region, point)))
    .sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0));
  const region = containing[0] ?? null;
  const key = regionKey(region);
  return { region, calibrations: source.calibrations.filter(cal => regionKey(cal.region) === key) };
}

export function allGroups(source) {
  const keys = new Map([['', null]]);
  for (const cal of source.calibrations) if (cal.region) keys.set(regionKey(cal.region), cal.region);
  return [...keys.entries()].map(([key, region]) => ({ region, calibrations: source.calibrations.filter(cal => regionKey(cal.region) === key) }))
    .filter(group => group.region === null || group.calibrations.length);
}

function lineAngle(cal) {
  return Math.atan2(cal.to.y - cal.from.y, cal.to.x - cal.from.x);
}

// Largest over smallest mmPerPx beyond 5%, with a hint when two disagreeing lines are near perpendicular.
export function findDisagreement(calibrations) {
  if (calibrations.length < 2) return null;
  const sorted = [...calibrations].sort((a, b) => a.mmPerPx - b.mmPerPx);
  const min = sorted[0];
  const max = sorted.at(-1);
  const ratio = max.mmPerPx / min.mmPerPx;
  if (ratio <= DISAGREEMENT_RATIO) return null;
  let perpendicular = null;
  for (let i = 0; i < calibrations.length && !perpendicular; i += 1) {
    for (let j = i + 1; j < calibrations.length; j += 1) {
      const [p, q] = [calibrations[i], calibrations[j]];
      if (!p.from || !q.from) continue;
      if (Math.max(p.mmPerPx, q.mmPerPx) / Math.min(p.mmPerPx, q.mmPerPx) <= DISAGREEMENT_RATIO) continue;
      let angle = Math.abs(lineAngle(p) - lineAngle(q)) * 180 / Math.PI % 180;
      if (angle > 90) angle = 180 - angle;
      if (angle >= 60) { perpendicular = [p.id, q.id]; break; }
    }
  }
  const percent = round((ratio - 1) * 100, 1);
  let message = `${max.id} (${round(max.mmPerPx, 4)} mm/px) and ${min.id} (${round(min.mmPerPx, 4)} mm/px) disagree by ${percent}%, more than 5%. Measuring with this scale is disabled until one is corrected or removed (uncalibrate).`;
  if (perpendicular) message += ` ${perpendicular[0]} and ${perpendicular[1]} run nearly perpendicular, which points to uneven horizontal and vertical scaling (a stretched scan or photo): re-scan or re-export the image flat, or calibrate each direction in its own region.`;
  return { minId: min.id, maxId: max.id, ratio: round(ratio, 4), perpendicular, message };
}

// The active scale of a calibration group, per the contract's selection order.
export function selectScale(calibrations) {
  const precise = calibrations.filter(cal => PRECISE_METHODS.includes(cal.method));
  let chosen;
  let compared;
  if (precise.length) {
    chosen = precise;
    compared = precise;
  } else {
    compared = calibrations.filter(cal => AUTOMATIC_METHODS.includes(cal.method));
    const method = AUTOMATIC_METHODS.find(name => compared.some(cal => cal.method === name));
    chosen = method ? compared.filter(cal => cal.method === method) : [];
    if (!chosen.length) {
      const accepted = calibrations.filter(cal => cal.method === 'known-object' && cal.acceptedByUser === true);
      if (accepted.length) chosen = [accepted.at(-1)];
    }
  }
  if (!chosen.length) return null;
  const weights = chosen.map(cal => 1 / Math.max(cal.relativeUncertainty, 1e-9) ** 2);
  const total = weights.reduce((sum, w) => sum + w, 0);
  const mmPerPx = chosen.reduce((sum, cal, i) => sum + cal.mmPerPx * weights[i], 0) / total;
  return {
    mmPerPx,
    relativeUncertainty: 1 / Math.sqrt(total),
    calibrationIds: chosen.map(cal => cal.id),
    methods: [...new Set(chosen.map(cal => cal.method))],
    estimated: chosen.some(cal => cal.estimated),
    precise: precise.length > 0,
    disagreement: findDisagreement(compared)
  };
}

export function scaleFor(source, points) {
  const group = calibrationGroup(source, points);
  return { ...group, scale: selectScale(group.calibrations) };
}

// Relative uncertainty of a measured length: sqrt(u_scale² + (2ε / L)²).
export const measureUncertainty = (scaleUncertainty, endpointPx, lengthPx) => Math.sqrt(scaleUncertainty ** 2 + (2 * endpointPx / lengthPx) ** 2);

// ---------------------------------------------------------------- placement

export function applyTransform(t, p) {
  return { x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f };
}

export function invertTransform(t, m) {
  const det = t.a * t.d - t.b * t.c;
  const x = m.x - t.e;
  const y = m.y - t.f;
  return { x: (t.d * x - t.c * y) / det, y: (-t.b * x + t.a * y) / det };
}

const normalizeDeg = deg => {
  const out = ((round(deg, 6) % 360) + 360) % 360;
  return out === 360 ? 0 : round(out, 6);
};

// Fits model = s·R(θ)·(px, −py) + t. With mmPerPx the scale is fixed (least-squares rotation and
// translation); without it, two or more pairs also fit the scale. One pair needs north.
export function fitPlacement({ pairs, mmPerPx = null, northDeg = null, trueNorthDeg = 0 }) {
  if (!pairs.length) fail('place needs at least one --pair.');
  const q = pairs.map(pair => ({ x: pair.pixel.x, y: -pair.pixel.y }));
  const m = pairs.map(pair => pair.model);
  const mean = list => ({ x: list.reduce((s, p) => s + p.x, 0) / list.length, y: list.reduce((s, p) => s + p.y, 0) / list.length });
  const qc = mean(q);
  const mc = mean(m);
  let s = mmPerPx;
  let theta;
  let usesNorth = false;
  if (pairs.length === 1) {
    if (s == null) fail('One pair cannot fix the scale. Calibrate the image first, or give two or more --pair points.');
    if (northDeg == null) fail('One pair needs north to fix the rotation. Record it with the north command, or give two or more --pair points.');
    theta = (northDeg - trueNorthDeg) * Math.PI / 180;
    usesNorth = true;
  } else {
    let sxx = 0;
    let sxy = 0;
    let sqq = 0;
    q.forEach((point, i) => {
      const Q = { x: point.x - qc.x, y: point.y - qc.y };
      const M = { x: m[i].x - mc.x, y: m[i].y - mc.y };
      sxx += Q.x * M.x + Q.y * M.y;
      sxy += Q.x * M.y - Q.y * M.x;
      sqq += Q.x ** 2 + Q.y ** 2;
    });
    if (sqq === 0) fail('The pairs share one pixel point; they must be spread across the image.');
    theta = Math.atan2(sxy, sxx);
    if (s == null) {
      s = Math.hypot(sxx, sxy) / sqq;
      if (!(s > 0)) fail('The model points of the pairs coincide; they must be distinct.');
    }
  }
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const e = mc.x - s * (cos * qc.x - sin * qc.y);
  const f = mc.y - s * (sin * qc.x + cos * qc.y);
  const transform = { a: round(s * cos, 6), b: round(s * sin, 6), c: round(s * sin, 6), d: round(-s * cos, 6), e: round(e, 3), f: round(f, 3) };
  const residualsMm = pairs.map(pair => {
    const p = applyTransform(transform, pair.pixel);
    return round(Math.hypot(p.x - pair.model.x, p.y - pair.model.y), 1);
  });
  return { mmPerPx: s, rotationDeg: normalizeDeg(theta * 180 / Math.PI), transform, residualsMm, usesNorth };
}

export function placementWarnings(pairs, residualsMm) {
  let span = 0;
  for (let i = 0; i < pairs.length; i += 1) for (let j = i + 1; j < pairs.length; j += 1) span = Math.max(span, distance(pairs[i].model, pairs[j].model));
  const warnings = [];
  residualsMm.forEach((residual, i) => {
    const name = pairs[i].label ? `"${pairs[i].label}"` : `#${i + 1}`;
    if (residual > RESIDUAL_LIMIT_MM) warnings.push(`pair ${name} is off by ${residual} mm, more than ${RESIDUAL_LIMIT_MM} mm.`);
    else if (span > 0 && residual > RESIDUAL_LIMIT_RATIO * span) warnings.push(`pair ${name} is off by ${residual} mm, more than 2% of the ${round(span, 0)} mm pair spacing.`);
  });
  if (warnings.length) warnings.push('Check those pairs (wrong corner, or a misread pixel) and the calibration before tracing from this placement.');
  return warnings;
}

const angleBetween = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const modelTrueNorth = model => model?.project?.coordinates?.trueNorthDeg ?? 0;

// Why a placement can no longer be drawn or used, or null. With a model, a north-derived placement is
// also stale once the model's trueNorthDeg differs from the one it was made with.
export function placementStaleReason(source, model = null) {
  const placement = source.placement;
  if (!placement) return null;
  if (placement.sourceRevision !== source.revision || placement.calibrationRevision !== source.calibrationRevision) {
    return `it was made against ${placement.sourceRevision}.${placement.calibrationRevision}, now ${source.revision}.${source.calibrationRevision}`;
  }
  if (model && Number.isFinite(placement.trueNorthDeg) && angleBetween(modelTrueNorth(model), placement.trueNorthDeg) > 1e-9) {
    return `it was made with trueNorthDeg ${placement.trueNorthDeg}°, but the model now says ${modelTrueNorth(model)}°`;
  }
  return null;
}
export const isPlacementStale = (source, model = null) => placementStaleReason(source, model) !== null;
export const evidenceReference = source => `source:${source.id}@${source.revision}.${source.calibrationRevision}`;

// ---------------------------------------------------------------- project files

function projectRoot(dir) {
  if (!dir) fail('Give the project folder.');
  const root = path.resolve(String(dir));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail(`The project folder ${root} does not exist. Create it with scripts/init.mjs first.`);
  return root;
}

export function readManifest(root) {
  const file = path.join(root, ...MANIFEST_PATH.split('/'));
  if (!fs.existsSync(file)) return { schemaVersion: SCHEMA_VERSION, sources: [] };
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${MANIFEST_PATH} is not valid JSON (${error.message}). Fix or restore it before importing.`);
  }
  if (!Array.isArray(manifest?.sources)) fail(`${MANIFEST_PATH} has no sources array.`);
  manifest.sources.forEach((source, i) => {
    if (!isSafeSourcePath(source?.path)) {
      fail(`${MANIFEST_PATH} entry ${i + 1}${typeof source?.id === 'string' ? ` (${source.id})` : ''} has the path ${JSON.stringify(source?.path ?? null)}; a source path must be sources/<file name>. Fix or restore the manifest; nothing was read or changed.`);
    }
  });
  return manifest;
}

const SOURCE_PATH = /^sources\/[^/\\]+$/;
export const isSafeSourcePath = value => typeof value === 'string' && SOURCE_PATH.test(value) && !/^sources\/\.+$/.test(value);

// The absolute file of a manifest source, refused unless it lies directly inside <project>/sources.
export function sourceFile(root, source) {
  const folder = path.join(root, 'sources');
  const file = isSafeSourcePath(source.path) ? path.resolve(folder, source.path.slice('sources/'.length)) : null;
  if (!file || !file.startsWith(folder + path.sep) || path.dirname(file) !== folder) fail(`Source ${source.id} has the path ${JSON.stringify(source.path)}, outside the project's sources folder. Refusing to touch it.`);
  return file;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temp, file);
}

export function writeManifest(root, manifest) {
  writeJson(path.join(root, ...MANIFEST_PATH.split('/')), manifest);
}

function findSource(manifest, id) {
  if (!id) fail('Give the source id. List them with: import-image.mjs list <project>');
  const source = manifest.sources.find(item => item.id === id);
  if (!source) fail(`No source "${id}" in ${MANIFEST_PATH}. Known: ${manifest.sources.map(item => item.id).join(', ') || 'none (import one with add)'}.`);
  return source;
}

// { stale, reason, hash } for the file on disk against the manifest.
export function sourceStatus(root, source) {
  const file = sourceFile(root, source);
  if (!fs.existsSync(file)) return { stale: true, reason: `${source.path} is missing`, hash: null };
  const hash = hashBytes(fs.readFileSync(file));
  return hash === source.contentHash ? { stale: false, reason: null, hash } : { stale: true, reason: `${source.path} has changed since it was imported (revision ${source.revision})`, hash };
}

function requireFresh(root, source) {
  const status = sourceStatus(root, source);
  if (status.stale) {
    fail(`Source ${source.id} is stale: ${status.reason}. Nothing measures or draws from it until it is re-imported: import-image.mjs add <project> <file> --kind ${source.kind} --id ${source.id} --replace`);
  }
  return status;
}

function readModel(root, { required = false } = {}) {
  const file = path.join(root, 'models', 'building.json');
  if (!fs.existsSync(file)) {
    if (required) fail('place needs models/building.json, for the level ids and project.coordinates.trueNorthDeg. Write the model first.');
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`models/building.json is not valid JSON (${error.message}).`);
  }
}

function readBrief(root) {
  const file = path.join(root, 'brief.json');
  if (!fs.existsSync(file)) return { file, brief: null, error: null };
  try {
    return { file, brief: JSON.parse(fs.readFileSync(file, 'utf8')), error: null };
  } catch (error) {
    return { file, brief: null, error: `brief.json is not valid JSON (${error.message})` };
  }
}

export function displayUnits(root) {
  const model = (() => { try { return readModel(root); } catch { return null; } })();
  const fromModel = model?.project?.coordinates?.displayUnits;
  if (fromModel === 'metric' || fromModel === 'feet-inches') return fromModel;
  const { brief } = readBrief(root);
  return brief?.units === 'metric' ? 'metric' : 'feet-inches';
}

export function formatLength(mm, units) {
  if (units === 'metric') return Math.abs(mm) < 10000 ? `${Math.round(mm)} mm` : `${(mm / 1000).toFixed(2)} m`;
  const eighths = Math.round(Math.abs(mm) / 25.4 * 8);
  const feet = Math.floor(eighths / 96);
  const inches = Math.floor((eighths % 96) / 8);
  let num = eighths % 8;
  let den = 8;
  while (num && num % 2 === 0) { num /= 2; den /= 2; }
  return `${mm < 0 ? '-' : ''}${feet}'-${inches}${num ? ` ${num}/${den}` : ''}"`;
}

// Registers or updates the brief.json sources[] entry for an imported image. Returns
// { changed, legacyCalibration, warning }.
export function registerInBrief(root, { originalPath, path: relPath, kind, sourceId }) {
  const { file, brief, error } = readBrief(root);
  if (error) return { changed: false, legacyCalibration: null, warning: `${error}; it was not updated.` };
  if (!brief) return { changed: false, legacyCalibration: null, warning: null };
  if (brief.sources !== undefined && !Array.isArray(brief.sources)) return { changed: false, legacyCalibration: null, warning: 'brief.json sources is not a list; it was not updated.' };
  const before = JSON.stringify(brief);
  const sources = brief.sources ?? [];
  const same = entry => {
    const target = path.resolve(root, String(entry.path ?? ''));
    return [path.resolve(root, relPath), originalPath ? path.resolve(originalPath) : null].some(item => item && (process.platform === 'win32' ? item.toLowerCase() === target.toLowerCase() : item === target));
  };
  let entry = sources.find(item => item.sourceId === sourceId) ?? sources.find(item => !item.sourceId && same(item));
  const legacyCalibration = entry?.calibration && typeof entry.calibration.valueMm === 'number' ? { description: String(entry.calibration.description ?? ''), valueMm: entry.calibration.valueMm } : null;
  if (!entry) {
    entry = { path: relPath, kind, sourceId };
    sources.push(entry);
  } else {
    entry.path = relPath;
    entry.kind = kind;
    entry.sourceId = sourceId;
  }
  brief.sources = sources;
  const changed = JSON.stringify(brief) !== before;
  if (changed) writeJson(file, brief);
  return { changed, legacyCalibration, warning: null };
}

export function slugify(name) {
  let slug = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) slug = 'source';
  if (!/^[a-z]/.test(slug)) slug = `source-${slug}`;
  return slug;
}

// ---------------------------------------------------------------- reporting helpers

const pct = value => `${round(value * 100, 2)}%`;
const mmPx = value => `${round(value, 4)} mm/px`;

function describeScale(group) {
  const where = regionName(group.region);
  const { scale } = group;
  if (!scale) return `${where}: no active scale${group.calibrations.length ? ` (${group.calibrations.map(cal => `${cal.id} ${cal.method}${cal.method === 'known-object' && !cal.acceptedByUser ? ' not accepted' : ''}`).join(', ')})` : ''}`;
  return `${where}: ${mmPx(scale.mmPerPx)} ± ${pct(scale.relativeUncertainty)} from ${scale.calibrationIds.join(', ')} (${scale.methods.join(', ')}${scale.estimated ? ', estimated' : ''})`;
}

function groupsWithScale(source) {
  return allGroups(source).map(group => ({ ...group, scale: selectScale(group.calibrations) }));
}

// Recomputes the placement from its stored pairs after a calibration or north change. bumped says
// whether this operation already incremented calibrationRevision.
function recomputePlacement(root, source, out, { bumped = true } = {}) {
  const placement = source.placement;
  if (!placement) return;
  const { scale } = scaleFor(source, placement.pairs.map(pair => pair.pixel));
  const drop = reason => {
    delete source.placement;
    out.warn(`The placement on ${placement.view} was removed: ${reason}. Run place again.`);
  };
  if (!scale) return drop('no calibration covers its pairs any more');
  let trueNorthDeg = 0;
  if (placement.pairs.length === 1 || source.north) {
    const model = (() => { try { return readModel(root); } catch { return null; } })();
    if (!model && placement.pairs.length === 1) return drop('models/building.json is needed for trueNorthDeg');
    trueNorthDeg = modelTrueNorth(model);
  }
  if (placement.pairs.length === 1 && !source.north) return drop('its single pair needs north');
  const fit = fitPlacement({ pairs: placement.pairs, mmPerPx: scale.mmPerPx, northDeg: source.north?.deg ?? null, trueNorthDeg });
  commitPlacement(source, buildPlacement(source, placement.view, placement.pairs, fit, trueNorthDeg), { previous: placement, bumped });
  out.log(`Recomputed the placement on ${placement.view}: ${mmPx(fit.mmPerPx)}, rotation ${round(fit.rotationDeg, 2)}°, residuals ${fit.residualsMm.join(', ')} mm.`);
  for (const warning of placementWarnings(placement.pairs, fit.residualsMm)) out.warn(`Warning: ${warning}`);
  if (scale.disagreement) out.warn(`Warning: the placement uses the mean of calibrations that disagree (${scale.disagreement.maxId}, ${scale.disagreement.minId}); resolve them before tracing from it.`);
}

function buildPlacement(source, view, pairs, fit, trueNorthDeg) {
  const placement = {
    view,
    pairs,
    usesNorth: fit.usesNorth,
    mmPerPx: round(fit.mmPerPx, 6),
    rotationDeg: fit.rotationDeg,
    transform: fit.transform,
    residualsMm: fit.residualsMm,
    calibrationRevision: source.calibrationRevision,
    sourceRevision: source.revision,
    createdAt: now()
  };
  if (fit.usesNorth) placement.trueNorthDeg = normalizeDeg(trueNorthDeg);
  return placement;
}

// Installs a placement. When it moves an existing placement (view, pairs, or transform) and this
// operation has not bumped calibrationRevision yet, it bumps it, so evidence traced through the old
// transform reads as outdated in check.
function commitPlacement(source, placement, { previous = source.placement, bumped = false } = {}) {
  const geometry = item => JSON.stringify([item.view, item.pairs, item.transform]);
  if (!bumped && previous && geometry(previous) !== geometry(placement)) source.calibrationRevision += 1;
  placement.calibrationRevision = source.calibrationRevision;
  source.placement = placement;
}

// focus: the calibration just added, whose group is reported; null reports every group.
function calibrationChanged(root, source, out, focusCalibration) {
  source.calibrationRevision += 1;
  recomputePlacement(root, source, out);
  const groups = groupsWithScale(source);
  const focus = focusCalibration ? regionKey(focusCalibration.region) : null;
  for (const group of groups) {
    if (focus !== null && regionKey(group.region) !== focus) continue;
    out.log(`Active scale, ${describeScale(group)}`);
    if (group.scale?.disagreement) out.warn(`Warning: ${group.scale.disagreement.message}`);
  }
  out.log(`Evidence reference: ${evidenceReference(source)}`);
}

function nextCalibrationId(source) {
  // calibrationRevision only grows, so ids are never reused, even after replace or uncalibrate.
  return `cal-${source.calibrationRevision + 1}`;
}

function refuseCalibratingPhoto(source) {
  if (source.kind === 'photo') fail(`${source.id} is a photo. Photos are never calibrated: perspective is not a uniform scale. Use it for context, or import a measured drawing or survey instead.`);
}

function twoPointCalibration(source, { method, from, to, distanceMm, uncertaintyPx, estimated, provenance, region, accepted }) {
  checkSeparation(from, to, source.pixels, 'The calibration points');
  if (region && !(regionContains(region, from) && regionContains(region, to))) fail(`Both calibration points must lie inside ${regionName(region)}.`);
  const baselinePx = distance(from, to);
  const cal = {
    id: nextCalibrationId(source),
    method,
    estimated,
    from,
    to,
    distanceMm,
    baselinePx: round(baselinePx, 2),
    uncertaintyPx,
    mmPerPx: round(distanceMm / baselinePx, 6),
    relativeUncertainty: round(2 * uncertaintyPx / baselinePx, 6),
    provenance
  };
  if (region) cal.region = region;
  if (method === 'known-object') cal.acceptedByUser = Boolean(accepted);
  cal.sourceRevision = source.revision;
  cal.createdAt = now();
  return cal;
}

// ---------------------------------------------------------------- commands

function cmdAdd(args, out) {
  const root = projectRoot(args._[1]);
  const input = args._[2] ?? text(args, 'file');
  if (!input) fail('Give the image file: add <project> <file> --kind <kind>.');
  const file = path.resolve(String(input));
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`The image ${file} does not exist.`);
  const bytes = fs.readFileSync(file);
  const info = readImageInfo(bytes);
  const manifest = readManifest(root);
  const id = text(args, 'id') ?? slugify(path.basename(file, path.extname(file)));
  if (!ID_PATTERN.test(id)) fail(`The id "${id}" must start with a letter and use only lowercase letters, digits, and hyphens.`);
  const replace = Boolean(single(args, 'replace'));
  const existing = manifest.sources.find(item => item.id === id);
  if (existing && !replace) fail(`A source with id "${id}" already exists. Pass --replace to import a new version of it, or choose another --id.`);
  const kind = text(args, 'kind') ?? existing?.kind;
  if (!kind) fail(`Give --kind, one of: ${KINDS.join(', ')}.`);
  if (!KINDS.includes(kind)) fail(`--kind must be one of ${KINDS.join(', ')}; got "${kind}".`);
  const ext = EXTENSIONS[info.format].includes(path.extname(file).toLowerCase()) ? path.extname(file).toLowerCase() : EXTENSIONS[info.format][0];
  const relPath = `sources/${id}${ext}`;
  const dest = path.join(root, 'sources', `${id}${ext}`);
  const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const inPlace = samePath(file, dest);
  const taken = manifest.sources.find(item => item.id !== id && item.path === relPath);
  if (taken) fail(`${relPath} already belongs to source "${taken.id}". Choose another --id.`);
  if (!inPlace && fs.existsSync(dest) && !replace && !existing) fail(`${relPath} already exists in the project. Choose another --id, or pass --replace to overwrite it.`);
  const contentHash = hashBytes(bytes);
  const notes = text(args, 'notes');

  if (existing && existing.contentHash === contentHash && existing.path === relPath) {
    const restored = sourceStatus(root, existing).stale;
    if (restored) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (!inPlace) fs.copyFileSync(file, dest);
    }
    existing.kind = kind;
    if (notes !== undefined) existing.notes = notes;
    writeManifest(root, manifest);
    const brief = registerInBrief(root, { originalPath: file, path: relPath, kind, sourceId: id });
    if (brief.warning) out.warn(`Warning: ${brief.warning}`);
    out.log(restored
      ? `Restored ${relPath} from ${file}: it matches revision ${existing.revision}, so its calibrations and placement still apply.`
      : `${id} is unchanged (same file); revision ${existing.revision} kept.`);
    return 0;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!inPlace) fs.copyFileSync(file, dest);
  if (existing && existing.path !== relPath) {
    const old = sourceFile(root, existing);
    if (!samePath(old, file) && fs.existsSync(old)) fs.rmSync(old);
  }
  const source = {
    id,
    path: relPath,
    kind,
    format: info.format,
    contentHash,
    revision: existing ? existing.revision + 1 : 1,
    calibrationRevision: existing ? existing.calibrationRevision + 1 : 0,
    pixels: { width: info.width, height: info.height },
    exifOrientation: info.exifOrientation,
    importedAt: now()
  };
  const keptNotes = notes ?? existing?.notes;
  if (keptNotes !== undefined) source.notes = keptNotes;
  source.calibrations = [];
  source.references = [];
  if (existing?.legacyCalibration) source.legacyCalibration = existing.legacyCalibration;
  const brief = registerInBrief(root, { originalPath: file, path: relPath, kind, sourceId: id });
  if (brief.warning) out.warn(`Warning: ${brief.warning}`);
  if (brief.legacyCalibration) source.legacyCalibration = brief.legacyCalibration;
  if (existing) manifest.sources[manifest.sources.indexOf(existing)] = source;
  else manifest.sources.push(source);
  manifest.schemaVersion = SCHEMA_VERSION;
  writeManifest(root, manifest);

  out.log(`${existing ? 'Replaced' : 'Imported'} ${id}: ${relPath}, ${kind}, ${info.format.toUpperCase()} ${info.width}x${info.height} px${info.exifOrientation !== 1 ? ` (EXIF orientation ${info.exifOrientation} applied)` : ''}, revision ${source.revision}.`);
  if (existing) out.log('Its calibrations, north, references, and placement were cleared: the pixels may have moved. Calibrate it again.');
  if (brief.changed) out.log('Registered it in brief.json sources.');
  if (source.legacyCalibration) out.log(`brief.json had a calibration for it ("${source.legacyCalibration.description}", ${source.legacyCalibration.valueMm} mm) with no pixel points. Locate it on the image and record it with calibrate.`);
  if (kind === 'photo') out.log('Photos are context only: they are never calibrated or placed.');
  return 0;
}

function cmdCalibrate(args, out) {
  const root = projectRoot(args._[1]);
  const manifest = readManifest(root);
  const source = findSource(manifest, args._[2]);
  requireFresh(root, source);
  refuseCalibratingPhoto(source);
  const method = text(args, 'method', { required: true });
  const provenance = text(args, 'provenance', { required: true }).trim();
  if (!provenance) fail('--provenance must say where the distance came from.');
  const seen = parseSeen(single(args, 'seen'), source.pixels);
  const region = args.region !== undefined ? parseRegion(single(args, 'region'), source.pixels, seen) : null;
  let cal;
  if (SCALE_ONLY_METHODS.includes(method)) {
    if (args.from !== undefined || args.to !== undefined) fail(`${method} takes --mm-per-px, not --from and --to.`);
    cal = {
      id: nextCalibrationId(source),
      method,
      estimated: parseBool(single(args, 'estimated'), 'estimated', false),
      mmPerPx: parseNumber(single(args, 'mm-per-px'), 'mm-per-px', { positive: true }),
      relativeUncertainty: args['relative-uncertainty'] !== undefined ? parseNumber(single(args, 'relative-uncertainty'), 'relative-uncertainty', { min: 0 }) : 0.02,
      provenance
    };
    if (region) cal.region = region;
    cal.sourceRevision = source.revision;
    cal.createdAt = now();
  } else if (TWO_POINT_METHODS.includes(method)) {
    if (args['mm-per-px'] !== undefined) fail(`${method} takes --from, --to, and --distance, not --mm-per-px.`);
    const accepted = Boolean(single(args, 'accepted'));
    if (method === 'known-object' && !accepted) fail('A known-object calibration (a door, a car, a parking stall) is a guess until the user agrees with the size. Ask them, then pass --accepted.');
    const estimated = parseBool(single(args, 'estimated'), 'estimated', ESTIMATED_BY_DEFAULT.includes(method));
    cal = twoPointCalibration(source, {
      method,
      from: parsePixel(text(args, 'from', { required: true }), source, seen, '--from'),
      to: parsePixel(text(args, 'to', { required: true }), source, seen, '--to'),
      distanceMm: parseLength(text(args, 'distance', { required: true })),
      uncertaintyPx: args['uncertainty-px'] !== undefined ? parseNumber(single(args, 'uncertainty-px'), 'uncertainty-px', { min: 0 }) : (estimated ? 3 : 1),
      estimated,
      provenance,
      region,
      accepted
    });
  } else if (method === 'control-points') {
    fail('control-points calibrations come from place with two or more pairs on an uncalibrated image.');
  } else {
    fail(`--method must be one of ${[...TWO_POINT_METHODS, ...SCALE_ONLY_METHODS].join(', ')}; got "${method}".`);
  }
  const superseded = cal.method === 'known-object' && source.calibrations.find(item => item.method === 'known-object' && item.acceptedByUser && regionKey(item.region) === regionKey(cal.region));
  source.calibrations.push(cal);
  out.log(`Added ${cal.id} (${cal.method}${cal.estimated ? ', estimated' : ''}): ${mmPx(cal.mmPerPx)} ± ${pct(cal.relativeUncertainty)}${cal.region ? ` in ${regionName(cal.region)}` : ''}.`);
  if (superseded) out.warn(`Only one accepted known-object counts: ${cal.id} supersedes ${superseded.id}. Remove ${superseded.id} with uncalibrate if it is wrong.`);
  calibrationChanged(root, source, out, cal);
  writeManifest(root, manifest);
  return 0;
}

function cmdUncalibrate(args, out) {
  const root = projectRoot(args._[1]);
  const manifest = readManifest(root);
  const source = findSource(manifest, args._[2]);
  requireFresh(root, source);
  const calId = args._[3] ?? text(args, 'calibration');
  const index = source.calibrations.findIndex(cal => cal.id === calId);
  if (index === -1) fail(`${source.id} has no calibration "${calId}". It has: ${source.calibrations.map(cal => cal.id).join(', ') || 'none'}.`);
  const [removed] = source.calibrations.splice(index, 1);
  out.log(`Removed ${removed.id} (${removed.method}).`);
  calibrationChanged(root, source, out, null);
  writeManifest(root, manifest);
  return 0;
}

function cmdNorth(args, out) {
  const root = projectRoot(args._[1]);
  const manifest = readManifest(root);
  const source = findSource(manifest, args._[2]);
  requireFresh(root, source);
  const deg = parseNumber(single(args, 'deg'), 'deg');
  const from = text(args, 'source', { required: true });
  if (!NORTH_SOURCES.includes(from)) fail(`--source must be one of ${NORTH_SOURCES.join(', ')}; got "${from}".`);
  source.north = { deg: normalizeDeg(deg), source: from };
  const note = text(args, 'note');
  if (note) source.north.note = note;
  out.log(`North on ${source.id}: ${source.north.deg}° clockwise from image-up (${from}).`);
  if (from === 'assumed') out.warn('An assumed north must also be listed as an assumption (ASSUMPTIONS.md, brief.json assumptions).');
  if (source.placement?.usesNorth) {
    recomputePlacement(root, source, out, { bumped: false });
    out.log(`Evidence reference: ${evidenceReference(source)}`);
  }
  else if (source.placement) out.log('The placement fits its rotation from its pairs; north does not change it.');
  writeManifest(root, manifest);
  return 0;
}

function cmdReference(args, out) {
  const root = projectRoot(args._[1]);
  const manifest = readManifest(root);
  const source = findSource(manifest, args._[2]);
  requireFresh(root, source);
  const label = text(args, 'label', { required: true }).trim();
  if (!label) fail('--label must not be empty.');
  const at = text(args, 'at', { required: true });
  if (at.startsWith('ref:')) fail('--at needs pixel coordinates x,y.');
  const pixel = parsePixel(at, source, parseSeen(single(args, 'seen'), source.pixels), '--at');
  const existing = source.references.find(item => item.label === label);
  if (existing) existing.pixel = pixel;
  else source.references.push({ label, pixel });
  out.log(`${existing ? 'Moved' : 'Marked'} reference "${label}" at (${pixel.x}, ${pixel.y}) on ${source.id}. Use it as ref:${label}.`);
  writeManifest(root, manifest);
  return 0;
}

export function parsePair(textValue, source, seen) {
  const parts = String(textValue).split('=');
  if (parts.length < 2) fail(`--pair needs px,py=mx,my[=label], got ${JSON.stringify(textValue)}.`);
  const [pixelText, modelText, ...rest] = parts;
  const pixel = parsePixel(pixelText, source, seen, `--pair ${textValue}`);
  const m = modelText.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) fail(`--pair ${textValue}: the model point must be x,y in millimetres.`);
  const pair = {};
  const label = rest.join('=').trim() || (pixelText.trim().startsWith('ref:') ? pixelText.trim().slice(4).trim() : '');
  if (label) pair.label = label;
  pair.pixel = pixel;
  pair.model = { x: Math.round(Number(m[1])), y: Math.round(Number(m[2])) };
  return pair;
}

function cmdPlace(args, out) {
  const root = projectRoot(args._[1]);
  const manifest = readManifest(root);
  const source = findSource(manifest, args._[2]);
  requireFresh(root, source);
  if (source.kind === 'photo') fail(`${source.id} is a photo; photos are never calibrated or placed.`);
  const model = readModel(root, { required: true });
  const view = text(args, 'view', { required: true });
  const levels = (model.levels ?? []).map(level => level.id);
  if (view !== 'site' && !levels.includes(view)) fail(`--view must be site or a level id of the model (${levels.join(', ') || 'none'}); got "${view}".`);
  const pairArgs = [].concat(args.pair ?? []).filter(item => item !== true);
  if (!pairArgs.length) fail('place needs at least one --pair px,py=mx,my[=label].');
  const seen = parseSeen(single(args, 'seen'), source.pixels);
  const pairs = pairArgs.map(item => parsePair(item, source, seen));
  for (let i = 0; i < pairs.length; i += 1) {
    for (let j = i + 1; j < pairs.length; j += 1) {
      checkSeparation(pairs[i].pixel, pairs[j].pixel, source.pixels, `The pixel points of pairs ${i + 1} and ${j + 1}`);
      if (pairs[i].model.x === pairs[j].model.x && pairs[i].model.y === pairs[j].model.y) fail(`Pairs ${i + 1} and ${j + 1} have the same model point.`);
    }
  }
  const trueNorthDeg = model.project?.coordinates?.trueNorthDeg ?? 0;
  const group = scaleFor(source, pairs.map(pair => pair.pixel));
  const force = Boolean(single(args, 'force'));
  let fit;
  let bumped = false;
  if (group.scale) {
    if (group.scale.disagreement && !force) fail(`${group.scale.disagreement.message} Pass --force to place with the mean scale anyway.`);
    fit = fitPlacement({ pairs, mmPerPx: group.scale.mmPerPx, northDeg: source.north?.deg ?? null, trueNorthDeg });
    out.log(`Placed ${source.id} on ${view} at the calibrated scale, ${describeScale(group)}.`);
  } else {
    if (pairs.length < 2) fail(`${source.id} has no calibration for these points (${regionName(group.region)}). Calibrate it, or give two or more --pair points to fit the scale.`);
    fit = fitPlacement({ pairs, northDeg: source.north?.deg ?? null, trueNorthDeg });
    let from = 0;
    let to = 1;
    for (let i = 0; i < pairs.length; i += 1) for (let j = i + 1; j < pairs.length; j += 1) if (distance(pairs[i].pixel, pairs[j].pixel) > distance(pairs[from].pixel, pairs[to].pixel)) [from, to] = [i, j];
    const baselinePx = distance(pairs[from].pixel, pairs[to].pixel);
    const uncertaintyPx = args['uncertainty-px'] !== undefined ? parseNumber(single(args, 'uncertainty-px'), 'uncertainty-px', { min: 0 }) : 2;
    const allRefs = pairArgs.every(item => String(item).trim().startsWith('ref:'));
    const cal = {
      id: nextCalibrationId(source),
      method: 'control-points',
      estimated: parseBool(single(args, 'estimated'), 'estimated', !allRefs),
      from: pairs[from].pixel,
      to: pairs[to].pixel,
      distanceMm: round(distance(pairs[from].model, pairs[to].model), 3),
      baselinePx: round(baselinePx, 2),
      uncertaintyPx,
      mmPerPx: round(fit.mmPerPx, 6),
      relativeUncertainty: round(2 * uncertaintyPx / baselinePx, 6),
      provenance: `fitted to ${pairs.length} image-to-model pairs${pairs.some(pair => pair.label) ? ` (${pairs.map((pair, i) => pair.label ?? `#${i + 1}`).join(', ')})` : ''} on ${view}`
    };
    if (group.region) cal.region = group.region;
    cal.sourceRevision = source.revision;
    cal.createdAt = now();
    source.calibrations.push(cal);
    source.calibrationRevision += 1;
    bumped = true;
    out.log(`${source.id} had no calibration for these points, so the pairs fixed the scale: added ${cal.id} (control-points) ${mmPx(cal.mmPerPx)} ± ${pct(cal.relativeUncertainty)}.`);
    fit = fitPlacement({ pairs, mmPerPx: cal.mmPerPx, northDeg: source.north?.deg ?? null, trueNorthDeg });
  }
  const previous = source.placement;
  commitPlacement(source, buildPlacement(source, view, pairs, fit, trueNorthDeg), { previous, bumped });
  if (previous && source.calibrationRevision !== previous.calibrationRevision) out.log('The placement moved: geometry traced through the previous placement now reads as outdated in check.');
  const t = fit.transform;
  out.log(`Placement: ${mmPx(fit.mmPerPx)}, rotation ${round(fit.rotationDeg, 2)}° counter-clockwise${fit.usesNorth ? ` (from north ${source.north.deg}° and trueNorthDeg ${trueNorthDeg}°)` : ''}, transform a=${t.a} b=${t.b} c=${t.c} d=${t.d} e=${t.e} f=${t.f}.`);
  out.log(`Residuals: ${fit.residualsMm.map((r, i) => `${pairs[i].label ?? `#${i + 1}`} ${r} mm`).join(', ')}.`);
  for (const warning of placementWarnings(pairs, fit.residualsMm)) out.warn(`Warning: ${warning}`);
  if (!fit.usesNorth && source.north && pairs.length > 1) {
    let diff = Math.abs(fit.rotationDeg - normalizeDeg(source.north.deg - trueNorthDeg)) % 360;
    if (diff > 180) diff = 360 - diff;
    if (diff > 3) out.warn(`Warning: the fitted rotation differs by ${round(diff, 1)}° from the one north implies (north ${source.north.deg}° minus trueNorthDeg ${trueNorthDeg}°). Check north and the pairs.`);
  }
  out.log(`Evidence reference: ${evidenceReference(source)}`);
  writeManifest(root, manifest);
  return 0;
}

// Policy values from the contract's evidence table, not accuracies.
function evidenceConfidence(scale, relativeUncertainty) {
  if (scale.methods.includes('known-object')) return { source: 'heuristic', confidence: 0.2 };
  if (scale.precise) return { source: 'attachment', confidence: relativeUncertainty > 0.02 ? 0.5 : 0.6 };
  return { source: 'attachment', confidence: 0.4 };
}

function cmdMeasure(args, out) {
  const root = projectRoot(args._[1]);
  const manifest = readManifest(root);
  const source = findSource(manifest, args._[2]);
  requireFresh(root, source);
  if (source.kind === 'photo') fail(`${source.id} is a photo; photos are never measured (perspective is not a uniform scale).`);
  const seen = parseSeen(single(args, 'seen'), source.pixels);
  const from = parsePixel(text(args, 'from', { required: true }), source, seen, '--from');
  const to = parsePixel(text(args, 'to', { required: true }), source, seen, '--to');
  const lengthPx = distance(from, to);
  if (lengthPx === 0) fail('--from and --to are the same point.');
  const group = scaleFor(source, [from, to]);
  if (!group.scale) fail(`${source.id} has no active scale for these points (${regionName(group.region)}). Calibrate it first${source.legacyCalibration ? `; brief.json noted "${source.legacyCalibration.description}"` : ''}.`);
  if (group.scale.disagreement && !single(args, 'force')) fail(`${group.scale.disagreement.message} Pass --force to measure with the mean scale anyway.`);
  const endpointPx = args['uncertainty-px'] !== undefined ? parseNumber(single(args, 'uncertainty-px'), 'uncertainty-px', { min: 0 }) : 3;
  const mm = lengthPx * group.scale.mmPerPx;
  const relativeUncertainty = measureUncertainty(group.scale.relativeUncertainty, endpointPx, lengthPx);
  const units = displayUnits(root);
  const evidence = evidenceConfidence(group.scale, relativeUncertainty);
  const result = {
    sourceId: source.id,
    from,
    to,
    lengthPx: round(lengthPx, 2),
    distanceMm: Math.round(mm),
    uncertaintyMm: Math.round(mm * relativeUncertainty),
    relativeUncertainty: round(relativeUncertainty, 4),
    display: formatLength(mm, units),
    displayUncertainty: formatLength(mm * relativeUncertainty, units),
    mmPerPx: round(group.scale.mmPerPx, 6),
    scaleRelativeUncertainty: round(group.scale.relativeUncertainty, 6),
    region: group.region ?? null,
    calibrationIds: group.scale.calibrationIds,
    methods: group.scale.methods,
    estimated: group.scale.estimated,
    forced: Boolean(group.scale.disagreement),
    reference: evidenceReference(source),
    evidenceSource: evidence.source,
    confidence: evidence.confidence
  };
  if (single(args, 'json')) out.log(JSON.stringify(result, null, 2));
  else {
    out.log(`${result.display} (${result.distanceMm} mm) ± ${result.displayUncertainty} (± ${result.uncertaintyMm} mm, ${pct(relativeUncertainty)})`);
    out.log(`Scale: ${describeScale(group)}; endpoints ± ${endpointPx} px over ${result.lengthPx} px.`);
    out.log(`Evidence: source ${evidence.source}, confidence ${evidence.confidence}, status needs-review, reference ${result.reference}.`);
  }
  if (group.scale.disagreement) out.warn(`Warning: measured despite disagreement (--force). ${group.scale.disagreement.message}`);
  return 0;
}

function cmdToModel(args, out) {
  const root = projectRoot(args._[1]);
  const manifest = readManifest(root);
  const source = findSource(manifest, args._[2]);
  requireFresh(root, source);
  if (!source.placement) fail(`${source.id} is not placed. Run place first.`);
  const staleReason = placementStaleReason(source, readModel(root));
  if (staleReason) fail(`The placement of ${source.id} is stale: ${staleReason}. Re-run place.`);
  const seen = parseSeen(single(args, 'seen'), source.pixels);
  const inputs = args._.slice(3);
  if (!inputs.length) fail('Give one or more pixel points: to-model <project> <id> x,y [x,y ...].');
  const points = inputs.map(item => {
    const pixel = parsePixel(item, source, seen, item);
    const model = applyTransform(source.placement.transform, pixel);
    return { input: item, pixel, model: { x: Math.round(model.x), y: Math.round(model.y) } };
  });
  const result = { sourceId: source.id, view: source.placement.view, reference: evidenceReference(source), points };
  if (single(args, 'json')) out.log(JSON.stringify(result, null, 2));
  else {
    out.log(`Model millimetres on ${result.view} (${result.reference}):`);
    for (const point of points) out.log(`  ${point.input} -> ${point.model.x}, ${point.model.y}`);
  }
  return 0;
}

// Extracts and shape-checks the viewer's calibration payload (the JSON between the first { and last }).
export function parseCalibrationPayload(input) {
  const raw = String(input);
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) fail('No calibration found in the pasted text. Copy it again from the viewer and paste all of it.');
  let payload;
  try {
    payload = JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    fail(`The pasted calibration is not valid JSON (${error.message}). Copy it again from the viewer and paste all of it unchanged.`);
  }
  if (payload?.type !== PAYLOAD_TYPE) fail(`The pasted text is not an Architecture Studio source calibration (type ${JSON.stringify(payload?.type)}).`);
  if (payload.version !== 1) fail(`Unsupported calibration version ${JSON.stringify(payload.version)}; update the skill or the project's viewer (init.mjs --update).`);
  const isPoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  if (typeof payload.sourceId !== 'string' || typeof payload.contentHash !== 'string' || !Number.isInteger(payload.pixels?.width) || !Number.isInteger(payload.pixels?.height)
    || !Number.isInteger(payload.sourceRevision) || !Number.isInteger(payload.calibrationRevision)) fail('The pasted calibration is missing sourceId, contentHash, pixels, sourceRevision, or calibrationRevision.');
  if (!payload.calibration && !(payload.references?.length)) fail('The pasted text has neither a calibration nor reference points.');
  const cal = payload.calibration;
  if (cal && (!isPoint(cal.from) || !isPoint(cal.to) || !(cal.distanceMm > 0) || !(cal.uncertaintyPx >= 0))) fail('The pasted calibration needs from, to, a positive distanceMm, and uncertaintyPx.');
  if (payload.references !== undefined && (!Array.isArray(payload.references) || payload.references.some(ref => typeof ref?.label !== 'string' || !ref.label.trim() || !isPoint(ref.pixel)))) fail('The pasted reference points need a label and a pixel.');
  return payload;
}

async function cmdApply(args, out, io) {
  const root = projectRoot(args._[1]);
  let input;
  const fileArg = text(args, 'file');
  if (fileArg) input = fs.readFileSync(path.resolve(fileArg), 'utf8');
  else if (args._[2] === '-' || args._.length < 3) {
    if (args._.length < 3 && !io.readStdinExplicit && process.stdin.isTTY) fail('Give the pasted text, --file <path>, or - to read it from stdin.');
    input = await io.readStdin();
  } else input = args._.slice(2).join(' ');
  const payload = parseCalibrationPayload(input);
  const manifest = readManifest(root);
  const source = findSource(manifest, payload.sourceId);
  const redo = 'Reload the viewer, redo the calibration, and copy it again.';
  if (payload.contentHash !== source.contentHash) fail(`The calibration was made on a different version of ${source.id} (its content hash differs from ${MANIFEST_PATH}). ${redo}`);
  const status = sourceStatus(root, source);
  if (status.stale) fail(`Source ${source.id} is stale: ${status.reason}. Re-import it with add --replace, then ${redo.toLowerCase()}`);
  if (payload.pixels.width !== source.pixels.width || payload.pixels.height !== source.pixels.height) fail(`The calibration was made on a ${payload.pixels.width}x${payload.pixels.height} image, but ${source.id} is ${source.pixels.width}x${source.pixels.height}. ${redo}`);
  if (payload.sourceRevision !== source.revision) fail(`The calibration was made on revision ${payload.sourceRevision} of ${source.id}; it is now revision ${source.revision}. ${redo}`);
  if (payload.calibrationRevision !== source.calibrationRevision) fail(`The pasted calibration is stale: ${source.id}'s calibrations changed since the viewer loaded them (calibrationRevision ${payload.calibrationRevision}, now ${source.calibrationRevision}). ${redo}`);
  const references = (payload.references ?? []).map(ref => {
    const pixel = { x: round(ref.pixel.x, 2), y: round(ref.pixel.y, 2) };
    checkInImage(pixel, source.pixels, `Reference "${ref.label}"`);
    return { label: ref.label.trim(), pixel };
  });
  let cal = null;
  if (payload.calibration) {
    refuseCalibratingPhoto(source);
    const c = payload.calibration;
    const from = { x: round(c.from.x, 2), y: round(c.from.y, 2) };
    const to = { x: round(c.to.x, 2), y: round(c.to.y, 2) };
    checkInImage(from, source.pixels, 'The calibration start');
    checkInImage(to, source.pixels, 'The calibration end');
    let region = null;
    if (c.region) {
      const r = c.region;
      if (![r.x0, r.y0, r.x1, r.y1].every(Number.isFinite)) fail('The pasted region needs x0, y0, x1, y1.');
      region = parseRegion(`${r.x0},${r.y0},${r.x1},${r.y1}${r.label ? `,${r.label}` : ''}`, source.pixels);
    }
    const entered = typeof c.entered === 'string' && c.entered.trim() ? c.entered.trim() : `${round(c.distanceMm, 1)} mm`;
    cal = twoPointCalibration(source, { method: 'manual', from, to, distanceMm: round(c.distanceMm, 3), uncertaintyPx: round(c.uncertaintyPx, 2), estimated: false, provenance: `manual calibration in the viewer: ${entered}`, region });
  }
  for (const ref of references) {
    const existing = source.references.find(item => item.label === ref.label);
    if (existing) existing.pixel = ref.pixel;
    else source.references.push(ref);
  }
  if (references.length) out.log(`Recorded ${references.length} reference point(s) on ${source.id}: ${references.map(ref => ref.label).join(', ')}.`);
  if (cal) {
    source.calibrations.push(cal);
    out.log(`Added ${cal.id} (manual): ${mmPx(cal.mmPerPx)} ± ${pct(cal.relativeUncertainty)}${cal.region ? ` in ${regionName(cal.region)}` : ''}.`);
    calibrationChanged(root, source, out, cal);
  }
  writeManifest(root, manifest);
  return 0;
}

const REFERENCE_PATTERN = /^source:([a-z][a-z0-9-]*)@(\d+)\.(\d+)$/;

// Every object in a model whose evidence.reference names a source image.
export function findSourceReferences(model) {
  const found = [];
  const walk = (node, at) => {
    if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${at}[${i}]`)); return; }
    if (!node || typeof node !== 'object') return;
    const reference = node.evidence?.reference;
    if (typeof reference === 'string' && reference.startsWith('source:')) found.push({ entityId: node.id ?? at, path: at, reference, status: node.evidence.status });
    for (const [key, value] of Object.entries(node)) if (key !== 'evidence') walk(value, `${at}.${key}`);
  };
  walk(model, '$');
  return found;
}

export function checkEvidenceReference(reference, manifest) {
  const m = reference.match(REFERENCE_PATTERN);
  if (!m) return `the reference "${reference}" is not source:<id>@<revision>.<calibrationRevision>`;
  const source = manifest.sources.find(item => item.id === m[1]);
  if (!source) return `it references an unknown source "${m[1]}"`;
  const [rev, calRev] = [Number(m[2]), Number(m[3])];
  if (rev < source.revision || (rev === source.revision && calRev < source.calibrationRevision)) return `it was derived from ${m[1]}@${rev}.${calRev}, older than the current ${source.revision}.${source.calibrationRevision}`;
  if (rev > source.revision || calRev > source.calibrationRevision) return `it references ${m[1]}@${rev}.${calRev}, which does not exist yet (current ${source.revision}.${source.calibrationRevision})`;
  return null;
}

export function checkProject(root) {
  const manifest = readManifest(root);
  const report = { ok: true, sources: [], evidence: [], problems: [], warnings: [] };
  const model = (() => { try { return readModel(root); } catch { return null; } })();
  for (const source of manifest.sources) {
    const status = sourceStatus(root, source);
    const entry = { id: source.id, path: source.path, revision: source.revision, calibrationRevision: source.calibrationRevision, stale: status.stale, reason: status.reason, placementStale: isPlacementStale(source, model), disagreements: [] };
    if (status.stale) report.problems.push(`Source ${source.id} is stale: ${status.reason}. Re-import it with add --replace.`);
    if (entry.placementStale) report.problems.push(`The placement of ${source.id} is stale: ${placementStaleReason(source, model)}. Re-run place.`);
    for (const group of groupsWithScale(source)) {
      if (group.scale?.disagreement) {
        entry.disagreements.push(group.scale.disagreement.message);
        report.warnings.push(`${source.id}, ${regionName(group.region)}: ${group.scale.disagreement.message}`);
      }
    }
    if (source.legacyCalibration) report.warnings.push(`${source.id} has a calibration from brief.json with no pixel points ("${source.legacyCalibration.description}"). Locate it on the image and record it with calibrate.`);
    report.sources.push(entry);
  }
  const modelFiles = [];
  if (fs.existsSync(path.join(root, 'models', 'building.json'))) modelFiles.push('models/building.json');
  const variants = path.join(root, 'models', 'variants');
  if (fs.existsSync(variants)) for (const name of fs.readdirSync(variants).sort()) if (name.endsWith('.json')) modelFiles.push(`models/variants/${name}`);
  for (const file of modelFiles) {
    let model;
    try {
      model = JSON.parse(fs.readFileSync(path.join(root, ...file.split('/')), 'utf8'));
    } catch (error) {
      report.problems.push(`${file} is not valid JSON (${error.message}).`);
      continue;
    }
    for (const item of findSourceReferences(model)) {
      const problem = checkEvidenceReference(item.reference, manifest);
      if (!problem) continue;
      const needsReapproval = item.status === 'accepted';
      report.evidence.push({ file, entityId: item.entityId, path: item.path, reference: item.reference, problem, accepted: needsReapproval });
      report.problems.push(`${file} ${item.entityId}: ${problem}. Re-derive it from the current image${needsReapproval ? ' and ask the user to approve it again (it is accepted)' : ''}.`);
    }
  }
  report.ok = report.problems.length === 0;
  return report;
}

function cmdCheck(args, out) {
  const root = projectRoot(args._[1]);
  const report = checkProject(root);
  if (single(args, 'json')) out.log(JSON.stringify(report, null, 2));
  else {
    out.log(`${report.sources.length} source image(s); ${report.evidence.length} outdated evidence reference(s).`);
    for (const problem of report.problems) out.log(`- problem: ${problem}`);
    for (const warning of report.warnings) out.log(`- warning: ${warning}`);
    if (report.ok) out.log('No stale sources, placements, or evidence references.');
  }
  return report.ok ? 0 : 1;
}

function cmdList(args, out) {
  const root = projectRoot(args._[1]);
  const manifest = readManifest(root);
  const model = (() => { try { return readModel(root); } catch { return null; } })();
  const rows = manifest.sources.map(source => {
    const status = sourceStatus(root, source);
    return { source, status, groups: groupsWithScale(source) };
  });
  if (single(args, 'json')) {
    out.log(JSON.stringify(rows.map(({ source, status, groups }) => ({
      id: source.id, path: source.path, kind: source.kind, format: source.format, pixels: source.pixels,
      revision: source.revision, calibrationRevision: source.calibrationRevision, reference: evidenceReference(source),
      stale: status.stale, reason: status.reason, north: source.north ?? null,
      scales: groups.map(group => ({ region: group.region, mmPerPx: group.scale ? round(group.scale.mmPerPx, 6) : null, relativeUncertainty: group.scale ? round(group.scale.relativeUncertainty, 6) : null, calibrationIds: group.scale?.calibrationIds ?? [], disagreement: group.scale?.disagreement?.message ?? null })),
      placement: source.placement ? { view: source.placement.view, pairs: source.placement.pairs.length, residualsMm: source.placement.residualsMm, stale: isPlacementStale(source, model) } : null,
      references: source.references.map(ref => ref.label)
    })), null, 2));
    return 0;
  }
  if (!rows.length) { out.log(`No source images yet. Import one with: import-image.mjs add <project> <file> --kind <kind>`); return 0; }
  for (const { source, status, groups } of rows) {
    out.log(`${source.id}  ${source.kind}  ${source.path}  ${source.pixels.width}x${source.pixels.height} ${source.format}  ${evidenceReference(source)}  ${status.stale ? `STALE (${status.reason})` : 'current'}`);
    for (const group of groups) out.log(`  scale, ${describeScale(group)}${group.scale?.disagreement ? ' [calibrations disagree]' : ''}`);
    if (source.north) out.log(`  north: ${source.north.deg}° (${source.north.source})`);
    if (source.references.length) out.log(`  references: ${source.references.map(ref => ref.label).join(', ')}`);
    if (source.placement) out.log(`  placed on ${source.placement.view}: ${source.placement.pairs.length} pair(s), residuals ${source.placement.residualsMm.join(', ')} mm${isPlacementStale(source, model) ? ' (STALE)' : ''}`);
    if (source.legacyCalibration) out.log(`  brief.json calibration without pixels: ${source.legacyCalibration.description} (${source.legacyCalibration.valueMm} mm)`);
  }
  return 0;
}

export const USAGE = `Usage: node <skill>/scripts/import-image.mjs <command> <project> ...

  add         <project> <file> --kind <kind> [--id <id>] [--replace] [--notes <text>]
  calibrate   <project> <id> --method printed-dimension|scale-bar|manual|known-object
                --from x,y --to x,y --distance <length> --provenance <text>
                [--seen WxH] [--uncertainty-px n] [--region x0,y0,x1,y1[,label]]
                [--estimated true|false] [--accepted]
  calibrate   <project> <id> --method stated-scale|map-metadata --mm-per-px n --provenance <text>
                [--relative-uncertainty u] [--region x0,y0,x1,y1[,label]]
  uncalibrate <project> <id> <calibration-id>
  north       <project> <id> --deg n --source north-arrow|survey-basis|user|assumed [--note <text>]
  reference   <project> <id> --label <text> --at x,y [--seen WxH]
  place       <project> <id> --view site|<levelId> --pair px,py=mx,my[=label] [--pair ...]
                [--seen WxH] [--uncertainty-px n] [--estimated true|false] [--force]
  measure     <project> <id> --from x,y --to x,y [--seen WxH] [--uncertainty-px n] [--force] [--json]
  to-model    <project> <id> x,y [x,y ...] [--seen WxH] [--json]
  apply       <project> [<pasted text> | --file <path> | -]
  check       <project> [--json]
  list        <project> [--json]

Kinds: ${KINDS.join(', ')}.
Pixels are canonical: the upright image (after EXIF rotation), origin top-left, y down.
A pixel point may be ref:<label> for a stored reference point. --seen WxH rescales
coordinates read from a resized copy; --uncertainty-px is always in full-size image
pixels and is not rescaled by --seen. Lengths need units: 3810mm, 3.81m, 381cm,
12.5ft, 12', 12'-6", 150in. Model points are millimetres.`;

const COMMANDS = { add: cmdAdd, calibrate: cmdCalibrate, uncalibrate: cmdUncalibrate, north: cmdNorth, reference: cmdReference, place: cmdPlace, measure: cmdMeasure, 'to-model': cmdToModel, apply: cmdApply, check: cmdCheck, list: cmdList };

function readProcessStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

// Runs one command and returns its exit code. Output goes through io.log / io.error.
export async function run(argv, io = {}) {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const out = { log, warn: io.warn ?? error };
  const args = parseArgs(argv);
  const command = args._[0];
  if (args.help || !command) {
    log(USAGE);
    return args.help ? 0 : 1;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    error(`Unknown command "${command}".\n\n${USAGE}`);
    return 1;
  }
  try {
    return await handler(args, out, { readStdin: io.readStdin ?? readProcessStdin, readStdinExplicit: Boolean(io.readStdin) });
  } catch (caught) {
    if (caught instanceof CliError) { error(`Error: ${caught.message}`); return 1; }
    error(`Error: ${caught instanceof Error ? caught.stack : String(caught)}`);
    return 1;
  }
}

if (isMain(import.meta)) process.exitCode = await run(process.argv.slice(2));
