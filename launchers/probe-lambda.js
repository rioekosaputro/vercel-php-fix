'use strict';

// Fungsi probe mode `lambda`: handler gaya AWS Lambda (event, context), tanpa PHP.
const { info, describe, bootstrapExcerpt } = require('./introspect');

console.log(`🐘 PROBE[lambda]: modul dimuat, node ${process.version}`);

exports.launcher = async function probeLambda(event, context) {
  const keys = event && typeof event === 'object' ? Object.keys(event) : [];
  console.log(`🐘 PROBE[lambda]: dipanggil. event=${describe(event)} kunci=${keys.join(',')} context=${describe(context)} argumen=${arguments.length}`);

  const path = event && typeof event.path === 'string' ? event.path : '/';
  const params = new URL(path, 'http://probe.local').searchParams;
  const wantsText = params.has('find') || params.has('slice');
  const payload = wantsText ? bootstrapExcerpt(params) : JSON.stringify({
    probe: 'lambda',
    eventKeys: keys,
    eventTypes: Object.fromEntries(keys.map((k) => [k, describe(event[k])])),
    contextType: describe(context),
    ...info(),
  }, null, 2);

  return {
    statusCode: 200,
    headers: { 'content-type': wantsText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8' },
    body: Buffer.from(payload).toString('base64'),
    encoding: 'base64',
  };
};
