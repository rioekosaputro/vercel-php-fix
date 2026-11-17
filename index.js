'use strict';

/**
 * vercel-php-fix
 *
 * Pembungkus tipis di atas `vercel-php@0.8.0`. Runtime asli membuat fungsi dengan
 *   handler: 'launcher.launcher'
 * dan bootstrap Node/Rust Vercel yang baru menafsirkannya sebagai NAMA FILE, sehingga fungsi crash:
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/var/task/launcher.launcher'
 *   imported from /opt/rust/nodejs.js
 * (vercel-community/php issue #650).
 *
 * Paket ini memanggil vercel-php apa adanya (unduh file, composer install, php.ini, biner PHP),
 * lalu membungkus ulang hasilnya sebagai NodejsLambda. Dua mode, dipilih lewat `config.mode`
 * pada entri `builds` di vercel.json:
 *
 *   "lambda" (bawaan)  handler 'launcher.js' + awsLambdaHandler 'launcher.launcher' (mengikuti PR #654):
 *                      bootstrap memanggil launcher dengan event gaya API Gateway.
 *   "http"             handler 'launcher.js' berupa fungsi Node standar (req, res) yang meneruskan
 *                      request HTTP asli ke server PHP Built-In (reverse proxy). Tidak bergantung pada
 *                      bentuk event Lambda.
 *
 * `config.probe: true` membuat fungsi diagnostik TANPA PHP (lihat launchers/probe-*.js) untuk
 * memeriksa kontrak bootstrap pada platform. Jangan dipakai di produksi.
 */

const path = require('path');
const base = require('vercel-php');
const { NodejsLambda, FileFsRef, getNodeVersion } = require('@vercel/build-utils');

const launchersDir = path.join(__dirname, 'launchers');
const ref = (name) => new FileFsRef({ fsPath: path.join(launchersDir, name) });

exports.version = base.version;
exports.shouldServe = base.shouldServe;
exports.prepareCache = base.prepareCache;

function resolveMode(config) {
  const mode = config && config.mode !== undefined ? config.mode : 'lambda';
  if (mode !== 'lambda' && mode !== 'http') {
    throw new Error(`vercel-php-fix: config.mode harus "lambda" atau "http", bukan ${JSON.stringify(mode)}.`);
  }
  return mode;
}

function configuredDuration(options) {
  // Saat dipakai lewat `builds` (bukan `functions`), batas durasi diatur dari config builder:
  //   { "src": "api/index.php", "use": "...", "config": { "maxDuration": 60 } }
  const value = options && options.config && options.config.maxDuration;
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function lambdaShape(mode) {
  return mode === 'lambda'
    ? { handler: 'launcher.js', awsLambdaHandler: 'launcher.launcher' }
    : { handler: 'launcher.js' };
}

async function buildProbe(options, mode) {
  const nodeVersion = await getNodeVersion(options.workPath);
  console.log(`🐘 vercel-php-fix: membuat fungsi PROBE mode ${mode} (tanpa PHP), runtime ${nodeVersion.runtime}`);
  const lambdaOptions = {
    files: {
      'launcher.js': ref(mode === 'lambda' ? 'probe-lambda.js' : 'probe-http.js'),
      'introspect.js': ref('introspect.js'),
    },
    ...lambdaShape(mode),
    shouldAddHelpers: false,
    shouldAddSourcemapSupport: false,
    runtime: nodeVersion.runtime,
    environment: {},
  };
  const maxDuration = configuredDuration(options);
  if (maxDuration) lambdaOptions.maxDuration = maxDuration;
  return { output: new NodejsLambda(lambdaOptions) };
}

exports.build = async function build(options) {
  const config = (options && options.config) || {};
  const mode = resolveMode(config);

  if (config.probe === true) return buildProbe(options, mode);

  const result = await base.build(options);
  const original = result && result.output;

  if (!original || !original.files || typeof original.runtime !== 'string') {
    throw new Error('vercel-php-fix: output dari vercel-php tidak dikenali (files/runtime tidak ada).');
  }
  if (!original.files['launcher.js']) {
    throw new Error('vercel-php-fix: launcher.js tidak ditemukan di output vercel-php.');
  }

  console.log(`🐘 vercel-php-fix: membungkus ulang fungsi sebagai NodejsLambda (mode ${mode}, handler launcher.js)`);

  const files = {
    ...original.files,
    // Ganti launcher bawaan dengan versi yang sudah diperbaiki, beserta modul pendukungnya.
    'helpers.js': ref('helpers.js'),
    'phpserver.js': ref('phpserver.js'),
    'launcher.js': ref(mode === 'lambda' ? 'builtin.js' : 'http.js'),
  };

  const lambdaOptions = {
    files,
    ...lambdaShape(mode),
    shouldAddHelpers: false,
    shouldAddSourcemapSupport: false,
    runtime: original.runtime,
    environment: original.environment || {},
  };

  // Pertahankan setelan opsional bila vercel-php menetapkannya.
  for (const key of ['memory', 'maxDuration', 'regions']) {
    if (original[key] !== undefined && original[key] !== null) {
      lambdaOptions[key] = original[key];
    }
  }
  const maxDuration = configuredDuration(options);
  if (maxDuration) lambdaOptions.maxDuration = maxDuration;

  return { ...result, output: new NodejsLambda(lambdaOptions) };
};
