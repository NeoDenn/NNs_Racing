// Draws a simulation on a canvas. Purely visual: the simulation runs the same with or without it.

import type { Vec2 } from './geometry.ts';
import type { Agent, Simulation } from './simulation.ts';

export interface RenderOptions {
  focus?: Agent | null; // highlighted car (its sensors and next checkpoint are drawn)
  showSensors?: 'none' | 'focus' | 'all';
  showCheckpoints?: boolean;
  player?: Agent | null; // manually driven test car, drawn in red on top (can belong to another simulation)
}

const COLORS = {
  background: '#1b1d22',
  road: '#3a3d45',
  wall: '#e8e8e8',
  checkpoint: 'rgba(255, 255, 255, 0.12)',
  nextCheckpoint: 'rgba(80, 220, 120, 0.9)',
  startLine: '#ffffff',
  car: '#4ea1ff',
  focusCar: '#ff9f1c',
  deadCar: 'rgba(150, 150, 150, 0.35)',
  player: '#ff3b3b',
  deadPlayer: 'rgba(255, 59, 59, 0.4)',
  sensorRay: 'rgba(255, 220, 90, 0.45)',
  sensorHit: '#ff5c5c',
};

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private zoom = 1; // world units -> CSS pixels
  private offsetX = 0;
  private offsetY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
  }

  draw(sim: Simulation, options: RenderOptions = {}): void {
    const { ctx } = this;
    const track = sim.track;
    this.fitToCanvas(sim);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(this.zoom * dpr, 0, 0, this.zoom * dpr, this.offsetX * dpr, this.offsetY * dpr);
    const px = 1 / this.zoom; // one screen pixel in world units, for constant line widths

    // Road: the area between the two walls
    ctx.beginPath();
    tracePolygon(ctx, track.leftWall);
    tracePolygon(ctx, track.rightWall);
    ctx.fillStyle = COLORS.road;
    ctx.fill('evenodd');

    if (options.showCheckpoints) {
      ctx.strokeStyle = COLORS.checkpoint;
      ctx.lineWidth = px;
      ctx.beginPath();
      for (const cp of track.checkpoints.slice(1)) {
        ctx.moveTo(cp.a.x, cp.a.y);
        ctx.lineTo(cp.b.x, cp.b.y);
      }
      ctx.stroke();
    }

    const start = track.checkpoints[0];
    ctx.strokeStyle = COLORS.startLine;
    ctx.lineWidth = 3 * px;
    ctx.setLineDash([6 * px, 6 * px]);
    ctx.beginPath();
    ctx.moveTo(start.a.x, start.a.y);
    ctx.lineTo(start.b.x, start.b.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = COLORS.wall;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    tracePolygon(ctx, track.leftWall);
    tracePolygon(ctx, track.rightWall);
    ctx.stroke();

    const focus = options.focus ?? null;
    if (focus?.alive) {
      const next = track.checkpoints[focus.nextCheckpoint];
      ctx.strokeStyle = COLORS.nextCheckpoint;
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.moveTo(next.a.x, next.a.y);
      ctx.lineTo(next.b.x, next.b.y);
      ctx.stroke();
    }

    const showSensors = options.showSensors ?? 'focus';
    for (const agent of sim.agents) {
      if (!agent.alive) continue;
      if (showSensors === 'all' || (showSensors === 'focus' && agent === focus)) {
        this.drawSensors(sim, agent, px);
      }
    }

    // Dead cars first so the living ones are drawn on top; the focused car last
    const ordered = [...sim.agents].sort((a, b) => rank(a, focus) - rank(b, focus));
    for (const agent of ordered) {
      const color = !agent.alive ? COLORS.deadCar : agent === focus ? COLORS.focusCar : COLORS.car;
      this.drawCar(agent, color);
    }

    const player = options.player;
    if (player) {
      if (player.alive && showSensors !== 'none') this.drawSensors(sim, player, px);
      this.drawCar(player, player.alive ? COLORS.player : COLORS.deadPlayer);
    }
  }

  private drawSensors(sim: Simulation, agent: Agent, px: number): void {
    const { ctx } = this;
    const { position, angle } = agent.car;
    const { angles, range } = sim.config.sensors;

    ctx.lineWidth = px;
    angles.forEach((sensorAngle, i) => {
      const hit = agent.sensorHits[i];
      const end = hit ?? {
        x: position.x + Math.cos(angle + sensorAngle) * range,
        y: position.y + Math.sin(angle + sensorAngle) * range,
      };
      ctx.strokeStyle = COLORS.sensorRay;
      ctx.beginPath();
      ctx.moveTo(position.x, position.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      if (hit) {
        ctx.fillStyle = COLORS.sensorHit;
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, 3 * px, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  private drawCar(agent: Agent, color: string): void {
    const { ctx } = this;
    const corners = agent.car.corners();
    ctx.fillStyle = color;
    ctx.beginPath();
    tracePolygon(ctx, corners);
    ctx.fill();

    // Windshield mark so you can tell front from back
    if (agent.alive) {
      const [frontLeft, frontRight, backRight, backLeft] = corners;
      const at = (p: Vec2, q: Vec2, w: number) => ({ x: p.x + (q.x - p.x) * w, y: p.y + (q.y - p.y) * w });
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      tracePolygon(ctx, [
        at(frontLeft, backLeft, 0.15),
        at(frontRight, backRight, 0.15),
        at(frontRight, backRight, 0.35),
        at(frontLeft, backLeft, 0.35),
      ]);
      ctx.fill();
    }
  }

  /** Resizes the canvas to its on-screen size and centers the track in it. */
  private fitToCanvas(sim: Simulation): void {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = this.canvas.clientWidth;
    const cssHeight = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(cssWidth * dpr) || this.canvas.height !== Math.round(cssHeight * dpr)) {
      this.canvas.width = Math.round(cssWidth * dpr);
      this.canvas.height = Math.round(cssHeight * dpr);
    }

    const { minX, minY, maxX, maxY } = sim.track.bounds;
    const padding = 20;
    const worldWidth = maxX - minX;
    const worldHeight = maxY - minY;
    this.zoom = Math.max(
      0.01,
      Math.min((cssWidth - padding * 2) / worldWidth, (cssHeight - padding * 2) / worldHeight),
    );
    this.offsetX = (cssWidth - worldWidth * this.zoom) / 2 - minX * this.zoom;
    this.offsetY = (cssHeight - worldHeight * this.zoom) / 2 - minY * this.zoom;
  }
}

function tracePolygon(ctx: CanvasRenderingContext2D, points: Vec2[]): void {
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

function rank(agent: Agent, focus: Agent | null): number {
  if (agent === focus) return 2;
  return agent.alive ? 1 : 0;
}
