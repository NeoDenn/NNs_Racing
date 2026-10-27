// Builds a drivable track (walls + checkpoints) from a closed loop of centerline points.

import {
  type Segment,
  type Vec2,
  add,
  distance,
  normalize,
  scale,
  segmentsIntersect,
  sub,
  vec,
} from './geometry.ts';
import { WallGrid } from './wallGrid.ts';

/** What you write by hand: a loop of points down the middle of the road, plus the road width. */
export interface TrackDefinition {
  name: string;
  points: Vec2[]; // at least 3, in driving order; the last point connects back to the first
  width: number;
}

export interface Track {
  name: string;
  width: number;
  length: number; // length of the centerline loop
  centerline: Vec2[]; // evenly spaced samples, closed loop
  leftWall: Vec2[]; // one point per centerline sample
  rightWall: Vec2[];
  walls: Segment[]; // every wall segment: what sensors and collisions use
  grid: WallGrid; // fast lookup of the walls near a point or along a ray
  checkpoints: Segment[]; // gates across the road, in driving order; index 0 is the start line
  start: { position: Vec2; angle: number };
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  warnings: string[]; // e.g. walls crossing each other because a turn is too tight for the width
}

export interface BuildOptions {
  sampleSpacing?: number; // distance between centerline samples (smaller = smoother walls, more segments)
  checkpointSpacing?: number; // approximate distance between checkpoints
}

export function buildTrack(def: TrackDefinition, options: BuildOptions = {}): Track {
  if (def.points.length < 3) throw new Error(`Track "${def.name}" needs at least 3 points`);
  const sampleSpacing = options.sampleSpacing ?? 8;
  const checkpointSpacing = options.checkpointSpacing ?? 40;

  const dense = smoothClosedCurve(def.points, 20);
  const centerline = resampleClosed(dense, sampleSpacing);
  const n = centerline.length;

  // Push the walls out half the road width on each side of the centerline
  const half = def.width / 2;
  const leftWall: Vec2[] = [];
  const rightWall: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const tangent = normalize(sub(centerline[(i + 1) % n], centerline[(i - 1 + n) % n]));
    const normal = vec(-tangent.y, tangent.x);
    leftWall.push(add(centerline[i], scale(normal, half)));
    rightWall.push(sub(centerline[i], scale(normal, half)));
  }

  const walls: Segment[] = [];
  for (const wall of [leftWall, rightWall]) {
    for (let i = 0; i < n; i++) walls.push({ a: wall[i], b: wall[(i + 1) % n] });
  }

  const step = Math.max(1, Math.round(checkpointSpacing / sampleSpacing));
  const checkpoints: Segment[] = [];
  for (let i = 0; i + step / 2 < n; i += step) {
    checkpoints.push({ a: leftWall[i], b: rightWall[i] });
  }

  const first = centerline[0];
  const ahead = centerline[1];
  const start = { position: { ...first }, angle: Math.atan2(ahead.y - first.y, ahead.x - first.x) };

  let length = 0;
  for (let i = 0; i < n; i++) length += distance(centerline[i], centerline[(i + 1) % n]);

  const allPoints = [...leftWall, ...rightWall];
  const bounds = {
    minX: Math.min(...allPoints.map((p) => p.x)),
    minY: Math.min(...allPoints.map((p) => p.y)),
    maxX: Math.max(...allPoints.map((p) => p.x)),
    maxY: Math.max(...allPoints.map((p) => p.y)),
  };

  const track: Track = {
    name: def.name,
    width: def.width,
    length,
    centerline,
    leftWall,
    rightWall,
    walls,
    grid: new WallGrid(walls),
    checkpoints,
    start,
    bounds,
    warnings: [],
  };
  track.warnings = findWallProblems(track);
  for (const warning of track.warnings) console.warn(`Track "${def.name}": ${warning}`);
  return track;
}

/** Quick test track: an oval built from a length, height and road width. */
export function createOvalTrack(opts: {
  length: number;
  height: number;
  trackWidth: number;
  center?: Vec2;
  name?: string;
}): TrackDefinition {
  const center = opts.center ?? vec(opts.length / 2 + opts.trackWidth, opts.height / 2 + opts.trackWidth);
  const count = 16;
  const points: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    points.push(vec(center.x + (Math.cos(angle) * opts.length) / 2, center.y + (Math.sin(angle) * opts.height) / 2));
  }
  return { name: opts.name ?? 'Oval', points, width: opts.trackWidth };
}

/**
 * Smooth closed curve through all control points (centripetal Catmull-Rom,
 * which avoids the loops and overshoots the plain version can produce).
 */
function smoothClosedCurve(points: Vec2[], stepsPerSpan: number): Vec2[] {
  const n = points.length;
  const result: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];

    const t0 = 0;
    const t1 = t0 + Math.sqrt(distance(p0, p1)) || t0 + 1e-6;
    const t2 = t1 + Math.sqrt(distance(p1, p2)) || t1 + 1e-6;
    const t3 = t2 + Math.sqrt(distance(p2, p3)) || t2 + 1e-6;

    for (let s = 0; s < stepsPerSpan; s++) {
      const t = t1 + ((t2 - t1) * s) / stepsPerSpan;
      const a1 = lerpAt(p0, p1, t0, t1, t);
      const a2 = lerpAt(p1, p2, t1, t2, t);
      const a3 = lerpAt(p2, p3, t2, t3, t);
      const b1 = lerpAt(a1, a2, t0, t2, t);
      const b2 = lerpAt(a2, a3, t1, t3, t);
      result.push(lerpAt(b1, b2, t1, t2, t));
    }
  }
  return result;
}

function lerpAt(p: Vec2, q: Vec2, tp: number, tq: number, t: number): Vec2 {
  const w = (t - tp) / (tq - tp);
  return vec(p.x + (q.x - p.x) * w, p.y + (q.y - p.y) * w);
}

/** Re-places points along a closed polyline so they are evenly spaced. */
function resampleClosed(points: Vec2[], spacing: number): Vec2[] {
  const n = points.length;
  const cumulative = [0];
  for (let i = 0; i < n; i++) cumulative.push(cumulative[i] + distance(points[i], points[(i + 1) % n]));
  const total = cumulative[n];

  const count = Math.max(3, Math.round(total / spacing));
  const step = total / count;
  const result: Vec2[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (cumulative[seg + 1] < target) seg++;
    const segLength = cumulative[seg + 1] - cumulative[seg];
    const w = segLength === 0 ? 0 : (target - cumulative[seg]) / segLength;
    const a = points[seg];
    const b = points[(seg + 1) % n];
    result.push(vec(a.x + (b.x - a.x) * w, a.y + (b.y - a.y) * w));
  }
  return result;
}

/** Finds wall segments that cross each other (turn too tight for the road width, or the loop crosses itself). */
function findWallProblems(track: Track): string[] {
  const n = track.centerline.length;
  const walls = track.walls; // [0, n) = left wall, [n, 2n) = right wall
  let crossings = 0;
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 2; j < walls.length; j++) {
      const sameWall = i < n === j < n;
      if (sameWall && (j - i <= 1 || j - i >= n - 1)) continue; // neighbours share an endpoint
      if (segmentsIntersect(walls[i].a, walls[i].b, walls[j].a, walls[j].b)) crossings++;
    }
  }
  return crossings === 0
    ? []
    : [`${crossings} wall crossing(s): a turn is too tight for the road width, or the track crosses itself`];
}
