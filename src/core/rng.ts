// Deterministic PRNG: mulberry32 over a 32-bit integer state. Every step is integer maths,
// so the sequence is byte-identical on every JS engine and inside snapshots.

const INCREMENT = 0x6d2b79f5;

export function advance(state: number): number {
  return (state + INCREMENT) | 0;
}

/** Scrambles a raw state into a 32-bit unsigned value. */
export function scramble(raw: number): number {
  let t = raw;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

export interface Roll { state: number; value: number }

/** Uniform-ish integer in [0, bound). */
export function roll(state: number, bound: number): Roll {
  const next = advance(state);
  return { state: next, value: scramble(next) % bound };
}

/** Derives an independent stream so two players never share a sequence. */
export function seedState(seed: number, salt: number): number {
  const mixed = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) | 0;
  return advance(scramble(mixed) | 0);
}

