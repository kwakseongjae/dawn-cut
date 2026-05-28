/**
 * Portable UUID. Uses the Web Crypto global (available in Node 20+ and browsers)
 * so packages/core stays free of `node:crypto` (boundary constraint, 00-SEED #1).
 */
export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}
