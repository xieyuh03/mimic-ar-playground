import { sweepEllipse } from './geometry';
import type { Collision, Ellipse } from './geometry';

const COLORS = ['#ffe9a1', '#ff9bcb', '#bba6ff', '#9deaff'];
export const MAX_PARTICLES = 720;

export class ParticleEngine {
  readonly x = new Float32Array(MAX_PARTICLES);
  readonly y = new Float32Array(MAX_PARTICLES);
  readonly vx = new Float32Array(MAX_PARTICLES);
  readonly vy = new Float32Array(MAX_PARTICLES);
  readonly life = new Float32Array(MAX_PARTICLES);
  readonly kind = new Uint8Array(MAX_PARTICLES);
  readonly color = new Uint8Array(MAX_PARTICLES);
  count = 0;
  collisions = 0;
  cap = MAX_PARTICLES;
  reducedMotion = false;
  private cursor = 0;
  private rainDebt = 0;
  private readonly collision: Collision = { x: 0, y: 0, vx: 0, vy: 0 };

  clear(): void {
    this.life.fill(0);
    this.count = 0;
    this.collisions = 0;
    this.cursor = 0;
    this.rainDebt = 0;
  }

  setCap(cap: number): void {
    if (!Number.isInteger(cap) || cap < 1 || cap > MAX_PARTICLES) throw new Error('Invalid particle cap');
    this.cap = cap;
    if (this.count > cap) {
      for (let i = MAX_PARTICLES - 1; i >= 0 && this.count > cap; i--) {
        if (this.life[i]! > 0) { this.life[i] = 0; this.count--; }
      }
    }
  }

  burst(x: number, y: number, amount = 150): void {
    const total = this.reducedMotion ? Math.min(50, amount) : amount;
    for (let n = 0; n < total; n++) {
      const index = this.allocate();
      if (index < 0) break;
      const angle = (n / total) * Math.PI * 2 + Math.random() * 0.09;
      const speed = 75 + Math.random() * 205;
      this.x[index] = x;
      this.y[index] = y;
      this.vx[index] = Math.cos(angle) * speed;
      this.vy[index] = Math.sin(angle) * speed;
      this.life[index] = 1.9 + Math.random() * 1.1;
      this.kind[index] = 1;
      this.color[index] = n % COLORS.length;
    }
  }

  step(dt: number, width: number, height: number, rain: boolean, head: Ellipse | null): void {
    if (!Number.isFinite(dt) || dt < 0 || dt > 1 / 30 + 1e-8) throw new Error('Physics step must be within [0, 1/30]');
    if (rain) {
      this.rainDebt += dt * (this.reducedMotion ? 32 : 105);
      while (this.rainDebt >= 1) {
        this.rainDebt--;
        const index = this.allocate();
        if (index < 0) { this.rainDebt = 0; break; }
        this.x[index] = Math.random() * (width + 80) - 40;
        this.y[index] = -20;
        this.vx[index] = -28;
        this.vy[index] = 290 + Math.random() * 180;
        this.life[index] = 4;
        this.kind[index] = 0;
      }
    } else this.rainDebt = 0;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i]! <= 0) continue;
      const remaining = this.life[i]! - dt;
      if (remaining <= 0 || this.y[i]! > height + 60 || this.x[i]! < -100 || this.x[i]! > width + 100) {
        this.life[i] = 0;
        this.count--;
        continue;
      }
      this.life[i] = remaining;
      let vx = this.vx[i]!;
      let vy = this.vy[i]!;
      if (this.kind[i] === 1) {
        vx *= Math.exp(-dt * 0.2);
        vy += 200 * dt;
      }
      const oldX = this.x[i]!;
      const oldY = this.y[i]!;
      let x = oldX + vx * dt;
      let y = oldY + vy * dt;
      if (this.kind[i] === 1 && head &&
          sweepEllipse(oldX, oldY, x, y, vx, vy, head, dt, 1.8, this.collision)) {
        x = this.collision.x;
        y = this.collision.y;
        vx = this.collision.vx;
        vy = this.collision.vy;
        this.collisions++;
      }
      this.x[i] = x;
      this.y[i] = y;
      this.vx[i] = vx;
      this.vy[i] = vy;
    }
  }

  draw(context: CanvasRenderingContext2D): void {
    context.globalCompositeOperation = 'source-over';
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(173,225,245,0.62)';
    context.beginPath();
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i]! > 0 && this.kind[i] === 0) {
        context.moveTo(this.x[i]!, this.y[i]!);
        context.lineTo(this.x[i]! - this.vx[i]! * 0.032, this.y[i]! - this.vy[i]! * 0.032);
      }
    }
    context.stroke();
    context.globalCompositeOperation = 'lighter';
    context.lineCap = 'round';
    context.lineWidth = this.reducedMotion ? 1.5 : 2;
    for (let color = 0; color < COLORS.length; color++) {
      context.strokeStyle = COLORS[color]!;
      context.beginPath();
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (this.life[i]! > 0 && this.kind[i] === 1 && this.color[i] === color) {
          const tail = Math.min(0.022, this.life[i]! * 0.035);
          context.moveTo(this.x[i]!, this.y[i]!);
          context.lineTo(this.x[i]! - this.vx[i]! * tail, this.y[i]! - this.vy[i]! * tail - 0.7);
        }
      }
      context.stroke();
    }
    context.lineCap = 'butt';
    context.globalCompositeOperation = 'source-over';
  }

  private allocate(): number {
    if (this.count >= this.cap) return -1;
    for (let n = 0; n < MAX_PARTICLES; n++) {
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      if (this.life[index]! <= 0) { this.count++; return index; }
    }
    return -1;
  }
}
