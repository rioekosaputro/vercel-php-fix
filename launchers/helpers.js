'use strict';

/**
 * Pengganti dist/launchers/helpers.js dari vercel-php@0.8.0.
 *
 * Diturunkan dari vercel-php (MIT, (c) 2019 Milan Felix Sulc) dengan perubahan dari
 * PR #654 vercel-community/php:
 *   - LAMBDA_TASK_ROOT bisa kosong di bootstrap Node yang baru -> fallback '/var/task'
 *     (path php.ini dan library bersama PHP juga memakai /var/task).
 *   - body request dapat berupa string, Buffer, atau array byte -> selalu dinormalkan ke Buffer.
 *   - validasi event/header yang lebih ketat, dan fallback host dari header.
 *
 * Ekspor yang dipakai launcher.js (builtin.js): getUserDir, getPhpDir, isDev, normalizeEvent,
 * transformFromAwsRequest, transformToAwsResponse.
 */

const { join: pathJoin } = require('path');

const getTaskRoot = () => process.env.LAMBDA_TASK_ROOT || '/var/task';
const getUserDir = () => pathJoin(getTaskRoot(), 'user');
const getPhpDir = () => pathJoin(getTaskRoot(), 'php');
const isDev = () => process.env.NOW_PHP_DEV === '1';

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isByteArray(value) {
  return Array.isArray(value) && value.every(
    (item) => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 255
  );
}

function normalizeBody(body, encoding) {
  if (encoding !== undefined && encoding !== null && encoding !== 'utf8' && encoding !== 'base64') {
    throw new Error(`Unsupported encoding: ${encoding}`);
  }
  if (body === undefined || body === null) return undefined;
  // Buffer dan array byte sudah ter-decode, meskipun flag encoding terisi.
  if (Buffer.isBuffer(body)) return body;
  if (isByteArray(body)) return Buffer.from(body);
  if (typeof body === 'string') {
    return Buffer.from(body, encoding === 'base64' ? 'base64' : 'utf8');
  }
  throw new TypeError('Request body must be a string, Buffer, or array of bytes');
}

function normalizeHeaders(value) {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new TypeError('Request headers must be an object');
  const headers = {};
  for (const [name, header] of Object.entries(value)) {
    if (header !== undefined && typeof header !== 'string' && !isStringArray(header)) {
      throw new TypeError(`Invalid request header: ${name}`);
    }
    // defineProperty (bukan assignment) agar nama seperti "__proto__" tidak memengaruhi prototype.
    Object.defineProperty(headers, name, { value: header, enumerable: true });
  }
  return headers;
}

function getHeader(headers, name) {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  const value = key === undefined ? undefined : headers[key];
  return Array.isArray(value) ? value[0] : value;
}

function normalizeEvent(event) {
  if (!isRecord(event)) throw new TypeError('Request event must be an object');

  const isInvoke = event.Action === 'Invoke';
  let request = event;

  if (isInvoke) {
    if (typeof event.body !== 'string') throw new TypeError('Invoke body must be JSON text');
    const parsed = JSON.parse(event.body);
    if (!isRecord(parsed)) throw new TypeError('Invoke body must contain a request object');
    request = parsed;
  }

  const method = isInvoke ? request.method : request.httpMethod;
  const { path } = request;
  if (typeof method !== 'string' || typeof path !== 'string') {
    throw new TypeError('Request method and path must be strings');
  }
  if (request.host !== undefined && request.host !== null && typeof request.host !== 'string') {
    throw new TypeError('Request host must be a string');
  }

  const headers = normalizeHeaders(request.headers);
  const host = request.host || getHeader(headers, 'x-forwarded-host') || getHeader(headers, 'host') || '';

  if (!isInvoke && request.isBase64Encoded !== undefined &&
      request.isBase64Encoded !== null && typeof request.isBase64Encoded !== 'boolean') {
    throw new TypeError('isBase64Encoded must be a boolean');
  }
  const encoding = isInvoke ? request.encoding : (request.isBase64Encoded === true ? 'base64' : 'utf8');

  return { method, path, host, headers, body: normalizeBody(request.body, encoding) };
}

async function transformFromAwsRequest({ method, path, host, headers, body }) {
  if (!process.env.NOW_ENTRYPOINT) {
    console.error('Missing ENV NOW_ENTRYPOINT');
  }
  const entrypoint = pathJoin(getUserDir(), process.env.NOW_ENTRYPOINT || 'index.php');
  const uri = host + path;
  return { entrypoint, uri, path, host, method, headers, body };
}

function transformToAwsResponse({ statusCode, headers, body }) {
  return { statusCode, headers, body: body.toString('base64'), encoding: 'base64' };
}

exports.getUserDir = getUserDir;
exports.getPhpDir = getPhpDir;
exports.isDev = isDev;
exports.normalizeEvent = normalizeEvent;
exports.transformFromAwsRequest = transformFromAwsRequest;
exports.transformToAwsResponse = transformToAwsResponse;
