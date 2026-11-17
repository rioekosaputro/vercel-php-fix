'use strict';

/**
 * Alat diagnostik untuk fungsi "probe" (tanpa PHP). Hanya dipakai saat config.probe = true.
 *
 * Yang ditampilkan: versi Node, daftar variabel lingkungan bawaan platform (nama LAMBDA_/AWS_LAMBDA_/NOW_
 * saja, bukan rahasia proyek), isi direktori /opt dan /var/task, serta potongan kode bootstrap Vercel
 * (/opt/rust/nodejs.js) di sekitar teks yang dicari, untuk memahami kontrak pemanggilan handler.
 * Jangan menaruh fungsi probe di produksi.
 */

const fs = require('fs');

const BOOTSTRAP = '/opt/rust/nodejs.js';
const SAFE_ENV = /^(LAMBDA_|AWS_LAMBDA_|_HANDLER$|AWS_EXECUTION_ENV$|AWS_REGION$|NOW_|NODE_OPTIONS$|PORT$|TZ$|VERCEL_REGION$|VERCEL_ENV$)/;

function list(dir) {
  try { return fs.readdirSync(dir).slice(0, 60); } catch (e) { return `(tidak terbaca: ${e.code || e.message})`; }
}

function describe(value) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return 'null';
  return typeof value;
}

function info(extra) {
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (SAFE_ENV.test(key)) env[key] = key === 'AWS_LAMBDA_RUNTIME_API' ? '(terisi)' : process.env[key];
  }
  return {
    node: process.version,
    pid: process.pid,
    argv: process.argv.slice(0, 4),
    cwd: process.cwd(),
    env,
    'dir /opt': list('/opt'),
    'dir /opt/rust': list('/opt/rust'),
    'dir /var/task': list('/var/task'),
    ...extra,
  };
}

/** ?find=teks  -> potongan sekitar kemunculan teks; ?slice=baris:awal-akhir -> potongan satu baris. */
function bootstrapExcerpt(params) {
  let text;
  try { text = fs.readFileSync(BOOTSTRAP, 'utf8'); } catch (e) { return `(tidak bisa membaca ${BOOTSTRAP}: ${e.message})`; }
  const find = params.get('find');
  const slice = params.get('slice');
  const out = [`${BOOTSTRAP}: ${text.length} karakter`];
  if (slice) {
    const m = /^(\d+):(\d+)-(\d+)$/.exec(slice);
    if (!m) return 'format slice: baris:awal-akhir, contoh 2:15000-17000';
    const lines = text.split('\n');
    const line = lines[Number(m[1]) - 1] || '';
    out.push(`--- baris ${m[1]}, kolom ${m[2]}-${m[3]} (panjang baris ${line.length}) ---`);
    out.push(line.slice(Number(m[2]), Math.min(Number(m[3]), Number(m[2]) + 6000)));
  }
  if (find) {
    let from = 0; let shown = 0;
    for (;;) {
      const at = text.indexOf(find, from);
      if (at < 0 || shown >= 6) break;
      out.push(`--- "${find}" @${at} ---`);
      out.push(text.slice(Math.max(0, at - 700), at + 900));
      from = at + find.length; shown += 1;
    }
    if (!shown) out.push(`(tidak ada "${find}")`);
  }
  if (!slice && !find) out.push('Pakai ?find=teks atau ?slice=2:15000-17000');
  return out.join('\n');
}

exports.info = info;
exports.describe = describe;
exports.bootstrapExcerpt = bootstrapExcerpt;
