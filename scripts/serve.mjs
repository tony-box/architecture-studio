// Serves an Architecture Studio project on localhost and opens it in the default browser.
//
//   node <skill>/scripts/serve.mjs [project-dir] [--port <n>] [--no-open] [--no-watch] [--json]
//
// The viewer loads models/building.json, the review files, and the source images with
// fetch(), which browsers block for file:// pages, so the project needs a local server. The
// default port is derived from the project path: the same project always gets the same
// origin, which keeps the approvals the viewer stores in localStorage. The server keeps
// running until stopped.
//
// Every project file is served read-only. The viewer's Sources tab writes through exactly two
// endpoints, both on the same code paths as scripts/import-image.mjs:
//
//   POST /__architecture-studio/sources?kind=<kind>&name=<file name>[&id=<id>][&replace=1]
//        body: the image bytes (image/* or application/octet-stream, up to 40 MB). Imports it
//        like `import-image.mjs add`; `id` is slugged, and `name` only gives the extension and,
//        without `id`, the id.
//   POST /__architecture-studio/calibration
//        body: the viewer's calibration payload (application/json, up to 1 MB). Records it like
//        `import-image.mjs apply`.
//
// Both answer JSON: { ok: true, source, messages, warnings } or { ok: false, error, code } with
// 400 (invalid), 409 ("exists" or "stale"), 413 (too large), or 415 (wrong content type). Each
// server start makes a random token and puts it in the served index.html as
// <meta name="architecture-studio-write">; never on disk. A write needs that token in the
// X-Architecture-Studio-Token header and, when the browser sends one, an Origin of this
// server (http://127.0.0.1:<port> or http://localhost:<port>); otherwise it gets 403. Writes
// run one at a time and land in sources/, so live reload refreshes the page.
//
// The viewer's Export project reads two more things, both read-only:
//
//   GET /__architecture-studio/project-files   { files: [...] }, the project-relative paths of the
//        project contract (see PROJECT_ROOT_FILES and PROJECT_TREES), without dotfiles or symlinks.
//   GET /index.html?raw=1                      the viewer as it is on disk, without the token or
//        the live-reload script.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CliError, addImage, applyCalibration, slugify } from './import-image.mjs';
import { isMain, parseArgs } from './lib.mjs';

export const EVENTS_PATH = '/__architecture-studio/events';
export const UPLOAD_PATH = '/__architecture-studio/sources';
export const CALIBRATION_PATH = '/__architecture-studio/calibration';
export const PROJECT_FILES_PATH = '/__architecture-studio/project-files';
// What Export project packages: the files of the project contract (SKILL.md, Output Contract), not
// whatever else shares the folder, such as version control or editor files.
export const PROJECT_ROOT_FILES = ['architecture-studio.json', 'index.html', 'brief.json', 'ASSUMPTIONS.md', 'HANDOFF.md', 'open-studio.mjs', 'Open Studio.cmd', 'Open Studio.command'];
export const PROJECT_TREES = ['models', 'sources', 'reviews', 'exports'];
export const TOKEN_HEADER = 'x-architecture-studio-token';
export const WRITE_META = 'architecture-studio-write';
export const UPLOAD_LIMIT = 40 * 1024 * 1024;
export const CALIBRATION_LIMIT = 1024 * 1024;
const RELOAD_SNIPPET = `<script>(() => { const events = new EventSource('${EVENTS_PATH}'); events.onmessage = () => location.reload(); })();</script>`;
export const WATCHED = /^(index\.html|brief\.json|models\/|reviews\/|sources\/|exports\/manifest\.json)/;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip'
};

export function defaultPort(projectDir) {
  let key = path.resolve(projectDir);
  if (process.platform === 'win32') key = key.toLowerCase();
  const hash = crypto.createHash('sha256').update(key).digest();
  return 41000 + (hash.readUInt32BE(0) % 8000);
}

const sendJson = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(body));
};

// The request body as one Buffer, refused with code "too-large" past `limit` bytes, counted as it streams.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => Object.assign(new Error(`The upload is larger than ${Math.round(limit / 1024 / 1024 * 10) / 10} MB.`), { code: 'too-large' });
    const declared = Number(req.headers['content-length']);
    let done = false;
    const finish = (error, value) => { if (done) return; done = true; if (error) reject(error); else resolve(value); };
    if (Number.isFinite(declared) && declared > limit) { req.resume(); finish(tooLarge()); return; }
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      if (done) return;
      size += chunk.length;
      if (size > limit) { chunks.length = 0; finish(tooLarge()); return; }
      chunks.push(chunk);
    });
    req.on('end', () => finish(null, Buffer.concat(chunks)));
    req.on('error', error => finish(error));
  });
}

const sourceSummary = source => ({ id: source.id, kind: source.kind, path: source.path, pixels: source.pixels, revision: source.revision, calibrationRevision: source.calibrationRevision });

// Project-relative, forward-slash paths of the project's files, sorted. Dotfiles, dot folders, and
// symbolic links are skipped, so nothing outside the project folder is listed.
export function projectFiles(projectDir) {
  const root = path.resolve(projectDir), files = [];
  const isA = (relative, kind) => { try { return fs.lstatSync(path.join(root, relative))[kind](); } catch { return false; } };
  const visit = relative => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) files.push(child);
    }
  };
  for (const file of PROJECT_ROOT_FILES) if (isA(file, 'isFile')) files.push(file);
  for (const dir of PROJECT_TREES) if (isA(dir, 'isDirectory')) visit(dir);
  return files.sort();
}

// Puts the write token in the page's <head>, or ahead of the closing </body> when it has none.
export function injectWriteToken(html, token) {
  const meta = `<meta name="${WRITE_META}" content="${token}">`;
  const head = html.indexOf('</head>');
  if (head !== -1) return html.slice(0, head) + meta + html.slice(head);
  const body = html.lastIndexOf('</body>');
  return body === -1 ? html + meta : html.slice(0, body) + meta + html.slice(body);
}

export function createStudioServer(projectDir, { watch = true, token = crypto.randomBytes(24).toString('hex'), uploadLimit = UPLOAD_LIMIT, calibrationLimit = CALIBRATION_LIMIT } = {}) {
  const root = path.resolve(projectDir);
  const clients = new Set();
  const tokenBytes = Buffer.from(token);
  let watcher = null;
  let timer = null;
  let queue = Promise.resolve();

  const notify = () => {
    for (const client of clients) client.write('data: reload\n\n');
  };
  // One write at a time, so two requests never read and rewrite sources/sources.json together.
  const serialize = task => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
  const loopback = () => {
    const port = server.address()?.port;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...(port === 80 ? ['127.0.0.1', 'localhost'] : [])];
    return { hosts, origins: hosts.map(host => `http://${host}`) };
  };
  const tokenMatches = value => {
    const given = Buffer.from(String(value ?? ''));
    return given.length === tokenBytes.length && crypto.timingSafeEqual(given, tokenBytes);
  };

  async function handleWrite(req, res, url) {
    const { hosts, origins } = loopback();
    if (!hosts.includes(String(req.headers.host ?? '').toLowerCase())) return sendJson(res, 403, { ok: false, error: 'Writes are only accepted on 127.0.0.1 or localhost.', code: 'forbidden' });
    if (req.headers.origin !== undefined && !origins.includes(req.headers.origin)) return sendJson(res, 403, { ok: false, error: 'This request came from another site.', code: 'forbidden' });
    if (!tokenMatches(req.headers[TOKEN_HEADER])) return sendJson(res, 403, { ok: false, error: 'The write token is missing or out of date. Reload the page.', code: 'forbidden' });
    const upload = url.pathname === UPLOAD_PATH;
    const type = String(req.headers['content-type'] ?? '').toLowerCase();
    if (upload ? !(type.startsWith('image/') || type.startsWith('application/octet-stream')) : !type.startsWith('application/json')) {
      req.resume();
      return sendJson(res, 415, { ok: false, error: upload ? 'Send the image bytes as image/* or application/octet-stream.' : 'Send the calibration as application/json.', code: 'unsupported-type' });
    }
    let body;
    try {
      body = await readBody(req, upload ? uploadLimit : calibrationLimit);
    } catch (error) {
      if (error.code === 'too-large') return sendJson(res, 413, { ok: false, error: error.message, code: 'too-large' }, { connection: 'close' });
      return sendJson(res, 400, { ok: false, error: 'The request body could not be read.', code: 'invalid' });
    }
    try {
      const result = await serialize(() => {
        if (upload) {
          const name = url.searchParams.get('name');
          if (!name) throw new CliError('Give the original file name (name=).');
          const id = url.searchParams.get('id')?.trim();
          return addImage(root, { bytes: body, name, kind: url.searchParams.get('kind') || undefined, id: id ? slugify(id) : undefined, replace: url.searchParams.get('replace') === '1' });
        }
        let payload;
        try {
          payload = JSON.parse(body.toString('utf8'));
        } catch (error) {
          throw new CliError(`The calibration is not valid JSON (${error.message}).`);
        }
        return applyCalibration(root, payload);
      });
      return sendJson(res, 200, { ok: true, source: sourceSummary(result.source), messages: result.messages, warnings: result.warnings });
    } catch (error) {
      if (!(error instanceof CliError)) return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error), code: 'internal' });
      const status = error.code === 'exists' || error.code === 'stale' ? 409 : 400;
      return sendJson(res, status, { ok: false, error: error.message, code: error.code, ...(error.id !== undefined ? { id: error.id } : {}) });
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'POST' && (url.pathname === UPLOAD_PATH || url.pathname === CALIBRATION_PATH)) {
      handleWrite(req, res, url).catch(error => {
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error), code: 'internal' });
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    if (url.pathname === EVENTS_PATH) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === PROJECT_FILES_PATH) {
      try {
        sendJson(res, 200, { files: projectFiles(root) });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error), code: 'internal' });
      }
      return;
    }
    let relative;
    try {
      relative = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (relative.endsWith('/')) relative += 'index.html';
    const file = path.resolve(root, `.${relative}`);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.stat(file, (statError, stats) => {
      if (statError || !stats.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      const headers = { 'content-type': MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' };
      // ?raw=1 returns the viewer as stored, for Export project; the token never leaves this server.
      if (file === path.join(root, 'index.html') && !url.searchParams.has('raw')) {
        let html = fs.readFileSync(file, 'utf8');
        // Only a page loaded from this server's own address gets the token; it is never written to disk.
        if (loopback().hosts.includes(String(req.headers.host ?? '').toLowerCase())) html = injectWriteToken(html, token);
        if (watcher) {
          const at = html.lastIndexOf('</body>');
          html = at === -1 ? html + RELOAD_SNIPPET : html.slice(0, at) + RELOAD_SNIPPET + html.slice(at);
        }
        res.writeHead(200, headers).end(req.method === 'HEAD' ? undefined : html);
        return;
      }
      res.writeHead(200, headers);
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).pipe(res);
    });
  });

  if (watch) {
    try {
      watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (!filename || !WATCHED.test(String(filename).split(path.sep).join('/'))) return;
        clearTimeout(timer);
        timer = setTimeout(notify, 250);
      });
    } catch (error) {
      console.warn(`Live reload is off: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  server.on('close', () => {
    clearTimeout(timer);
    watcher?.close();
    for (const client of clients) client.end();
  });
  return { server, notify, liveReload: Boolean(watcher), token };
}

// Tries the preferred port first, then the next few, so a busy port does not stop the studio.
export function listen(server, port, host = '127.0.0.1', attempts = 20) {
  return new Promise((resolve, reject) => {
    let candidate = port;
    const tryListen = () => {
      server.once('error', error => {
        if (error.code === 'EADDRINUSE' && candidate < port + attempts - 1 && port !== 0) {
          candidate += 1;
          tryListen();
        } else reject(error);
      });
      server.listen(candidate, host, () => resolve(server.address().port));
    };
    tryListen();
  });
}

function canOpenBrowser() {
  if (process.env.SSH_CONNECTION || process.env.CI) return false;
  if (process.platform === 'linux') return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  return true;
}

export function openBrowser(url) {
  const [command, args] = process.platform === 'win32'
    ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node <skill>/scripts/serve.mjs [project-dir] [--port <n>] [--no-open] [--no-watch] [--json]');
    console.log('Files are served read-only; the Sources tab can import images and save calibrations to sources/ (see the comment at the top of this file).');
    return;
  }
  const projectDir = path.resolve(String(args._[0] ?? args.project ?? '.'));
  if (!fs.existsSync(path.join(projectDir, 'index.html'))) {
    console.error(`${projectDir} has no index.html. Run scripts/init.mjs on it first.`);
    process.exitCode = 1;
    return;
  }
  const { server, liveReload } = createStudioServer(projectDir, { watch: !args['no-watch'] });
  const port = await listen(server, args.port !== undefined ? Number(args.port) : defaultPort(projectDir));
  const url = `http://127.0.0.1:${port}/`;
  const opened = !args['no-open'] && canOpenBrowser();
  if (opened) openBrowser(url);
  if (args.json) console.log(JSON.stringify({ url, projectDir, liveReload, opened }));
  else {
    console.log(`Architecture Studio is serving ${projectDir}`);
    console.log(`  ${url}`);
    console.log(`${liveReload ? 'Live reload is on. ' : ''}${opened ? 'Opened in your default browser. ' : 'Open the URL above in a browser. '}Press Ctrl+C to stop.`);
  }
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (isMain(import.meta)) main();
