'use strict';

// Fungsi probe mode `http`: handler Node standar (req, res), tanpa PHP.
const { info, describe, bootstrapExcerpt } = require('./introspect');

console.log(`🐘 PROBE[http]: modul dimuat, node ${process.version}`);

module.exports = function probeHttp(req, res) {
  console.log(`🐘 PROBE[http]: dipanggil ${req.method} ${req.url}`);
  const params = new URL(req.url, 'http://probe.local').searchParams;
  if (params.has('find') || params.has('slice')) {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(bootstrapExcerpt(params));
    return;
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    probe: 'http', method: req.method, url: req.url, headerNames: Object.keys(req.headers),
    reqType: describe(req), ...info(),
  }, null, 2));
};
