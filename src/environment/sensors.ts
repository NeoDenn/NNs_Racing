// Raycast sensors: how far the car can see towards the walls in each direction.

import { type Vec2, fromAngle } from './geometry.ts';
import type { WallGrid } from './wallGrid.ts';

export interface SensorConfig {
  angles: number[]; // radians relative to the car's heading; 0 = straight ahead, positive = to the right
  range: number; // max distance a sensor can see
}

export interface SensorReading {
  values: number[]; // one per sensor: distance / range, so 0 = touching a wall, 1 = nothing in range
  hits: (Vec2 | null)[]; // where each ray hit a wall (null = nothing in range), for drawing
}

/** `count` sensors spread evenly all around the car, the first one pointing straight ahead. */
export function evenSensorAngles(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i / count) * Math.PI * 2);
}

/** `count` sensors fanned out in front of the car across `fov` radians. */
export function fanSensorAngles(count: number, fov: number): number[] {
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, i) => -fov / 2 + (i / (count - 1)) * fov);
}

export const DEFAULT_SENSOR_CONFIG: SensorConfig = {
  angles: evenSensorAngles(24),
  range: 500,
};

export function readSensors(origin: Vec2, heading: number, walls: WallGrid, config: SensorConfig): SensorReading {
  const values: number[] = [];
  const hits: (Vec2 | null)[] = [];

  for (const angle of config.angles) {
    const dir = fromAngle(heading + angle);
    const nearest = walls.raycast(origin, dir, config.range) ?? config.range;
    values.push(nearest / config.range);
    hits.push(nearest < config.range ? { x: origin.x + dir.x * nearest, y: origin.y + dir.y * nearest } : null);
  }
  return { values, hits };
}
