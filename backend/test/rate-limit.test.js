import test from 'node:test';
import assert from 'node:assert/strict';
import { createIpRateLimiter, parseResponseRateLimit } from '../src/rate-limit.js';

function mockResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test('response rate limit defaults to 600 requests per minute and rejects invalid configuration', () => {
  assert.equal(parseResponseRateLimit(undefined), 600);
  assert.equal(parseResponseRateLimit('900'), 900);
  assert.throws(() => parseResponseRateLimit('not-a-number'), /integer/);
});

test('rate limit is configurable per IP and does not affect a different IP', () => {
  const middleware = createIpRateLimiter({ limit: 2, getIp: (req) => req.ip, windowMs: 60_000 });
  const makeRequest = (ip) => {
    const response = mockResponse();
    let nextCalled = false;
    middleware({ ip }, response, () => { nextCalled = true; });
    return { response, nextCalled };
  };

  assert.equal(makeRequest('192.0.2.1').nextCalled, true);
  assert.equal(makeRequest('192.0.2.1').nextCalled, true);
  const limited = makeRequest('192.0.2.1');
  assert.equal(limited.response.statusCode, 429);
  assert.equal(limited.nextCalled, false);
  assert.equal(makeRequest('192.0.2.2').nextCalled, true);
});
