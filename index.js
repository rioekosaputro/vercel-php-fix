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
 * Perbaikan mengikuti PR #654 (vercel-community/php):
 *   1. Fungsi dibuat sebagai NodejsLambda dengan handler 'launcher.js' dan
 *      awsLambdaHandler 'launcher.launcher'.
 *   2. helpers.js diganti versi yang tahan terhadap LAMBDA_TASK_ROOT kosong dan body request
 *      berupa Buffer / array byte (lihat launchers/helpers.js).
 *
 * Seluruh perilaku lain (unduh file, composer install, php.ini, PHP binary) tetap dikerjakan
 * oleh vercel-php asli.
 */

const path = require('path');
const base = require('vercel-php');
const { NodejsLambda, FileFsRef } = require('@vercel/build-utils');

exports.version = base.version;
exports.shouldServe = base.shouldServe;
exports.prepareCache = base.prepareCache;

exports.build = async function build(options) {
  const result = await base.build(options);
  const original = result && result.output;

  if (!original || !original.files || typeof original.runtime !== 'string') {
    throw new Error('vercel-php-fix: output dari vercel-php tidak dikenali (files/runtime tidak ada).');
  }
  if (!original.files['launcher.js']) {
    throw new Error('vercel-php-fix: launcher.js tidak ditemukan di output vercel-php.');
  }

  console.log('🐘 vercel-php-fix: membungkus ulang fungsi sebagai NodejsLambda (handler launcher.js)');

  const files = {
    ...original.files,
    // Ganti helpers.js bawaan dengan versi yang sudah diperbaiki.
    'helpers.js': new FileFsRef({ fsPath: path.join(__dirname, 'launchers', 'helpers.js') }),
  };

  const lambdaOptions = {
    files,
    handler: 'launcher.js',
    awsLambdaHandler: 'launcher.launcher',
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

  return { ...result, output: new NodejsLambda(lambdaOptions) };
};
