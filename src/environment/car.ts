// Car physics. A car only knows how to move; crashing and progress are handled by the simulation.

import { type Segment, type Vec2, clamp, dot, fromAngle, length } from './geometry.ts';

/** What a driver (keyboard, NN, ...) sends each tick. Both values are clamped to -1..1. */
export interface Controls {
  steer: number; // -1 = full left, 0 = straight, 1 = full right
  throttle: number; // -1 = full brake, 0 = coast, 1 = full gas
}

export interface CarConfig {
  length: number;
  width: number;
  maxSpeed: number; // units per second
  maxReverseSpeed: number; // 0 = braking stops the car but never reverses
  acceleration: number; // units per second²
  braking: number; // units per second²
  friction: number; // slowdown per second when coasting
  lateralGrip: number; // max sideways slowdown per second; turning harder than this makes the car slide (drift)
  turnRate: number; // radians per second at full steer
  fullTurnSpeed: number; // below this speed steering is weaker (a car can't turn on the spot)
}

export const DEFAULT_CAR_CONFIG: CarConfig = {
  length: 20,
  width: 10,
  maxSpeed: 500,
  maxReverseSpeed: 0,
  acceleration: 300,
  braking: 500,
  friction: 50,
  lateralGrip: 2700,
  turnRate: 4.2,
  fullTurnSpeed: 60,
};

export class Car {
  position: Vec2;
  angle: number; // radians, 0 = pointing right (+x). Where the car looks, not always where it moves
  velocity: Vec2 = { x: 0, y: 0 }; // where the car actually moves
  acceleration = 0; // change in forward speed per second during the last step
  readonly config: CarConfig;

  constructor(position: Vec2, angle: number, config: CarConfig = DEFAULT_CAR_CONFIG) {
    this.position = { ...position };
    this.angle = angle;
    this.config = config;
  }

  /** Speed in the direction the car is facing. */
  get speed(): number {
    return dot(this.velocity, fromAngle(this.angle));
  }

  /** Sideways sliding speed: 0 = full grip, positive = sliding to the car's right. */
  get lateralSpeed(): number {
    const forward = fromAngle(this.angle);
    return dot(this.velocity, { x: -forward.y, y: forward.x });
  }

  stop(): void {
    this.velocity = { x: 0, y: 0 };
    this.acceleration = 0;
  }

  step(controls: Controls, dt: number): void {
    const c = this.config;
    const throttle = clamp(controls.throttle, -1, 1);
    const steer = clamp(controls.steer, -1, 1);

    // Split the velocity into the part along the car and the part sideways
    const forward = fromAngle(this.angle);
    const side = { x: -forward.y, y: forward.x };
    let forwardSpeed = dot(this.velocity, forward);
    let sideSpeed = dot(this.velocity, side);
    const speedBefore = forwardSpeed;

    // Gas pushes along the nose. Reverse gear only when (almost) stopped and reversing is allowed
    const reversing = throttle < 0 && c.maxReverseSpeed > 0 && forwardSpeed <= 1;
    if (throttle > 0) {
      forwardSpeed = Math.min(forwardSpeed + throttle * c.acceleration * dt, Math.max(forwardSpeed, c.maxSpeed));
    } else if (reversing) {
      forwardSpeed = Math.max(forwardSpeed + throttle * c.acceleration * dt, Math.min(forwardSpeed, -c.maxReverseSpeed));
    }

    // Rolling friction pulls the forward speed towards 0 without overshooting
    const drag = c.friction * dt;
    forwardSpeed = Math.abs(forwardSpeed) <= drag ? 0 : forwardSpeed - Math.sign(forwardSpeed) * drag;

    // The tires fight sideways sliding, but only up to lateralGrip: beyond that the car keeps sliding
    const sideGrip = c.lateralGrip * dt;
    sideSpeed = Math.abs(sideSpeed) <= sideGrip ? 0 : sideSpeed - Math.sign(sideSpeed) * sideGrip;

    this.velocity = {
      x: forward.x * forwardSpeed + side.x * sideSpeed,
      y: forward.y * forwardSpeed + side.y * sideSpeed,
    };

    // Sliding sideways while at full gas must not add up to more than maxSpeed overall
    const total = length(this.velocity);
    if (total > c.maxSpeed) {
      this.velocity = { x: (this.velocity.x * c.maxSpeed) / total, y: (this.velocity.y * c.maxSpeed) / total };
      forwardSpeed = dot(this.velocity, forward);
    }

    // Braking slows the car in the direction it is actually moving (also while sliding),
    // and never pushes it backwards
    if (throttle < 0 && !reversing) {
      const moving = length(this.velocity);
      const slowdown = -throttle * c.braking * dt;
      const keep = moving <= slowdown ? 0 : (moving - slowdown) / moving;
      this.velocity = { x: this.velocity.x * keep, y: this.velocity.y * keep };
      forwardSpeed = dot(this.velocity, forward);
    }
    this.acceleration = (forwardSpeed - speedBefore) / dt;

    // Steering turns the body only; the velocity follows through the grip in the next steps
    const turnGrip = clamp(Math.abs(forwardSpeed) / c.fullTurnSpeed, 0, 1);
    this.angle += steer * c.turnRate * turnGrip * Math.sign(forwardSpeed) * dt;

    this.position = {
      x: this.position.x + this.velocity.x * dt,
      y: this.position.y + this.velocity.y * dt,
    };
  }

  /** The 4 corners of the car body: front-left, front-right, back-right, back-left. */
  corners(): Vec2[] {
    const forward = fromAngle(this.angle);
    const side = { x: -forward.y, y: forward.x };
    const hl = this.config.length / 2;
    const hw = this.config.width / 2;
    const { x, y } = this.position;
    return [
      { x: x + forward.x * hl - side.x * hw, y: y + forward.y * hl - side.y * hw },
      { x: x + forward.x * hl + side.x * hw, y: y + forward.y * hl + side.y * hw },
      { x: x - forward.x * hl + side.x * hw, y: y - forward.y * hl + side.y * hw },
      { x: x - forward.x * hl - side.x * hw, y: y - forward.y * hl - side.y * hw },
    ];
  }

  edges(): Segment[] {
    const c = this.corners();
    return c.map((a, i) => ({ a, b: c[(i + 1) % c.length] }));
  }
}
