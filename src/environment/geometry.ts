// Basic 2D vector math and intersection tests used by the track, the car and the sensors.

export interface Vec2 {
  x: number;
  y: number;
}

export interface Segment {
  a: Vec2;
  b: Vec2;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x + q.x, y: p.y + q.y });
export const sub = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x - q.x, y: p.y - q.y });
export const scale = (p: Vec2, s: number): Vec2 => ({ x: p.x * s, y: p.y * s });
export const dot = (p: Vec2, q: Vec2): number => p.x * q.x + p.y * q.y;
export const cross = (p: Vec2, q: Vec2): number => p.x * q.y - p.y * q.x;
export const length = (p: Vec2): number => Math.hypot(p.x, p.y);
export const distance = (p: Vec2, q: Vec2): number => Math.hypot(p.x - q.x, p.y - q.y);
export const fromAngle = (angle: number): Vec2 => ({ x: Math.cos(angle), y: Math.sin(angle) });

export function normalize(p: Vec2): Vec2 {
  const len = length(p);
  return len === 0 ? { x: 0, y: 0 } : { x: p.x / len, y: p.y / len };
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const EPSILON = 1e-9;

/**
 * Casts a ray from `origin` along the unit vector `dir`.
 * Returns the distance to where it hits `seg`, or null if it misses.
 */
export function raySegmentDistance(origin: Vec2, dir: Vec2, seg: Segment): number | null {
  const s = sub(seg.b, seg.a);
  const denom = cross(dir, s);
  if (Math.abs(denom) < EPSILON) return null; // parallel

  const toA = sub(seg.a, origin);
  const t = cross(toA, s) / denom; // distance along the ray
  const u = cross(toA, dir) / denom; // position along the segment (0..1)
  return t >= 0 && u >= 0 && u <= 1 ? t : null;
}

/** True if segment p1-p2 crosses segment q1-q2. */
export function segmentsIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const r = sub(p2, p1);
  const s = sub(q2, q1);
  const denom = cross(r, s);
  if (Math.abs(denom) < EPSILON) return false;

  const toQ = sub(q1, p1);
  const t = cross(toQ, s) / denom;
  const u = cross(toQ, r) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
