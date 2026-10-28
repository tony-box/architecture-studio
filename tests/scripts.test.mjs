import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bundleProject, omittedSources } from '../scripts/bundle.mjs';
import { buildDrawingSet } from '../scripts/export-drawings.mjs';
import { MARKER_FILE, PROJECT_DIRS, initProject, launcherFiles } from '../scripts/init.mjs';
import { TEMPLATE_PATH, embedData, parseArgs } from '../scripts/lib.mjs';
import { EVENTS_PATH, WATCHED, createStudioServer, defaultPort, listen, projectFiles } from '../scripts/serve.mjs';

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
  for (const launcher of launcherFiles()) assert.equal(fs.readFileSync(path.join(dir, launcher.name), 'utf8'), launcher.text, launcher.name);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'Start-ArchitectureStudio.command')).mode & 0o777, 0o755);

  fs.writeFileSync(path.join(dir, 'index.html'), 'customized');
  fs.writeFileSync(path.join(dir, 'start-architecture-studio.mjs'), 'old launcher');
  for (const name of ['open-studio.mjs', 'Open Studio.cmd', 'Open Studio.command']) fs.writeFileSync(path.join(dir, name), 'retired launcher');
  assert.equal(initProject(dir).status, 'exists');
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), 'customized');
  assert.equal(initProject(dir, { update: true }).status, 'updated');
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), template);
  assert.notEqual(fs.readFileSync(path.join(dir, 'start-architecture-studio.mjs'), 'utf8'), 'old launcher', 'a viewer refresh refreshes the launcher too');
  for (const name of ['open-studio.mjs', 'Open Studio.cmd', 'Open Studio.command']) assert.ok(!fs.existsSync(path.join(dir, name)), `${name} is retired`);
});

test('the launcher is start-architecture-studio.mjs and two double-click wrappers', () => {
  const launchers = launcherFiles();
  assert.deepEqual(launchers.map(file => file.name), ['start-architecture-studio.mjs', 'Start-ArchitectureStudio.cmd', 'Start-ArchitectureStudio.command']);
  const [server, cmd, command] = launchers;
  assert.match(server.text, /^\/\/ Opens this Architecture Studio project/);
  assert.ok(!server.text.includes('\r'));
  assert.match(cmd.text, /^@echo off\r\n/);
  assert.ok(!/[^\r]\n/.test(cmd.text), 'Windows batch files keep CRLF line endings');
  assert.match(command.text, /^#!\/bin\/sh\n/);
  assert.equal(command.mode, 0o755);
  assert.equal(cmd.mode, 0o644);
  assert.ok(launchers.every(file => file.text.endsWith(file.name === 'Start-ArchitectureStudio.cmd' ? '\r\n' : '\n')));
});

test('start-architecture-studio.mjs serves the project read-only on the same port as serve.mjs', async t => {
  const dir = seedProject(t);
  fs.writeFileSync(path.join(dir, '.env'), 'secret');
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'config'), 'secret');
  const child = spawn(process.execPath, [path.join(dir, 'start-architecture-studio.mjs'), '--no-open'], { cwd: os.tmpdir() });
  t.after(() => child.kill());
  const url = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; const match = out.match(/open at (http:\/\/127\.0\.0\.1:\d+\/)/); if (match) resolve(match[1]); });
    child.on('exit', code => reject(new Error(`start-architecture-studio.mjs exited with ${code}: ${out}`)));
  });
  const port = Number(new URL(url).port);
  const page = await request(port, '/');
  assert.equal(page.status, 200);
  assert.equal(page.body, fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), 'the viewer as stored, nothing injected');
  assert.deepEqual(JSON.parse((await request(port, '/models/building.json')).body), fixture);
  assert.deepEqual(JSON.parse((await request(port, '/__architecture-studio/project-files')).body).files, projectFiles(dir));
  for (const hidden of ['/.env', '/.git/config', '/%2e%2e/%2e%2e/outside', '/models/../../outside']) assert.equal((await request(port, hidden)).status, 404, hidden);
  const post = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/models/building.json' }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end('{}');
  });
  assert.equal(post, 405, 'read-only');
  // The address serve.mjs picks for this folder (or the next free one), so browser approvals stay with the project.
  assert.ok(port >= defaultPort(dir) && port < defaultPort(dir) + 20, `${port} near ${defaultPort(dir)}`);
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

test('parseArgs collects a repeated option into an array and keeps a single one scalar', () => {
  assert.deepEqual(parseArgs(['place', 'dir', '--pair', '1,2=3,4', '--pair', '5,6=7,8', '--view', 'site', '--force']), { _: ['place', 'dir'], pair: ['1,2=3,4', '5,6=7,8'], view: 'site', force: true });
  assert.deepEqual(parseArgs(['--pair', 'a', 'b']), { _: ['b'], pair: 'a' });
  assert.deepEqual(parseArgs(['--deg', '-10', '--flag', '--flag']), { _: [], deg: '-10', flag: [true, true] });
});

const sourcesManifest = { schemaVersion: '1.0.0', sources: [{ id: 'plat', path: 'sources/plat.png' }] };

test('the export manifest lists sources/sources.json only when the project has one', t => {
  const dir = seedProject(t);
  const artifacts = () => buildDrawingSet(template, fixture, dir).manifest.artifacts.map(item => item.path);
  assert.ok(!artifacts().includes('sources/sources.json'));
  fs.writeFileSync(path.join(dir, 'sources', 'sources.json'), JSON.stringify(sourcesManifest));
  assert.ok(artifacts().includes('sources/sources.json'));
});

test('bundle names the source images it leaves out', t => {
  const dir = seedProject(t);
  assert.deepEqual(omittedSources(dir), []);
  fs.writeFileSync(path.join(dir, 'sources', 'sources.json'), JSON.stringify(sourcesManifest));
  assert.deepEqual(omittedSources(dir), [{ id: 'plat', path: 'sources/plat.png' }]);
  const { html } = bundleProject(dir);
  assert.doesNotMatch(html, /sources\/plat\.png/, 'images are not embedded');
});

test('serve reloads the viewer when the sources manifest or an image changes', async t => {
  for (const file of ['sources/sources.json', 'sources/plat.png']) assert.match(file, WATCHED);
  const dir = seedProject(t);
  const { server, liveReload } = createStudioServer(dir);
  const port = await listen(server, 0);
  // Closed in `finally`, before the temp-dir cleanup: Windows will not delete a watched folder.
  try {
    if (!liveReload) { t.skip('recursive fs.watch is unavailable here'); return; }
    const reload = await new Promise((resolve, reject) => {
      let timer;
      const req = http.get({ host: '127.0.0.1', port, path: EVENTS_PATH }, res => {
        res.setEncoding('utf8');
        res.on('data', chunk => {
          if (chunk.includes('connected')) {
            timer = setTimeout(() => { req.destroy(); resolve(false); }, 5000);
            fs.writeFileSync(path.join(dir, 'sources', 'sources.json'), JSON.stringify(sourcesManifest));
          }
          if (chunk.includes('data: reload')) { clearTimeout(timer); req.destroy(); resolve(true); }
        });
      });
      req.on('error', reject);
    });
    assert.equal(reload, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
