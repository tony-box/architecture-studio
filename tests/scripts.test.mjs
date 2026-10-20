import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bundleProject } from '../scripts/bundle.mjs';
import { MARKER_FILE, PROJECT_DIRS, initProject } from '../scripts/init.mjs';
import { TEMPLATE_PATH, embedData } from '../scripts/lib.mjs';
import { EVENTS_PATH, createStudioServer, defaultPort, listen } from '../scripts/serve.mjs';

const skillRoot = path.resolve(import.meta.dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'lakeside-barn-residence', 'building.json'), 'utf8'));
const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-studio-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

function seedProject(t) {
  const dir = path.join(tempDir(t), 'project');
  initProject(dir);
  fs.writeFileSync(path.join(dir, 'models', 'building.json'), JSON.stringify(fixture));
  return dir;
}

const embedded = (html, id) => JSON.parse(html.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`))[1]);

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    }).on('error', reject);
  });
}

test('init creates a self-contained project and refuses to overwrite it', t => {
  const dir = path.join(tempDir(t), 'cabin');
  assert.equal(initProject(dir).status, 'created');
  for (const sub of PROJECT_DIRS) assert.ok(fs.statSync(path.join(dir, sub)).isDirectory(), sub);
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), template);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, MARKER_FILE), 'utf8')).tool, 'architecture-studio');

  fs.writeFileSync(path.join(dir, 'index.html'), 'customized');
  assert.equal(initProject(dir).status, 'exists');
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), 'customized');
  assert.equal(initProject(dir, { update: true }).status, 'updated');
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), template);
});

test('embedData fills each slot once and keeps the JSON inert', () => {
  const tricky = { project: { name: '</script><b>$& $1 $\'' } };
  const html = embedData(template, { model: tricky, codeFindings: { findings: [] } });
  assert.deepEqual(embedded(html, 'embedded-model'), tricky);
  assert.deepEqual(embedded(html, 'embedded-code-findings'), { findings: [] });
  assert.doesNotMatch(html, /<\/script><b>/);
  assert.throws(() => embedData('<html></html>', { model: {} }), /found 0/);
});

test('bundle embeds the model and code findings, and refuses an invalid model', t => {
  const dir = seedProject(t);
  const findings = { schemaVersion: '1.0.0', projectId: fixture.project.id, status: 'unavailable', findings: [], coverage: {} };
  fs.writeFileSync(path.join(dir, 'reviews', 'code-findings.json'), JSON.stringify(findings));
  const { html, errors } = bundleProject(dir);
  assert.equal(errors.length, 0);
  assert.deepEqual(embedded(html, 'embedded-model'), fixture);
  assert.deepEqual(embedded(html, 'embedded-code-findings'), findings);

  const broken = structuredClone(fixture);
  broken.openings[0].widthMm = -1;
  fs.writeFileSync(path.join(dir, 'models', 'building.json'), JSON.stringify(broken));
  const refused = bundleProject(dir);
  assert.equal(refused.html, null);
  assert.ok(refused.errors.length > 0);
});

test('the default port is stable per project and inside the studio range', () => {
  const port = defaultPort('/projects/cabin');
  assert.equal(port, defaultPort('/projects/cabin'));
  assert.notEqual(port, defaultPort('/projects/barn'));
  assert.ok(port >= 41000 && port < 49000);
});

test('serve delivers project files, injects live reload, and stays inside the project', async t => {
  const dir = seedProject(t);
  fs.writeFileSync(path.join(path.dirname(dir), 'secret.txt'), 'outside');
  const { server, notify, liveReload } = createStudioServer(dir);
  const port = await listen(server, 0);
  // Closed in `finally`, before the temp-dir cleanup: Windows will not delete a watched folder.
  try {
    const index = await request(port, '/');
    assert.equal(index.status, 200);
    assert.match(index.type, /text\/html/);
    if (liveReload) assert.match(index.body, new RegExp(`EventSource\\('${EVENTS_PATH}'\\)`));
    assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), template, 'the file on disk is never modified');

    const model = await request(port, '/models/building.json');
    assert.equal(model.status, 200);
    assert.match(model.type, /application\/json/);
    assert.deepEqual(JSON.parse(model.body), fixture);

    assert.equal((await request(port, '/missing.json')).status, 404);
    assert.equal((await request(port, '/%2e%2e%2fsecret.txt')).status, 403);

    const reload = await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: EVENTS_PATH }, res => {
        res.setEncoding('utf8');
        res.on('data', chunk => {
          if (chunk.includes('connected')) notify();
          if (chunk.includes('data: reload')) { req.destroy(); resolve(true); }
        });
      });
      req.on('error', reject);
    });
    assert.equal(reload, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
