import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { checkUpdates, compareVersions, VERSION_URL } from '../scripts/check-updates.mjs';
import { MARKER_FILE } from '../scripts/init.mjs';

const response = version => async () => ({ ok: true, json: async () => ({ name: 'architecture-studio', version }) });

function project(t, version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-update-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, MARKER_FILE), JSON.stringify({ tool: 'architecture-studio', skillVersion: version }));
  fs.writeFileSync(path.join(dir, 'index.html'), 'customized viewer');
  return dir;
}

test('versions follow SemVer precedence, not string order', () => {
  const versions = ['0.3.0', '0.10.0-alpha', '0.10.0-alpha.2', '0.10.0-alpha.10', '0.10.0-beta', '0.10.0', '1.0.0'];
  for (let i = 1; i < versions.length; i += 1) {
    assert.equal(compareVersions(versions[i - 1], versions[i]), -1);
    assert.equal(compareVersions(versions[i], versions[i - 1]), 1);
  }
  assert.equal(compareVersions('1.0.0+build.1', '1.0.0+build.2'), 0);
  for (const version of ['unknown', '1.0', '01.0.0', '1.0.0-01', null, {}, '1.0.0\n']) {
    assert.throws(() => compareVersions(version, '1.0.0'), /Invalid semantic version/);
  }
});

test('checks installed and project versions independently without writing files', async t => {
  const dir = project(t, '0.2.0');
  const before = fs.readdirSync(dir).map(file => [file, fs.readFileSync(path.join(dir, file), 'utf8')]);
  const result = await checkUpdates({
    projectDir: dir, installedVersion: '0.3.0',
    fetchImpl: async (url, options) => {
      assert.equal(url, VERSION_URL);
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      return response('0.4.0')();
    }
  });
  assert.deepEqual(result.skill, { status: 'available', latestVersion: '0.4.0' });
  assert.deepEqual(result.project, { status: 'available', viewerVersion: '0.2.0' });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(fs.readdirSync(dir).map(file => [file, fs.readFileSync(path.join(dir, file), 'utf8')]), before);
});

test('equal and newer versions are never offered a downgrade', async t => {
  for (const [version, expected] of [['0.3.0', 'current'], ['0.4.0', 'ahead']]) {
    const result = await checkUpdates({ projectDir: project(t, version), installedVersion: '0.3.0', fetchImpl: response('0.2.0') });
    assert.equal(result.project.status, expected);
    assert.equal(result.skill.status, 'ahead');
  }
  assert.equal((await checkUpdates({ installedVersion: '0.3.0', fetchImpl: response('0.3.0') })).skill.status, 'current');
});

test('offline checks never make network requests and still detect an older viewer', async t => {
  const result = await checkUpdates({
    projectDir: project(t, '0.2.0'), installedVersion: '0.3.0', offline: true,
    fetchImpl: () => assert.fail('offline check attempted a request')
  });
  assert.equal(result.skill.status, 'skipped');
  assert.equal(result.project.status, 'available');
  assert.deepEqual(result.warnings, []);
});

test('network and metadata failures remain unknown with explicit warnings', async t => {
  const failures = [
    async () => { throw new Error('offline'); },
    async () => { throw new DOMException('timed out', 'TimeoutError'); },
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } }),
    async () => ({ ok: true, json: async () => ({ name: 'other', version: '0.4.0' }) }),
    response('not-a-version')
  ];
  for (const fetchImpl of failures) {
    const result = await checkUpdates({ projectDir: project(t, '0.2.0'), installedVersion: '0.3.0', fetchImpl });
    assert.equal(result.skill.status, 'unknown');
    assert.equal(result.skill.latestVersion, null);
    assert.equal(result.project.status, 'available');
    assert.match(result.warnings[0], /Cannot check for a newer skill/);
  }
});

test('missing and malformed project markers cannot imply an upgrade', async t => {
  const dir = project(t, 'invalid');
  for (const content of ['{', '{"tool":"other","skillVersion":"0.1.0"}', '{"tool":"architecture-studio","skillVersion":"invalid"}', null]) {
    if (content === null) fs.unlinkSync(path.join(dir, MARKER_FILE));
    else fs.writeFileSync(path.join(dir, MARKER_FILE), content);
    const result = await checkUpdates({ projectDir: dir, installedVersion: '0.3.0', fetchImpl: response('0.4.0') });
    assert.equal(result.project.status, 'unknown');
    assert.equal(result.skill.status, 'available');
    assert.match(result.warnings[0], /Cannot determine project viewer version/);
  }
});

test('an invalid installed version is explicit, and a project is optional', async () => {
  const invalid = await checkUpdates({ installedVersion: 'unknown', fetchImpl: () => assert.fail('invalid version should not fetch') });
  assert.equal(invalid.skill.status, 'unknown');
  assert.match(invalid.warnings[0], /Cannot determine installed skill version/);
  const valid = await checkUpdates({ installedVersion: '0.3.0', fetchImpl: response('0.4.0') });
  assert.equal(valid.project.status, 'not-requested');
});

test('CLI emits structured offline results and exits nonzero for unknown project versions', t => {
  const dir = project(t, '0.0.1');
  const script = path.resolve(import.meta.dirname, '..', 'scripts', 'check-updates.mjs');
  const run = () => spawnSync(process.execPath, [script, '--project', dir, '--offline', '--json'], { encoding: 'utf8' });
  const available = run();
  assert.equal(available.status, 0, available.stderr);
  assert.equal(JSON.parse(available.stdout).project.status, 'available');
  assert.equal(JSON.parse(available.stdout).skill.status, 'skipped');
  fs.unlinkSync(path.join(dir, MARKER_FILE));
  const unknown = run();
  assert.equal(unknown.status, 1, unknown.stderr);
  assert.equal(JSON.parse(unknown.stdout).project.status, 'unknown');
  assert.match(JSON.parse(unknown.stdout).warnings[0], /Cannot determine project viewer version/);
});
