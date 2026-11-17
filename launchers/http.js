'use strict';

/**
 * Launcher mode `http`: fungsi Node.js standar Vercel `(req, res)`.
 *
 * Tidak memakai event gaya Lambda/API Gateway sama sekali; bootstrap Vercel memberikan request HTTP
 * asli dan kita meneruskannya (reverse proxy) ke server PHP Built-In di 127.0.0.1.
 * Kontrak "export default berupa fungsi (req, res)" adalah kontrak Node.js paling dasar di Vercel.
 */

const http = require('http');
const { join } = require('path');
const { getUserDir } = require('./helpers');
const { ensureServer } = require('./phpserver');

// Header hop-by-hop tidak boleh diteruskan; "expect" ditangani sendiri oleh Node.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'expect',
]);

console.log(`🐘 vercel-php-fix[http]: modul dimuat, node ${process.version}`);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendText(res, statusCode, text) {
  if (res.headersSent) { res.end(); return; }
  res.statusCode = statusCode;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(text);
}

function responseHeaders(rawHeaders) {
  const headers = {};
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    const name = rawHeaders[i];
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    const value = rawHeaders[i + 1];
    const existing = Object.keys(headers).find((key) => key.toLowerCase() === lower);
    if (existing === undefined) {
      headers[name] = value;
    } else if (Array.isArray(headers[existing])) {
      headers[existing].push(value);
    } else {
      headers[existing] = [headers[existing], value];
    }
  }
  return headers;
}

async function handler(req, res) {
  try {
    const entrypoint = join(getUserDir(), process.env.NOW_ENTRYPOINT || 'index.php');
    const body = await readBody(req);

    let port;
    try {
      port = await ensureServer(entrypoint);
    } catch (error) {
      sendText(res, 500, `PHP Built-In Server failed to start: ${error}`);
      return;
    }

    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(name)) headers[name] = value;
    }
    // Body sudah dibaca utuh: panjangnya dihitung ulang agar server PHP tidak menerima chunked.
    if (body.length) headers['content-length'] = String(body.length); else delete headers['content-length'];

    console.log(`🐘 Accessing ${headers.host || ''}${req.url}`);

    await new Promise((resolve) => {
      const upstream = http.request({
        hostname: '127.0.0.1', port, path: req.url, method: req.method, headers, agent: false,
      }, (up) => {
        res.writeHead(up.statusCode || 200, responseHeaders(up.rawHeaders));
        up.on('error', (error) => {
          console.error('🐘 PHP Built-In Server response errored', error);
          res.destroy(error);
          resolve();
        });
        up.on('end', resolve);
        up.pipe(res);
      });
      upstream.on('error', (error) => {
        console.error('🐘 PHP Built-In Server HTTP errored', error);
        sendText(res, 500, `PHP Built-In Server HTTP error: ${error}`);
        resolve();
      });
      if (body.length) upstream.write(body);
      upstream.end();
    });
  } catch (error) {
    console.error('🐘 vercel-php-fix[http] error', error);
    sendText(res, 500, `vercel-php-fix error: ${error && error.message}`);
  }
}

module.exports = handler;
