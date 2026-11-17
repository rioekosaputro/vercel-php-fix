'use strict';

/**
 * Uji ujung-ke-ujung launcher (launchers/builtin.js) terhadap server PHP sungguhan.
 *
 * Butuh PHP di PATH, atau set PHP_DIR (mis. PHP_DIR="C:/xampp/php").
 * Jalankan:  node test/e2e.js
 *
 * Skenario yang diuji:
 *  - server pengecoh di port 3000 (meniru server milik bootstrap Vercel) TIDAK boleh tersentuh,
 *  - 4 permintaan bersamaan saat start dingin semuanya sukses,
 *  - GET, POST body string, dan POST body array byte.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vphpfix-e2e-'));
fs.mkdirSync(path.join(root, 'user', 'api'), { recursive: true });
fs.writeFileSync(path.join(root, 'user', 'php.ini'), '');
fs.writeFileSync(path.join(root, 'user', 'api', 'index.php'), `<?php
echo json_encode([
  'from' => 'php',
  'method' => $_SERVER['REQUEST_METHOD'],
  'uri' => $_SERVER['REQUEST_URI'],
  'post' => $_POST,
  'raw' => file_get_contents('php://input'),
]);
`);

process.env.LAMBDA_TASK_ROOT = root;
process.env.NOW_ENTRYPOINT = 'api/index.php';
process.env.NOW_PHP_DEV = '1'; // mode dev: tidak mengubah PATH/cwd ala Lambda Linux
const phpDir = process.env.PHP_DIR || (fs.existsSync('C:/xampp/php') ? 'C:/xampp/php' : '');
if (phpDir) process.env.PATH = phpDir + path.delimiter + process.env.PATH;

const { launcher } = require('../launchers/builtin.js');

const decode = (r) => JSON.parse(Buffer.from(r.body, 'base64').toString());
const get = (p) => launcher({ httpMethod: 'GET', path: p, host: 'app.test', headers: { host: 'app.test' }, body: null });

(async () => {
  // Pengecoh di port 3000: bila tersentuh, hasil tes menjadi "from: decoy".
  let decoyHits = 0;
  const decoy = http.createServer((req, res) => { decoyHits++; res.end(JSON.stringify({ from: 'decoy' })); });
  const decoyListening = await new Promise((resolve) => {
    decoy.once('error', () => resolve(false));
    decoy.listen(3000, '127.0.0.1', () => resolve(true));
  });
  console.log(decoyListening ? 'pengecoh aktif di 127.0.0.1:3000' : 'port 3000 sudah dipakai proses lain (tetap valid sebagai pengecoh)');

  // 4 permintaan bersamaan saat start dingin
  const results = await Promise.all([get('/a'), get('/b'), get('/c'), get('/d')]);
  results.forEach((r, i) => {
    assert.strictEqual(r.statusCode, 200, `permintaan ${i} status ${r.statusCode}: ${Buffer.from(r.body, 'base64')}`);
    assert.strictEqual(decode(r).from, 'php');
  });
  console.log('ok   4 permintaan bersamaan saat start dingin: semua dijawab PHP');

  const form = 'email=a%40b.c&password=rahasia';
  const postStr = decode(await launcher({
    httpMethod: 'POST', path: '/login', host: 'app.test',
    headers: { host: 'app.test', 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(Buffer.byteLength(form)) },
    body: form,
  }));
  assert.deepStrictEqual(postStr.post, { email: 'a@b.c', password: 'rahasia' });
  console.log('ok   POST body string');

  const bytes = Array.from(Buffer.from(form));
  const postBytes = decode(await launcher({
    httpMethod: 'POST', path: '/login', host: 'app.test',
    headers: { host: 'app.test', 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(bytes.length) },
    body: bytes,
  }));
  assert.deepStrictEqual(postBytes.post, { email: 'a@b.c', password: 'rahasia' });
  console.log('ok   POST body array byte');

  assert.strictEqual(decoyHits, 0, `pengecoh di port 3000 tersentuh ${decoyHits}x`);
  console.log('ok   pengecoh port 3000 tidak pernah tersentuh');

  console.log('\nsemua uji e2e lolos');
  decoy.close();
  process.exit(0);
})().catch((err) => {
  console.error('GAGAL', err);
  process.exit(1);
});
