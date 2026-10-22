// Serves an Architecture Studio project on localhost and opens it in the default browser.
//
//   node <skill>/scripts/serve.mjs [project-dir] [--port <n>] [--no-open] [--no-watch] [--json]
//
// The viewer loads models/building.json, the review files, and the source images with
// fetch(), which browsers block for file:// pages, so the project needs a local server. The
// default port is derived from the project path: the same project always gets the same
// origin, which keeps the approvals the viewer stores in localStorage. The server keeps
// running until stopped.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { isMain, parseArgs } from './lib.mjs';

export const EVENTS_PATH = '/__architecture-studio/events';
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

export function createStudioServer(projectDir, { watch = true } = {}) {
  const root = path.resolve(projectDir);
  const clients = new Set();
  let watcher = null;
  let timer = null;

  const notify = () => {
    for (const client of clients) client.write('data: reload\n\n');
  };

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === EVENTS_PATH) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
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
      if (watcher && file === path.join(root, 'index.html')) {
        const html = fs.readFileSync(file, 'utf8');
        const at = html.lastIndexOf('</body>');
        const body = at === -1 ? html + RELOAD_SNIPPET : html.slice(0, at) + RELOAD_SNIPPET + html.slice(at);
        res.writeHead(200, headers).end(req.method === 'HEAD' ? undefined : body);
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
  return { server, notify, liveReload: Boolean(watcher) };
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
