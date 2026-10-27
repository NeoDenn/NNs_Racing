// The racing world: a track plus any number of cars (agents), advanced in fixed time steps.
// It knows nothing about how agents decide; whoever drives just calls agent.setControls().

import { Car, type CarConfig, type Controls, DEFAULT_CAR_CONFIG } from './car.ts';
import { type Vec2, clamp, distance, segmentsIntersect } from './geometry.ts';
import { DEFAULT_SENSOR_CONFIG, type SensorConfig, readSensors } from './sensors.ts';
import type { Track } from './track.ts';

export type DeathReason = 'wall' | 'stuck';

export interface SimulationConfig {
  dt: number; // seconds per step (fixed, so results don't depend on frame rate)
  car: CarConfig;
  sensors: SensorConfig;
  stuckTime: number; // seconds without reaching a new checkpoint before a car is removed
}

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  dt: 1 / 60,
  car: DEFAULT_CAR_CONFIG,
  sensors: DEFAULT_SENSOR_CONFIG,
  stuckTime: 5,
};

/** How many numbers agent.sensors holds: one per ray, plus speed, acceleration and drift. */
export function inputCount(config: SimulationConfig = DEFAULT_SIMULATION_CONFIG): number {
  return config.sensors.angles.length + 3;
}

export class Agent {
  readonly id: number;
  readonly car: Car;
  controls: Controls = { steer: 0, throttle: 0 };

  // What the NN reads: [...rays (0..1), speed (0..1), acceleration (-1..1), drift (-1..1)]
  sensors: number[] = [];
  sensorHits: (Vec2 | null)[] = []; // where each ray hit a wall, for drawing

  alive = true;
  deathReason: DeathReason | null = null;

  nextCheckpoint = 1; // index of the next checkpoint to cross (0 = start/finish line)
  checkpointsPassed = 0; // total over all laps, never goes down
  laps = 0;
  time = 0; // seconds alive
  timeSinceCheckpoint = 0;
  distanceDriven = 0;

  constructor(id: number, car: Car) {
    this.id = id;
    this.car = car;
  }

  /** Values outside -1..1 are clamped. */
  setControls(controls: Controls): void {
    this.controls = { steer: clamp(controls.steer, -1, 1), throttle: clamp(controls.throttle, -1, 1) };
  }
}

export class Simulation {
  readonly track: Track;
  readonly config: SimulationConfig;
  agents: Agent[] = [];
  time = 0;
  private nextId = 0;

  constructor(track: Track, config: Partial<SimulationConfig> = {}) {
    this.track = track;
    this.config = { ...DEFAULT_SIMULATION_CONFIG, ...config };
  }

  /** Adds `count` new cars on the start line and returns them. */
  spawn(count = 1): Agent[] {
    const spawned: Agent[] = [];
    for (let i = 0; i < count; i++) {
      const { position, angle } = this.track.start;
      const agent = new Agent(this.nextId++, new Car(position, angle, this.config.car));
      this.updateSensors(agent);
      this.agents.push(agent);
      spawned.push(agent);
    }
    return spawned;
  }

  /** Removes all cars and resets the clock. */
  reset(): void {
    this.agents = [];
    this.time = 0;
  }

  get aliveCount(): number {
    return this.agents.reduce((n, a) => n + (a.alive ? 1 : 0), 0);
  }

  get allDead(): boolean {
    return this.agents.every((a) => !a.alive);
  }

  /** Lap progress as a number: 2.5 = two laps and half of the third. */
  progress(agent: Agent): number {
    return agent.checkpointsPassed / this.track.checkpoints.length;
  }

  /** Advances the world by one fixed step, using each agent's current controls. */
  step(): void {
    const dt = this.config.dt;
    this.time += dt;

    for (const agent of this.agents) {
      if (!agent.alive) continue;

      const before = { ...agent.car.position };
      agent.car.step(agent.controls, dt);
      const after = agent.car.position;
      agent.time += dt;
      agent.timeSinceCheckpoint += dt;
      agent.distanceDriven += distance(before, after);

      this.updateCheckpoints(agent, before, after);

      if (this.hitsWall(agent, before)) {
        this.kill(agent, 'wall');
      } else if (agent.timeSinceCheckpoint > this.config.stuckTime) {
        this.kill(agent, 'stuck');
      }

      this.updateSensors(agent);
    }
  }

  private updateCheckpoints(agent: Agent, before: Vec2, after: Vec2): void {
    const checkpoints = this.track.checkpoints;
    const gate = checkpoints[agent.nextCheckpoint];
    if (!segmentsIntersect(before, after, gate.a, gate.b)) return;

    agent.checkpointsPassed++;
    agent.timeSinceCheckpoint = 0;
    if (agent.nextCheckpoint === 0) agent.laps++;
    agent.nextCheckpoint = (agent.nextCheckpoint + 1) % checkpoints.length;
  }

  private hitsWall(agent: Agent, before: Vec2): boolean {
    const { position, config } = agent.car;
    const reach = Math.hypot(config.length, config.width) / 2;
    // The car body, plus the path of its center during this step: at high speed a sliding car
    // moves more than its own width per step and could otherwise pass through a wall
    const edges = [...agent.car.edges(), { a: before, b: position }];
    const nearby = this.track.grid.query(
      Math.min(position.x, before.x) - reach,
      Math.min(position.y, before.y) - reach,
      Math.max(position.x, before.x) + reach,
      Math.max(position.y, before.y) + reach,
    );

    for (const wall of nearby) {
      for (const edge of edges) {
        if (segmentsIntersect(edge.a, edge.b, wall.a, wall.b)) return true;
      }
    }
    return false;
  }

  private kill(agent: Agent, reason: DeathReason): void {
    agent.alive = false;
    agent.deathReason = reason;
    agent.car.stop();
  }

  private updateSensors(agent: Agent): void {
    const car = agent.car;
    const reading = readSensors(car.position, car.angle, this.track.grid, this.config.sensors);

    // Normalized so full gas is about +0.7 (gas minus friction), full brake is -1
    const { maxSpeed, acceleration, braking, friction } = car.config;
    const accel = car.acceleration >= 0 ? car.acceleration / acceleration : car.acceleration / (braking + friction);

    // Drift: sideways sliding speed, negative = sliding to the car's left, positive = to its right
    const drift = clamp(car.lateralSpeed / maxSpeed, -1, 1);

    agent.sensors = [...reading.values, car.speed / maxSpeed, clamp(accel, -1, 1), drift];
    agent.sensorHits = reading.hits;
  }
}
