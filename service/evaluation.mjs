import { keccak256, toUtf8Bytes } from 'ethers';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_CANONICAL_BYTES = 1_048_576;

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Stable JSON for evidence hashing. Reject values JSON would silently discard or alter. */
export function canonicalize(value) {
  const active = new Set();
  let entries = 0;
  function encode(item, depth) {
    if (depth > 32 || ++entries > 10_000) throw new TypeError('Evidence exceeds structural limits');
    if (item === null) return 'null';
    if (typeof item === 'boolean') return item ? 'true' : 'false';
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Object.is(item, -0) || (Number.isInteger(item) && !Number.isSafeInteger(item))) {
        throw new TypeError('Evidence numbers must be finite and unambiguous; use strings for large integers');
      }
      return JSON.stringify(item);
    }
    if (typeof item === 'string') {
      if (item.length > 65_536 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(item)) {
        throw new TypeError('Evidence string exceeds limits or contains an unpaired surrogate');
      }
      return JSON.stringify(item);
    }
    if (typeof item !== 'object' || active.has(item)) throw new TypeError('Evidence must be acyclic JSON data');
    if (Object.getOwnPropertySymbols(item).length) throw new TypeError('Evidence cannot contain symbol keys');
    active.add(item);
    let result;
    if (Array.isArray(item)) {
      if (item.length > 1_000 || Object.keys(item).length !== item.length || !Object.keys(item).every((key, index) => key === String(index))) {
        throw new TypeError('Evidence arrays must be dense and have no extra properties');
      }
      result = `[${item.map((entry) => encode(entry, depth + 1)).join(',')}]`;
    } else {
      if (!plainObject(item)) throw new TypeError('Evidence objects must contain plain JSON data');
      const keys = Object.keys(item).sort();
      if (keys.length > 1_000 || Object.getOwnPropertyNames(item).length !== keys.length) throw new TypeError('Evidence has invalid object properties');
      result = `{${keys.map((key) => {
        if (FORBIDDEN_KEYS.has(key) || key.length > 256) throw new TypeError('Evidence object has a forbidden or oversized key');
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !('value' in descriptor)) throw new TypeError('Evidence cannot contain getters or setters');
        return `${encode(key, depth + 1)}:${encode(descriptor.value, depth + 1)}`;
      }).join(',')}}`;
    }
    active.delete(item);
    return result;
  }
  const encoded = encode(value, 0);
  if (new TextEncoder().encode(encoded).length > MAX_CANONICAL_BYTES) throw new TypeError('Evidence exceeds byte limit');
  return encoded;
}

function formatOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return { type: 'array', items: value.map(formatOf) };
  if (typeof value === 'object') return { type: 'object', fields: Object.fromEntries(Object.keys(value).sort().map((key) => [key, formatOf(value[key])])) };
  return typeof value;
}

/** Deterministic comparison of caller-provided expected/actual JSON, not a model or truth oracle. */
export function evaluate(samples) {
  if (!Array.isArray(samples) || samples.length === 0 || samples.length > 128) throw new TypeError('Provide 1–128 evaluation samples');
  canonicalize(samples);
  const ids = new Set();
  const results = samples.map((sample) => {
    if (!plainObject(sample) || Object.keys(sample).sort().join(',') !== 'actual,expected,id,input') throw new TypeError('Each sample requires exactly id, input, expected, actual');
    if (typeof sample.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(sample.id) || ids.has(sample.id)) throw new TypeError('Sample identifiers must be unique bounded identifiers');
    ids.add(sample.id);
    const expectedFormat = formatOf(sample.expected);
    const actualFormat = formatOf(sample.actual);
    return {
      id: sample.id,
      exactMatch: canonicalize(sample.expected) === canonicalize(sample.actual),
      formatMatch: canonicalize(expectedFormat) === canonicalize(actualFormat),
      expectedFormat,
      actualFormat,
    };
  });
  const passed = results.filter((result) => result.exactMatch).length;
  const report = {
    version: 1,
    kind: 'DETERMINISTIC_EXACT_JSON_AND_FORMAT',
    scope: 'CALLER_PROVIDED_SAMPLES',
    modelAssisted: false,
    sampleCount: samples.length,
    passed,
    failed: samples.length - passed,
    exactMatchRateBps: Math.floor(passed * 10_000 / samples.length),
    formatPassed: results.filter((result) => result.formatMatch).length,
    results,
    limitation: 'Exact JSON and format comparison only. Caller-provided labels, including synthetic samples, do not establish factual truth, quality, or independent demand.',
  };
  const digest = keccak256(toUtf8Bytes(canonicalize({ samples, report })));
  return { report, digest };
}
