import type { Express } from 'express';

// Express ignores X-Forwarded-For unless explicitly told how many hops to
// trust; an over-permissive value lets clients forge their address and mint
// fresh rate-limit buckets, so only a verified hop count or proxy list is
// accepted (enforced in env.validation.ts).
export function applyTrustProxy(
  expressApp: Express,
  trustProxy?: string,
): void {
  if (!trustProxy) {
    return;
  }
  expressApp.set(
    'trust proxy',
    /^\d+$/.test(trustProxy)
      ? Number(trustProxy)
      : trustProxy.split(',').map((entry) => entry.trim()),
  );
}
