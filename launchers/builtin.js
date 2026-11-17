'use strict';

/**
 * Launcher mode `lambda` (pengganti dist/launchers/builtin.js dari vercel-php@0.8.0).
 * Dipanggil bootstrap dengan event gaya API Gateway dan mengembalikan {statusCode, headers, body, encoding}.
 * Pengelolaan server PHP ada di phpserver.js.
 */

const http = require('http');
const { normalizeEvent, transformFromAwsRequest, transformToAwsResponse } = require('./helpers');
const { ensureServer } = require('./phpserver');

async function query({ entrypoint, uri, path, headers, method, body }) {
  let port;
  try {
    port = await ensureServer(entrypoint);
  } catch (error) {
    return {
      body: Buffer.from(`PHP Built-In Server failed to start: ${error}`),
      headers: {},
      statusCode: 500,
    };
  }

  return new Promise((resolve) => {
    const options = {
      hostname: '127.0.0.1',
      port,
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
