'use strict';

/**
 * Pengganti dist/launchers/builtin.js dari vercel-php@0.8.0 (launcher "PHP Built-In Server").
 *
 * Diturunkan dari vercel-php (MIT, (c) 2019 Milan Felix Sulc). Perubahan:
 *   1. Port server PHP dipilih acak (bebas) dan hanya mengikat 127.0.0.1. Versi asli menulis mati
 *      port 3000. Di bootstrap Vercel yang baru, port itu dapat dipakai server milik bootstrap
 *      sendiri; permintaan GET kosong kita lalu masuk ke sana dan memicu
 *      "SyntaxError: Unexpected end of JSON input" di /opt/rust/nodejs.js.
 *   2. Start server dilindungi satu promise (serverReady): permintaan yang datang bersamaan saat
 *      start dingin menunggu server siap, bukan langsung ECONNREFUSED.
 *   3. Bila proses PHP mati, server dijalankan ulang pada permintaan berikutnya.
 *   4. Koneksi ke 127.0.0.1 (bukan "localhost") agar tidak tersandung resolusi IPv6.
 *   5. Log diagnostik singkat saat start.
 */

const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const { join } = require('path');
const {
  getUserDir, getPhpDir, isDev, normalizeEvent, transformFromAwsRequest, transformToAwsResponse,
} = require('./helpers');

const START_ATTEMPTS = 2000; // x 10 ms = 20 detik menunggu port PHP terbuka

let server;
let serverReady;
let phpPort;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function whenPortOpensCallback(port, attempts, cb) {
  const client = net.connect(port, '127.0.0.1');
  client.on('error', (error) => {
    if (!attempts) return cb(error);
    setTimeout(() => whenPortOpensCallback(port, attempts - 1, cb), 10);
    return undefined;
  });
  client.on('connect', () => {
    client.destroy();
    cb();
  });
}

function whenPortOpens(port, attempts) {
  return new Promise((resolve, reject) => {
    whenPortOpensCallback(port, attempts, (error) => (error ? reject(error) : resolve()));
  });
}

async function startServer(entrypoint) {
  // Resolve document root and router
  const router = entrypoint;
  const docroot = join(getUserDir(), process.env.VERCEL_PHP_DOCROOT !== undefined ? process.env.VERCEL_PHP_DOCROOT : '');

  phpPort = await findFreePort();

  console.log(`🐘 vercel-php-fix: node ${process.version}, LAMBDA_TASK_ROOT=${process.env.LAMBDA_TASK_ROOT || '(kosong)'}, PORT=${process.env.PORT || '(kosong)'}`);
  console.log(`🐘 Spawning: PHP Built-In Server at ${docroot} (document root) and ${router} (router) on 127.0.0.1:${phpPort}`);

  const taskRoot = process.env.LAMBDA_TASK_ROOT || '/var/task';
  const options = {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      LD_LIBRARY_PATH: `${taskRoot}/lib:${process.env.LD_LIBRARY_PATH}`,
    },
  };

  // now vs now-dev
  if (!isDev()) {
    options.env.PATH = `${getPhpDir()}:${process.env.PATH}`;
    options.cwd = getPhpDir();
  } else {
    options.cwd = getUserDir();
  }

  // php -c php.ini -S 127.0.0.1:<port> -t <docroot> <router>
  const child = spawn('php', ['-c', 'php.ini', '-S', `127.0.0.1:${phpPort}`, '-t', docroot, router], options);
  server = child;

  if (child.stdout) child.stdout.on('data', (data) => console.log(`🐘STDOUT: ${data.toString()}`));
  if (child.stderr) child.stderr.on('data', (data) => console.error(`🐘STDERR: ${data.toString()}`));
  child.on('close', (code, signal) => {
    console.log(`🐘 PHP Built-In Server process closed code ${code} and signal ${signal}`);
    if (server === child) {
      server = undefined;
      serverReady = undefined; // permintaan berikutnya menjalankan ulang server
    }
  });
  child.on('error', (err) => {
    console.error(`🐘 PHP Built-In Server process errored ${err}`);
  });

  try {
    await whenPortOpens(phpPort, START_ATTEMPTS);
  } catch (err) {
    child.kill();
    throw err;
  }

  process.on('exit', () => {
    if (child.exitCode === null) child.kill();
  });
  return child;
}

async function query({ entrypoint, uri, path, headers, method, body }) {
  if (!serverReady) {
    serverReady = startServer(entrypoint);
  }
  try {
    await serverReady;
  } catch (error) {
    serverReady = undefined;
    console.error('🐘 PHP Built-In Server gagal start', error);
    return {
      body: Buffer.from(`PHP Built-In Server failed to start: ${error}`),
      headers: {},
      statusCode: 500,
    };
  }

  return new Promise((resolve) => {
    const options = {
      hostname: '127.0.0.1',
      port: phpPort,
      path,
      method,
      headers,
    };

    console.log(`🐘 Accessing ${uri}`);
    console.log(`🐘 Querying ${path}`);

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (data) => {
        chunks.push(data);
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 200,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on('error', (error) => {
      console.error('🐘 PHP Built-In Server HTTP errored', error);
      resolve({
        body: Buffer.from(`PHP Built-In Server HTTP error: ${error}`),
        headers: {},
        statusCode: 500,
      });
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function launcher(event) {
  const awsRequest = normalizeEvent(event);
  const input = await transformFromAwsRequest(awsRequest);
  const output = await query(input);
  return transformToAwsResponse(output);
}

exports.launcher = launcher;
