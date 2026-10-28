import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initProject } from '../scripts/init.mjs';
import { CALIBRATION_PATH, PROJECT_FILES_PATH, TOKEN_HEADER, UPLOAD_PATH, WRITE_META, createStudioServer, listen, projectFiles } from '../scripts/serve.mjs';
import { png } from './helpers/images.mjs';

const skillRoot = path.resolve(import.meta.dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'lakeside-barn-residence', 'building.json'), 'utf8'));

// A project served on a free port. The server is closed before the temp folder is removed, because
// Windows will not delete a folder a process still holds.
async function withStudio(t, options, fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-studio-serve-'));
  const dir = path.join(base, 'project');
  initProject(dir);
  fs.writeFileSync(path.join(dir, 'models', 'building.json'), JSON.stringify(fixture));
  const { server, token } = createStudioServer(dir, { watch: false, ...options });
  const port = await listen(server, 0);
  try {
    await fn({ dir, port, token });
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 });
  }
}

function send(port, method, pathname, { headers = {}, body, chunked = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined && chunked) {
      const bytes = Buffer.from(body);
      const half = Math.floor(bytes.length / 2);
      req.write(bytes.subarray(0, half));
      req.end(bytes.subarray(half));
    } else req.end(body);
  });
}

const upload = (port, token, query, bytes, headers = {}) => send(port, 'POST', `${UPLOAD_PATH}?${new URLSearchParams(query)}`, { headers: { 'content-type': 'image/png', [TOKEN_HEADER]: token, ...headers }, body: bytes });
const calibrate = (port, token, payload, headers = {}) => send(port, 'POST', CALIBRATION_PATH, { headers: { 'content-type': 'application/json', [TOKEN_HEADER]: token, ...headers }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });
const manifestOf = dir => JSON.parse(fs.readFileSync(path.join(dir, 'sources', 'sources.json'), 'utf8'));
const payloadFor = (source, extra = {}) => ({
  type: 'architecture-studio/source-calibration', version: 1, sourceId: source.id, contentHash: source.contentHash, pixels: source.pixels,
  sourceRevision: source.revision, calibrationRevision: source.calibrationRevision,
  calibration: { from: { x: 100, y: 700 }, to: { x: 600, y: 700 }, distanceMm: 5000, entered: '5 m', uncertaintyPx: 0.5 },
  references: [{ label: 'NE house corner', pixel: { x: 812.3, y: 140.5 } }],
  ...extra
});

test('serve puts a per-start write token in the served page only', async t => {
  await withStudio(t, {}, async ({ dir, port, token }) => {
    assert.match(token, /^[0-9a-f]{48}$/);
    const page = await send(port, 'GET', '/');
    assert.equal(page.status, 200);
    const meta = `<meta name="${WRITE_META}" content="${token}">`;
    assert.ok(page.text.includes(`${meta}</head>`), 'the token sits in <head>, with live reload off too');
    const onDisk = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.doesNotMatch(onDisk, new RegExp(`<meta name="${WRITE_META}"`), 'never on disk');
    assert.ok(!onDisk.includes(token));
    assert.ok((await send(port, 'GET', '/index.html')).text.includes(meta));
    const rebound = await send(port, 'GET', '/', { headers: { host: `attacker.example:${port}` } });
    assert.equal(rebound.status, 200);
    assert.doesNotMatch(rebound.text, new RegExp(`<meta name="${WRITE_META}"`), 'a page reached through another host name gets no token');
  });
  await withStudio(t, { watch: true }, async ({ port, token }) => {
    const page = await send(port, 'GET', '/');
    assert.ok(page.text.includes(`<meta name="${WRITE_META}" content="${token}">`));
  });
});

test('Export project lists the project contract and reads the viewer without its token', async t => {
  await withStudio(t, { watch: true }, async ({ dir, port, token }) => {
    const write = (file, text = 'x') => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
    for (const file of ['brief.json', 'HANDOFF.md', 'sources/site photo.png', 'reviews/code-findings.json', 'exports/manifest.json', 'exports/plans/level-1.svg', 'models/variants/option-b.json']) write(file);
    for (const file of ['.env', 'notes.txt', 'node_modules/a.js', 'models/.cache/state.json', 'sources/.DS_Store', '.git/HEAD']) write(file);
    const listed = await send(port, 'GET', PROJECT_FILES_PATH);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.json.files, [
      'HANDOFF.md', 'Open Studio.cmd', 'Open Studio.command', 'architecture-studio.json', 'brief.json', 'exports/manifest.json', 'exports/plans/level-1.svg', 'index.html',
      'models/building.json', 'models/variants/option-b.json', 'open-studio.mjs', 'reviews/code-findings.json', 'sources/site photo.png'
    ]);
    assert.deepEqual(projectFiles(dir), listed.json.files);
    assert.ok(!listed.text.includes(token));

    const raw = await send(port, 'GET', '/index.html?raw=1');
    assert.equal(raw.status, 200);
    assert.equal(raw.text, fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), 'the viewer exactly as stored');
    assert.ok(!raw.text.includes(token));
    assert.ok((await send(port, 'GET', '/index.html')).text.includes(token), 'the live page keeps its token');
    assert.equal((await send(port, 'GET', `/${encodeURIComponent('sources')}/${encodeURIComponent('site photo.png')}`)).text, 'x');
  });
});

test('writes need the token, this server as the origin, and one of the two endpoints', async t => {
  await withStudio(t, {}, async ({ dir, port, token }) => {
    const bytes = png(1000, 800);
    const query = { kind: 'floor-plan', name: 'plan.png' };
    const refused = [
      await upload(port, '', query, bytes),
      await upload(port, 'f'.repeat(48), query, bytes),
      await upload(port, token, query, bytes, { origin: 'http://attacker.example' }),
      await upload(port, token, query, bytes, { origin: `http://127.0.0.1:${port + 1}` }),
      await upload(port, token, query, bytes, { host: `attacker.example:${port}` }),
      await calibrate(port, 'nope', {})
    ];
    for (const response of refused) {
      assert.equal(response.status, 403);
      assert.equal(response.json.ok, false);
      assert.equal(response.json.code, 'forbidden');
    }
    assert.equal(fs.existsSync(path.join(dir, 'sources', 'sources.json')), false, 'nothing was written');

    const other = await send(port, 'POST', '/__architecture-studio/other', { headers: { [TOKEN_HEADER]: token } });
    assert.equal(other.status, 405);
    assert.equal(other.headers.allow, 'GET, HEAD');
    assert.equal((await send(port, 'PUT', UPLOAD_PATH, { headers: { [TOKEN_HEADER]: token } })).status, 405);
    assert.equal((await send(port, 'POST', '/models/building.json', { headers: { [TOKEN_HEADER]: token } })).status, 405);

    const wrongType = await upload(port, token, query, bytes, { 'content-type': 'text/plain' });
    assert.equal(wrongType.status, 415);
    assert.equal(wrongType.json.code, 'unsupported-type');
    assert.equal((await calibrate(port, token, {}, { 'content-type': 'text/plain' })).status, 415);

    const fromPage = await upload(port, token, query, bytes, { origin: `http://localhost:${port}` });
    assert.equal(fromPage.status, 200, 'the page itself may send an Origin');
  });
});

test('upload imports an image like add, refuses an existing id, and replaces on request', async t => {
  await withStudio(t, {}, async ({ dir, port, token }) => {
    const brief = { schemaVersion: '1.0.0', status: 'in-progress', sources: [] };
    fs.writeFileSync(path.join(dir, 'brief.json'), `${JSON.stringify(brief, null, 2)}\n`);
    const bytes = png(1000, 800);
    const first = await upload(port, token, { kind: 'floor-plan', name: '../../Ground Floor.PNG' }, bytes, { 'content-type': 'application/octet-stream' });
    assert.equal(first.status, 200);
    assert.deepEqual(first.json, {
      ok: true,
      source: { id: 'ground-floor', kind: 'floor-plan', path: 'sources/ground-floor.png', pixels: { width: 1000, height: 800 }, revision: 1, calibrationRevision: 0 },
      messages: ['Imported ground-floor: sources/ground-floor.png, floor-plan, PNG 1000x800 px, revision 1.', 'Registered it in brief.json sources.'],
      warnings: []
    });
    assert.deepEqual(fs.readFileSync(path.join(dir, 'sources', 'ground-floor.png')), bytes);
    const [entry] = manifestOf(dir).sources;
    assert.equal(entry.id, 'ground-floor');
    assert.equal(entry.format, 'png');
    assert.match(entry.contentHash, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'brief.json'), 'utf8')).sources, [{ path: 'sources/ground-floor.png', kind: 'floor-plan', sourceId: 'ground-floor' }]);

    const named = await upload(port, token, { kind: 'survey', name: 'scan.png', id: '  2019 Survey! ' }, png(600, 400, 's'));
    assert.equal(named.status, 200);
    assert.equal(named.json.source.id, 'source-2019-survey', 'the Name field is slugged into the id');

    const pdf = await upload(port, token, { kind: 'survey', name: 'plat.pdf' }, Buffer.from('%PDF-1.4\n'), { 'content-type': 'application/octet-stream' });
    assert.equal(pdf.status, 400);
    assert.equal(pdf.json.code, 'invalid');
    assert.match(pdf.json.error, /PDF files are not supported: only PNG, JPEG, and WebP images can be imported\. Export it to PNG or JPEG/);
    const badKind = await upload(port, token, { kind: 'plan', name: 'x.png' }, png(10, 10));
    assert.equal(badKind.status, 400);
    assert.equal((await upload(port, token, { kind: 'other' }, png(10, 10))).status, 400, 'the file name is required');

    const again = await upload(port, token, { kind: 'floor-plan', name: 'Ground Floor.png' }, png(1000, 800, 'b'));
    assert.equal(again.status, 409);
    assert.equal(again.json.code, 'exists');
    assert.equal(again.json.id, 'ground-floor');
    assert.equal(manifestOf(dir).sources[0].revision, 1);
    const replaced = await upload(port, token, { kind: 'floor-plan', name: 'Ground Floor.png', replace: '1' }, png(1000, 800, 'b'));
    assert.equal(replaced.status, 200);
    assert.equal(replaced.json.source.revision, 2);
    assert.match(replaced.json.messages[0], /^Replaced ground-floor/);
    assert.equal(manifestOf(dir).sources.find(item => item.id === 'ground-floor').revision, 2);
  });
});

test('upload refuses a body over the limit, declared or streamed', async t => {
  await withStudio(t, { uploadLimit: 1024 }, async ({ dir, port, token }) => {
    const big = Buffer.concat([png(10, 10), Buffer.alloc(4096)]);
    const declared = await upload(port, token, { kind: 'other', name: 'big.png' }, big);
    assert.equal(declared.status, 413);
    assert.equal(declared.json.code, 'too-large');
    const streamed = await send(port, 'POST', `${UPLOAD_PATH}?kind=other&name=big.png`, { headers: { 'content-type': 'image/png', [TOKEN_HEADER]: token, 'transfer-encoding': 'chunked' }, body: big, chunked: true });
    assert.equal(streamed.status, 413);
    assert.equal(fs.existsSync(path.join(dir, 'sources', 'big.png')), false);
    assert.equal((await upload(port, token, { kind: 'other', name: 'small.png' }, png(10, 10))).status, 200, 'a small image still fits');
  });
});

test('calibration records the viewer payload like apply and refuses a stale one', async t => {
  await withStudio(t, {}, async ({ dir, port, token }) => {
    const imported = await upload(port, token, { kind: 'floor-plan', name: 'plan.png' }, png(1000, 800));
    assert.equal(imported.status, 200);
    const source = manifestOf(dir).sources[0];
    const saved = await calibrate(port, token, payloadFor(source));
    assert.equal(saved.status, 200);
    assert.equal(saved.json.ok, true);
    assert.deepEqual(saved.json.source, { id: 'plan', kind: 'floor-plan', path: 'sources/plan.png', pixels: { width: 1000, height: 800 }, revision: 1, calibrationRevision: 1 });
    assert.ok(saved.json.messages.includes('Added cal-1 (manual): 10 mm/px ± 0.2%.'));
    const after = manifestOf(dir).sources[0];
    assert.equal(after.calibrations[0].method, 'manual');
    assert.equal(after.calibrations[0].provenance, 'manual calibration in the viewer: 5 m');
    assert.deepEqual(after.references, [{ label: 'NE house corner', pixel: { x: 812.3, y: 140.5 } }]);

    const stale = await calibrate(port, token, payloadFor(source));
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, 'stale');
    assert.match(stale.json.error, /calibrationRevision 0, now 1/);
    const otherVersion = await calibrate(port, token, payloadFor(after, { contentHash: `sha256:${'0'.repeat(64)}` }));
    assert.equal(otherVersion.status, 409);
    assert.equal(otherVersion.json.code, 'stale');

    const broken = await calibrate(port, token, '{"type":');
    assert.equal(broken.status, 400);
    assert.equal(broken.json.code, 'invalid');
    const empty = await calibrate(port, token, payloadFor(after, { calibration: undefined, references: undefined }));
    assert.equal(empty.status, 400);
    assert.match(empty.json.error, /no calibration, reference points, areas, or marks to remove/);
    const unknown = await calibrate(port, token, payloadFor(after, { calibration: undefined, references: undefined, removeReferences: ['Gate'] }));
    assert.equal(unknown.status, 400);
    assert.equal(unknown.json.code, 'invalid');
    assert.match(unknown.json.error, /No reference point named "Gate" on plan\. Known: NE house corner\./);
    assert.equal(manifestOf(dir).sources[0].calibrationRevision, 1, 'refusals record nothing');

    // A rename in the viewer: the old label is removed and the point added under the new one.
    const renamed = await calibrate(port, token, payloadFor(after, { calibration: undefined, removeReferences: ['NE house corner'], references: [{ label: 'NE corner', pixel: { x: 812.3, y: 140.5 } }] }));
    assert.equal(renamed.status, 200);
    assert.deepEqual(renamed.json.messages, ['Removed reference point(s) from plan: NE house corner.', 'Recorded 1 reference point(s) on plan: NE corner.']);
    assert.deepEqual(manifestOf(dir).sources[0].references, [{ label: 'NE corner', pixel: { x: 812.3, y: 140.5 } }]);
    const removed = await calibrate(port, token, payloadFor(after, { calibration: undefined, references: undefined, removeReferences: ['NE corner'] }));
    assert.equal(removed.status, 200);
    assert.equal(removed.json.source.calibrationRevision, 1, 'marks do not change calibrations');
    assert.deepEqual(manifestOf(dir).sources[0].references, []);
  });
  await withStudio(t, { calibrationLimit: 64 }, async ({ port, token }) => {
    assert.equal((await calibrate(port, token, { type: 'x'.repeat(200) })).status, 413);
  });
});

test('concurrent uploads are written one at a time', async t => {
  await withStudio(t, {}, async ({ dir, port, token }) => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => upload(port, token, { kind: 'photo', name: `photo ${i}.png` }, png(40 + i, 30, String(i)))));
    assert.deepEqual(results.map(result => result.status), [200, 200, 200, 200, 200, 200]);
    const ids = results.map(result => result.json.source.id);
    assert.equal(new Set(ids).size, 6);
    assert.deepEqual(manifestOf(dir).sources.map(source => source.id).sort(), [...ids].sort());
  });
});
