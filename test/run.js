'use strict';

/**
 * Tes lokal tanpa memasang vercel-php (paket PHP biner-nya ~109 MB):
 *  - helpers.js diuji langsung.
 *  - index.js diuji dengan `vercel-php` tiruan, tetapi memakai kelas Lambda/NodejsLambda ASLI dari
 *    @vercel/build-utils (butuh NODE_PATH menunjuk ke node_modules yang memuatnya, mis. milik Vercel CLI).
 *
 * Jalankan:  NODE_PATH="<...>/vercel/node_modules" node test/run.js
 */

const assert = require('assert');
const path = require('path');
const Module = require('module');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    const maybe = fn();
    if (maybe && typeof maybe.then === 'function') {
      return maybe.then(() => { passed++; console.log(`  ok   ${name}`); })
        .catch((e) => { failed++; console.log(`  GAGAL ${name}\n       ${e && e.stack || e}`); });
    }
    passed++; console.log(`  ok   ${name}`);
  } catch (e) {
    failed++; console.log(`  GAGAL ${name}\n       ${e && e.stack || e}`);
  }
  return undefined;
}

const helpers = require('../launchers/helpers');

(async () => {
  console.log('helpers.js');

  const savedRoot = process.env.LAMBDA_TASK_ROOT;
  delete process.env.LAMBDA_TASK_ROOT;
  test('LAMBDA_TASK_ROOT kosong -> fallback /var/task', () => {
    assert.strictEqual(helpers.getUserDir().replace(/\\/g, '/'), '/var/task/user');
    assert.strictEqual(helpers.getPhpDir().replace(/\\/g, '/'), '/var/task/php');
  });
  process.env.LAMBDA_TASK_ROOT = '/x';
  test('LAMBDA_TASK_ROOT terisi dipakai', () => {
    assert.strictEqual(helpers.getUserDir().replace(/\\/g, '/'), '/x/user');
  });
  if (savedRoot === undefined) delete process.env.LAMBDA_TASK_ROOT; else process.env.LAMBDA_TASK_ROOT = savedRoot;

  test('GET tanpa body (body null)', () => {
    const r = helpers.normalizeEvent({ httpMethod: 'GET', path: '/login', host: 'a.test', headers: { Host: 'a.test' }, body: null });
    assert.strictEqual(r.method, 'GET'); assert.strictEqual(r.path, '/login');
    assert.strictEqual(r.body, undefined); assert.strictEqual(r.host, 'a.test');
  });
  test('POST body string -> Buffer utf8', () => {
    const r = helpers.normalizeEvent({ httpMethod: 'POST', path: '/login', headers: {}, body: 'a=1&b=2' });
    assert.ok(Buffer.isBuffer(r.body)); assert.strictEqual(r.body.toString(), 'a=1&b=2');
  });
  test('POST body array byte -> Buffer (kasus 502 di issue #650)', () => {
    const r = helpers.normalizeEvent({ httpMethod: 'POST', path: '/x', headers: {}, body: [97, 61, 49] });
    assert.ok(Buffer.isBuffer(r.body)); assert.strictEqual(r.body.toString(), 'a=1');
  });
  test('body Buffer dipertahankan', () => {
    const b = Buffer.from('xyz');
    assert.strictEqual(helpers.normalizeEvent({ httpMethod: 'POST', path: '/x', headers: {}, body: b }).body, b);
  });
  test('isBase64Encoded true -> decode base64', () => {
    const r = helpers.normalizeEvent({ httpMethod: 'POST', path: '/x', headers: {}, body: Buffer.from('halo').toString('base64'), isBase64Encoded: true });
    assert.strictEqual(r.body.toString(), 'halo');
  });
  test('Action Invoke dengan body JSON', () => {
    const inner = { method: 'POST', path: '/p', host: 'h.test', headers: { a: 'b' }, body: 'k=v' };
    const r = helpers.normalizeEvent({ Action: 'Invoke', body: JSON.stringify(inner) });
    assert.strictEqual(r.method, 'POST'); assert.strictEqual(r.host, 'h.test'); assert.strictEqual(r.body.toString(), 'k=v');
  });
  test('host diambil dari x-forwarded-host lalu host', () => {
    assert.strictEqual(helpers.normalizeEvent({ httpMethod: 'GET', path: '/', headers: { 'X-Forwarded-Host': 'fw.test', Host: 'h.test' } }).host, 'fw.test');
    assert.strictEqual(helpers.normalizeEvent({ httpMethod: 'GET', path: '/', headers: { Host: 'h.test' } }).host, 'h.test');
  });
  test('header __proto__ tidak mencemari prototype', () => {
    const r = helpers.normalizeEvent({ httpMethod: 'GET', path: '/', headers: JSON.parse('{"__proto__":"x","a":"b"}') });
    assert.strictEqual(({}).x, undefined); assert.strictEqual(Object.getPrototypeOf(r.headers), Object.prototype);
  });
  test('event tidak valid ditolak', () => {
    assert.throws(() => helpers.normalizeEvent(null), TypeError);
    assert.throws(() => helpers.normalizeEvent({ httpMethod: 'GET' }), TypeError);
    assert.throws(() => helpers.normalizeEvent({ httpMethod: 'POST', path: '/', body: { a: 1 } }), TypeError);
    assert.throws(() => helpers.normalizeEvent({ Action: 'Invoke', body: JSON.stringify({ method: 'GET', path: '/', encoding: 'hex' }) }), /Unsupported encoding/);
  });
  test('transformToAwsResponse -> base64', () => {
    const r = helpers.transformToAwsResponse({ statusCode: 201, headers: { a: 'b' }, body: Buffer.from('ok') });
    assert.deepStrictEqual(r, { statusCode: 201, headers: { a: 'b' }, body: Buffer.from('ok').toString('base64'), encoding: 'base64' });
  });
  await test('transformFromAwsRequest memakai NOW_ENTRYPOINT', async () => {
    process.env.NOW_ENTRYPOINT = 'api/index.php';
    delete process.env.LAMBDA_TASK_ROOT;
    const r = await helpers.transformFromAwsRequest({ method: 'GET', path: '/p', host: 'h', headers: {}, body: undefined });
    assert.strictEqual(r.entrypoint.replace(/\\/g, '/'), '/var/task/user/api/index.php'); assert.strictEqual(r.uri, 'h/p');
  });

  console.log('index.js (wrapper)');
  let buildUtils;
  try { buildUtils = require('@vercel/build-utils'); } catch (e) { /* dilewati */ }
  if (!buildUtils) {
    console.log('  lewati: @vercel/build-utils tidak ditemukan (set NODE_PATH ke node_modules Vercel CLI)');
  } else {
    const { Lambda, FileBlob, NodejsLambda } = buildUtils;
    const baseOutput = new Lambda({
      files: { 'launcher.js': new FileBlob({ data: '// launcher' }), 'helpers.js': new FileBlob({ data: '// helpers lama' }), 'user/api/index.php': new FileBlob({ data: '<?php' }) },
      handler: 'launcher.launcher',
      runtime: 'nodejs22.x',
      environment: { NOW_ENTRYPOINT: 'api/index.php', NOW_PHP_DEV: '0' },
    });
    const fakeBase = { version: 3, shouldServe: () => true, prepareCache: async () => ({}), build: async () => ({ output: baseOutput }) };

    const originalLoad = Module._load;
    Module._load = function (request, ...rest) {
      return request === 'vercel-php' ? fakeBase : originalLoad.call(this, request, ...rest);
    };
    const wrapper = require('../index.js');
    Module._load = originalLoad;

    await test('versi & fungsi turunan diteruskan', () => {
      assert.strictEqual(wrapper.version, 3);
      assert.strictEqual(wrapper.shouldServe, fakeBase.shouldServe);
      assert.strictEqual(wrapper.prepareCache, fakeBase.prepareCache);
    });
    await test('build menghasilkan NodejsLambda dengan handler yang benar', async () => {
      const { output } = await wrapper.build({});
      assert.ok(output instanceof NodejsLambda);
      assert.strictEqual(output.launcherType, 'Nodejs');
      assert.strictEqual(output.handler, 'launcher.js');
      assert.strictEqual(output.awsLambdaHandler, 'launcher.launcher');
      assert.strictEqual(output.shouldAddHelpers, false);
      assert.strictEqual(output.shouldAddSourcemapSupport, false);
      assert.strictEqual(output.runtime, 'nodejs22.x');
      assert.deepStrictEqual(output.environment, { NOW_ENTRYPOINT: 'api/index.php', NOW_PHP_DEV: '0' });
    });
    await test('helpers.js diganti, file lain utuh', async () => {
      const { output } = await wrapper.build({});
      assert.deepStrictEqual(Object.keys(output.files).sort(), ['helpers.js', 'launcher.js', 'user/api/index.php']);
      assert.strictEqual(path.resolve(output.files['helpers.js'].fsPath), path.resolve(__dirname, '..', 'launchers', 'helpers.js'));
      assert.strictEqual(output.files['launcher.js'], baseOutput.files['launcher.js']);
      assert.strictEqual(output.files['user/api/index.php'], baseOutput.files['user/api/index.php']);
    });
    await test('config.maxDuration dari builds[] diteruskan ke fungsi', async () => {
      const withConfig = await wrapper.build({ config: { maxDuration: 60 } });
      assert.strictEqual(withConfig.output.maxDuration, 60);
      const withoutConfig = await wrapper.build({});
      assert.strictEqual(withoutConfig.output.maxDuration, undefined);
      const invalid = await wrapper.build({ config: { maxDuration: 'abc' } });
      assert.strictEqual(invalid.output.maxDuration, undefined);
    });
    await test('output vercel-php tidak dikenali -> error jelas', async () => {
      fakeBase.build = async () => ({ output: { files: {}, runtime: 'nodejs22.x' } });
      await assert.rejects(() => wrapper.build({}), /launcher\.js tidak ditemukan/);
    });
  }

  console.log(`\n${passed} lolos, ${failed} gagal`);
  process.exit(failed ? 1 : 0);
})();
