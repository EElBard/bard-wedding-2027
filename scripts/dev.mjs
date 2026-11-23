import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as guestHandlers from '../api/guests.js';
import * as rsvpHandlers from '../api/rsvps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const PORT = Number(process.env.PORT || 3000);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

const API_ROUTES = {
  '/api/rsvps': rsvpHandlers,
  '/api/guests': guestHandlers
};

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', `http://localhost:${PORT}`);

    const routeHandlers = API_ROUTES[reqUrl.pathname];
    if (routeHandlers) {
      const handler = routeHandlers[req.method];
      if (!handler) {
        res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
        return;
      }

      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

      const webReq = new Request(reqUrl.toString(), {
        method: req.method,
        headers: req.headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body
      });

      const webRes = await handler(webReq);
      res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
      const buf = Buffer.from(await webRes.arrayBuffer());
      res.end(buf);
      return;
    }

    let pathname = decodeURIComponent(reqUrl.pathname);
    if (pathname === '/') pathname = '/index.html';
    else if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';
    else if (pathname === '/rsvp' || pathname === '/rsvp/' || /^\/rsvp\/[^/]+\/?$/.test(pathname)) pathname = '/rsvp.html';
    else if (pathname === '/bach' || pathname === '/bach/' || /^\/bach\/[^/]+\/?$/.test(pathname)) pathname = '/bach.html';

    const filePath = path.resolve(PUBLIC_DIR, `.${pathname}`);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } else {
      console.error('Dev server error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal server error');
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Wedding site:    http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
});
