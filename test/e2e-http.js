'use strict';

/**
 * Uji ujung-ke-ujung launcher mode `http` (launchers/http.js) terhadap server PHP sungguhan.
 * Handler dipasang di server HTTP biasa sehingga (req, res) yang diterimanya sama dengan di Vercel.
 *
 * Butuh PHP di PATH, atau set PHP_DIR (mis. PHP_DIR="C:/xampp/php").
 * Jalankan:  node test/e2e-http.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vphpfix-http-'));
fs.mkdirSync(path.join(root, 'user', 'api'), { recursive: true });
fs.writeFileSync(path.join(root, 'user', 'php.ini'), '');
fs.writeFileSync(path.join(root, 'user', 'api', 'index.php'), `<?php
if ($_SERVER['REQUEST_URI'] === '/cookies') {
  header('Set-Cookie: a=1; Path=/');
  header('Set-Cookie: b=2; Path=/', false);
  header('X-Custom: halo');
  http_response_code(201);
  echo 'cookies';
  return;
}
if ($_SERVER['REQUEST_URI'] === '/redirect') { header('Location: /tujuan', true, 302); return; }
if ($_SERVER['REQUEST_URI'] === '/big') { header('Content-Type: application/pdf'); echo str_repeat('0123456789', 200000); return; }
echo json_encode([
  'from' => 'php',
  'method' => $_SERVER['REQUEST_METHOD'],
  'uri' => $_SERVER['REQUEST_URI'],
  'host' => $_SERVER['HTTP_HOST'] ?? null,
  'post' => $_POST,
  'raw' => file_get_contents('php://input'),
]);
`);

process.env.LAMBDA_TASK_ROOT = root;
process.env.NOW_ENTRYPOINT = 'api/index.php';
process.env.NOW_PHP_DEV = '1'; // mode dev: tidak mengubah PATH/cwd ala Lambda Linux
const phpDir = process.env.PHP_DIR || (fs.existsSync('C:/xampp/php') ? 'C:/xampp/php' : '');
if (phpDir) process.env.PATH = phpDir + path.delimiter + process.env.PATH;

const handler = require('../launchers/http.js');

function call(port, { method = 'GET', url = '/', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path: url, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: res.rawHeaders, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  // Pengecoh di port 3000: tidak boleh tersentuh.
  let decoyHits = 0;
  const decoy = http.createServer((req, res) => { decoyHits++; res.end('decoy'); });
  await new Promise((resolve) => { decoy.once('error', resolve); decoy.listen(3000, '127.0.0.1', resolve); });

  const front = http.createServer(handler);
  await new Promise((resolve) => front.listen(0, '127.0.0.1', resolve));
  const { port } = front.address();

  // 4 permintaan bersamaan saat start dingin
  const results = await Promise.all(['/a?x=1', '/b', '/c', '/d'].map((u) => call(port, { url: u, headers: { host: 'app.test' } })));
  results.forEach((r, i) => {
    assert.strictEqual(r.status, 200, `permintaan ${i}: ${r.status} ${r.body}`);
    const j = JSON.parse(r.body);
    assert.strictEqual(j.from, 'php');
    assert.strictEqual(j.host, 'app.test');
  });
  assert.strictEqual(JSON.parse(results[0].body).uri, '/a?x=1');
  console.log('ok   4 permintaan bersamaan saat start dingin (query string utuh, header host utuh)');

  const form = 'email=a%40b.c&password=rahasia';
  const post = await call(port, {
    method: 'POST', url: '/login', body: form,
    headers: { host: 'app.test', 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(Buffer.byteLength(form)) },
  });
  assert.deepStrictEqual(JSON.parse(post.body).post, { email: 'a@b.c', password: 'rahasia' });
  console.log('ok   POST form');

  const cookies = await call(port, { url: '/cookies', headers: { host: 'app.test' } });
  assert.strictEqual(cookies.status, 201);
  assert.deepStrictEqual(cookies.headers['set-cookie'], ['a=1; Path=/', 'b=2; Path=/']);
  assert.strictEqual(cookies.headers['x-custom'], 'halo');
  assert.strictEqual(cookies.body.toString(), 'cookies');
  console.log('ok   dua Set-Cookie, status 201 dan header kustom utuh');

  const redirect = await call(port, { url: '/redirect', headers: { host: 'app.test' } });
  assert.strictEqual(redirect.status, 302);
  assert.strictEqual(redirect.headers.location, '/tujuan');
  console.log('ok   redirect 302');

  const big = await call(port, { url: '/big', headers: { host: 'app.test' } });
  assert.strictEqual(big.body.length, 2000000);
  assert.strictEqual(big.headers['content-type'], 'application/pdf');
  console.log('ok   respons 2 MB utuh');

  const head = await call(port, { method: 'HEAD', url: '/a', headers: { host: 'app.test' } });
  assert.strictEqual(head.status, 200);
  assert.strictEqual(head.body.length, 0);
  console.log('ok   HEAD');

  assert.strictEqual(decoyHits, 0, `pengecoh di port 3000 tersentuh ${decoyHits}x`);
  console.log('ok   pengecoh port 3000 tidak pernah tersentuh');

  console.log('\nsemua uji e2e http lolos');
  front.close(); decoy.close();
  process.exit(0);
})().catch((err) => {
  console.error('GAGAL', err);
  process.exit(1);
});
