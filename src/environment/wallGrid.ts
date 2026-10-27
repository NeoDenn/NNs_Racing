// Spatial grid over the wall segments, so raycasts and collisions only test nearby walls
// instead of every wall on the track.

import { type Segment, type Vec2, raySegmentDistance } from './geometry.ts';

export class WallGrid {
  readonly walls: Segment[];
  readonly cellSize: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: number[][]; // wall indices per cell
  private readonly seen: Uint32Array; // for de-duplicating walls that span several cells
  private stamp = 0;

  constructor(walls: Segment[], cellSize = 50) {
    this.walls = walls;
    this.cellSize = cellSize;

    const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
    const ys = walls.flatMap((w) => [w.a.y, w.b.y]);
    this.minX = Math.min(...xs);
    this.minY = Math.min(...ys);
    this.cols = Math.floor((Math.max(...xs) - this.minX) / cellSize) + 1;
    this.rows = Math.floor((Math.max(...ys) - this.minY) / cellSize) + 1;
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    this.seen = new Uint32Array(walls.length);

    walls.forEach((w, index) => {
      this.forEachCell(
        Math.min(w.a.x, w.b.x),
        Math.min(w.a.y, w.b.y),
        Math.max(w.a.x, w.b.x),
        Math.max(w.a.y, w.b.y),
        (cell) => cell.push(index),
      );
    });
  }

  /** Every wall whose cell overlaps the given box (each wall at most once). */
  query(minX: number, minY: number, maxX: number, maxY: number): Segment[] {
    const result: Segment[] = [];
    const stamp = ++this.stamp;
    this.forEachCell(minX, minY, maxX, maxY, (cell) => {
      for (const index of cell) {
        if (this.seen[index] === stamp) continue;
        this.seen[index] = stamp;
        result.push(this.walls[index]);
      }
    });
    return result;
  }

  /**
   * Distance from `origin` along the unit vector `dir` to the nearest wall,
   * or null if nothing is hit within `maxDistance`.
   * Walks the grid cell by cell along the ray and stops at the first cell containing a hit.
   */
  raycast(origin: Vec2, dir: Vec2, maxDistance: number): number | null {
    const size = this.cellSize;
    let cx = Math.floor((origin.x - this.minX) / size);
    let cy = Math.floor((origin.y - this.minY) / size);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) {
      return this.raycastAll(origin, dir, maxDistance); // outside the grid: fall back to testing everything
    }

    const stepX = Math.sign(dir.x);
    const stepY = Math.sign(dir.y);
    // Distance along the ray to the next vertical / horizontal cell border, and between borders
    let nextX = dir.x === 0 ? Infinity : ((cx + (stepX > 0 ? 1 : 0)) * size + this.minX - origin.x) / dir.x;
    let nextY = dir.y === 0 ? Infinity : ((cy + (stepY > 0 ? 1 : 0)) * size + this.minY - origin.y) / dir.y;
    const deltaX = dir.x === 0 ? Infinity : size / Math.abs(dir.x);
    const deltaY = dir.y === 0 ? Infinity : size / Math.abs(dir.y);

    let nearest = Infinity;
    while (true) {
      for (const index of this.cells[cy * this.cols + cx]) {
        const d = raySegmentDistance(origin, dir, this.walls[index]);
        if (d !== null && d < nearest) nearest = d;
      }

      const cellExit = Math.min(nextX, nextY);
      if (nearest <= cellExit) break; // nothing in later cells can be closer
      if (cellExit > maxDistance) break;

      if (nextX < nextY) {
        cx += stepX;
        nextX += deltaX;
      } else {
        cy += stepY;
        nextY += deltaY;
      }
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) break;
    }
    return nearest <= maxDistance ? nearest : null;
  }

  private raycastAll(origin: Vec2, dir: Vec2, maxDistance: number): number | null {
    let nearest = Infinity;
    for (const wall of this.walls) {
      const d = raySegmentDistance(origin, dir, wall);
      if (d !== null && d < nearest) nearest = d;
    }
    return nearest <= maxDistance ? nearest : null;
  }

  private forEachCell(minX: number, minY: number, maxX: number, maxY: number, fn: (cell: number[]) => void): void {
    const x0 = Math.max(0, Math.floor((minX - this.minX) / this.cellSize));
    const y0 = Math.max(0, Math.floor((minY - this.minY) / this.cellSize));
    const x1 = Math.min(this.cols - 1, Math.floor((maxX - this.minX) / this.cellSize));
    const y1 = Math.min(this.rows - 1, Math.floor((maxY - this.minY) / this.cellSize));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) fn(this.cells[y * this.cols + x]);
    }
  }
}
