export function parseResponseRateLimit(value, defaultValue = 600) {
  if (value === undefined || value === '') return defaultValue;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100_000) {
    throw new Error('RATE_LIMIT_PER_MINUTE_PER_IP must be an integer between 1 and 100000');
  }
  return limit;
}

export function createIpRateLimiter({ limit, windowMs = 60_000, getIp }) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('Rate limit must be a positive integer');
  }
  const buckets = new Map();
  let requestsSinceCleanup = 0;

  function removeExpiredBuckets(now) {
    for (const [ip, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(ip);
    }
  }

  return function rateLimitByIp(req, res, next) {
    const now = Date.now();
    requestsSinceCleanup += 1;
    if (requestsSinceCleanup >= 1024) {
      requestsSinceCleanup = 0;
      removeExpiredBuckets(now);
    }

    const ip = getIp(req);
    let bucket = buckets.get(ip);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, bucket);
    }
    if (bucket.count >= limit) {
      return res.status(429).json({
        code: 42901,
        message: '请求过于频繁，请稍后再试'
      });
    }
    bucket.count += 1;
    return next();
  };
}
