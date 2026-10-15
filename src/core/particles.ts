import { sweepEllipse } from './geometry';
import type { Collision, Ellipse } from './geometry';

const COLORS = ['#ffe7a5', '#ff9b65', '#ffb7dc', '#c9b7ff', '#a3f1eb', '#ffffff'];
const RAIN = 0;
const SPARK = 1;
const ROCKET = 2;
const SPLASH = 3;
const EMBER = 4;
const IMPACT = 5;
const SHELL_LIMIT = 6;
const FADE_ALPHA = [0.95, 0.65, 0.3, 0.1, 0.025, 0.003];
export const MAX_PARTICLES = 720;
export type Weather = 'clear' | 'rain' | 'fireworks';

export class ParticleEngine {
  readonly x = new Float32Array(MAX_PARTICLES);
  readonly y = new Float32Array(MAX_PARTICLES);
  readonly vx = new Float32Array(MAX_PARTICLES);
  readonly vy = new Float32Array(MAX_PARTICLES);
  readonly life = new Float32Array(MAX_PARTICLES);
  readonly kind = new Uint8Array(MAX_PARTICLES);
  readonly color = new Uint8Array(MAX_PARTICLES);
  readonly initialLife = new Float32Array(MAX_PARTICLES);
  readonly depth = new Float32Array(MAX_PARTICLES);
  private readonly previousX = new Float32Array(MAX_PARTICLES);
  private readonly previousY = new Float32Array(MAX_PARTICLES);
  private readonly trailX = new Float32Array(MAX_PARTICLES * 4);
  private readonly trailY = new Float32Array(MAX_PARTICLES * 4);
  private readonly targets = new Float32Array(MAX_PARTICLES);
  private readonly timers = new Float32Array(MAX_PARTICLES);
  private readonly hitCooldown = new Float32Array(MAX_PARTICLES);
  private readonly shellTime = new Float32Array(SHELL_LIMIT).fill(-1);
  private readonly shellX = new Float32Array(SHELL_LIMIT);
  private readonly shellY = new Float32Array(SHELL_LIMIT);
  private readonly shellScale = new Float32Array(SHELL_LIMIT);
  private readonly shellColor = new Uint8Array(SHELL_LIMIT);
  private readonly collision: Collision = { x: 0, y: 0, vx: 0, vy: 0 };
  private glowAtlas: HTMLCanvasElement | null = null;
  private cursor = 0;
  private rainDebt = 0;
  private time = 0;
  private width = 1;
  private height = 1;
  private tint = 0;
  private palette = 0;
  count = 0;
  collisions = 0;
  bursts = 0;
  launches = 0;
  cap = MAX_PARTICLES;
  reducedMotion = false;
  weather: Weather = 'clear';

  constructor(private readonly random: () => number = Math.random) {}

  clear(): void {
    this.life.fill(0);
    this.shellTime.fill(-1);
    this.count = this.collisions = this.bursts = this.launches = 0;
    this.cursor = this.rainDebt = this.time = this.tint = 0;
    this.weather = 'clear';
  }

  setWeather(weather: Weather, width: number, height: number): void {
    this.width = width;
    this.height = height;
    if (weather === this.weather) return;
    this.weather = weather;
    this.rainDebt = 0;
    if (weather !== 'fireworks') this.shellTime.fill(-1);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i]! <= 0) continue;
      const rainParticle = this.kind[i] === RAIN || this.kind[i] === SPLASH;
      if ((weather !== 'fireworks' && this.kind[i] === ROCKET) ||
          (weather === 'fireworks' && rainParticle) || (weather === 'rain' && !rainParticle)) this.remove(i);
      else if (weather === 'clear') this.life[i] = Math.min(this.life[i]!, 0.35);
    }
    if (weather === 'rain') {
      const density = Math.min(340, Math.max(150, width * height / 1800));
      for (let i = 0; i < (this.reducedMotion ? 55 : density); i++) this.addRain(true);
    }
  }

  setCap(cap: number): void {
    if (!Number.isInteger(cap) || cap < 1 || cap > MAX_PARTICLES) throw new Error('Invalid particle cap');
    this.cap = cap;
    for (let i = MAX_PARTICLES - 1; i >= 0 && this.count > cap; i--) {
      if (this.life[i]! > 0) this.remove(i);
    }
  }

  get rainCount(): number { return this.countKind(RAIN) + this.countKind(SPLASH); }
  get sparkCount(): number { return this.countKind(SPARK) + this.countKind(EMBER); }
  get rocketCount(): number { return this.countKind(ROCKET); }
  get pendingShells(): number {
    let count = 0;
    for (const at of this.shellTime) if (at >= 0) count++;
    return count;
  }

  launchShow(width: number, height: number, head: Ellipse | null): void {
    this.setWeather('fireworks', width, height);
    const scale = Math.max(0.7, Math.min(1.35, Math.min(width / 600, height / 640)));
    const center = Math.max(width * 0.22, Math.min(width * 0.78, head?.x ?? width * 0.5));
    const crown = head ? head.y - head.ry : height * 0.48;
    const targetY = Math.max(105 * scale, Math.min(height * 0.29, crown - 70 * scale));
    const palette = this.palette++ % 3;
    this.scheduleShell(0, center, targetY, scale, palette * 2);
    if (!this.reducedMotion && this.cap > 360) {
      this.scheduleShell(0.2, width * 0.22, Math.max(80, targetY - height * 0.05), scale * 0.75, (palette * 2 + 1) % COLORS.length);
      this.scheduleShell(0.42, width * 0.78, targetY + height * 0.055, scale * 0.8, (palette * 2 + 2) % COLORS.length);
    }
  }

  burst(x: number, y: number, amount = 180, scale = 1, palette = this.palette % COLORS.length): void {
    this.bursts++;
    const total = this.reducedMotion ? Math.min(48, amount) : amount;
    const offset = this.random() * Math.PI * 2;
    for (let n = 0; n < total; n++) {
      const index = this.allocate(SPARK);
      if (index < 0) break;
      const angle = offset + n * 2.3999632297;
      const z = this.random() * 2 - 1;
      const projectedRadius = Math.sqrt(1 - z * z);
      const speed = (this.reducedMotion ? 125 : 255 + this.random() * 85) * projectedRadius * scale;
      this.x[index] = x;
      this.y[index] = y;
      this.vx[index] = Math.cos(angle) * speed;
      this.vy[index] = Math.sin(angle) * speed - 15 * scale;
      this.setLife(index, 1.6 + this.random() * 1.1);
      this.depth[index] = scale * (0.75 + (z + 1) * 0.25);
      this.color[index] = n % 9 === 0 ? 5 : palette;
      this.previousX[index] = x;
      this.previousY[index] = y;
      this.resetTrail(index, x, y);
    }
    this.addImpact(x, y, palette, this.reducedMotion ? 0.3 : 0.65, 95 * scale);
  }

  step(dt: number, width: number, height: number, rain: boolean, head: Ellipse | null): void {
    if (!Number.isFinite(dt) || dt < 0 || dt > 1 / 30 + 1e-8) throw new Error('Physics step must be within [0, 1/30]');
    this.width = width;
    this.height = height;
    this.time += dt;
    const targetTint = this.weather === 'fireworks' ? 0.38 : rain ? 0.17 : 0;
    this.tint += (targetTint - this.tint) * (1 - Math.exp(-dt * 7));
    for (let slot = 0; slot < SHELL_LIMIT; slot++) {
      if (this.shellTime[slot]! >= 0 && this.shellTime[slot]! <= this.time) {
        this.launchRocket(this.shellX[slot]!, this.shellY[slot]!, this.shellScale[slot]!, this.shellColor[slot]!);
        this.shellTime[slot] = -1;
      }
    }
    if (rain) {
      this.rainDebt += dt * (this.reducedMotion ? 70 : Math.min(420, Math.max(190, width * height / 1200)));
      while (this.rainDebt >= 1) {
        this.rainDebt--;
        if (!this.addRain(false)) { this.rainDebt = 0; break; }
      }
    } else this.rainDebt = 0;

    const drag = Math.exp(-dt * 0.75);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i] = this.life[i]! - dt;
      this.hitCooldown[i] = Math.max(0, this.hitCooldown[i]! - dt);
      const kind = this.kind[i]!;
      if (this.life[i]! <= 0 || this.y[i]! > height + 80 || this.x[i]! < -100 || this.x[i]! > width + 100) {
        this.remove(i);
        continue;
      }
      if (kind === IMPACT || kind === SPLASH) continue;
      let vx = this.vx[i]!;
      let vy = this.vy[i]!;
      if (kind === RAIN) vx = (-55 + Math.sin(this.time * 0.65) * 25) * this.depth[i]!;
      else if (kind === ROCKET) {
        this.timers[i] = this.timers[i]! - dt;
        if (this.timers[i]! <= 0) {
          this.addEmber(this.x[i]!, this.y[i]! + 5, -vx * 0.08, 70, this.color[i]!, this.depth[i]!);
          this.timers[i] = 0.025;
        }
      } else { vx *= drag; vy += (kind === SPARK ? 110 : 70) * dt; }
      const oldX = this.x[i]!;
      const oldY = this.y[i]!;
      this.previousX[i] = this.previousX[i]! + (oldX - this.previousX[i]!) * (1 - Math.exp(-dt * 9));
      this.previousY[i] = this.previousY[i]! + (oldY - this.previousY[i]!) * (1 - Math.exp(-dt * 9));
      if (kind === SPARK) {
        this.timers[i] = this.timers[i]! - dt;
        if (this.timers[i]! <= 0) {
          const offset = i * 4;
          for (let point = 3; point > 0; point--) {
            this.trailX[offset + point] = this.trailX[offset + point - 1]!;
            this.trailY[offset + point] = this.trailY[offset + point - 1]!;
          }
          this.trailX[offset] = oldX;
          this.trailY[offset] = oldY;
          this.timers[i] = 0.035;
        }
      }
      let x = oldX + vx * dt;
      let y = oldY + vy * dt;
      if (kind === ROCKET && y <= this.targets[i]!) {
        const scale = this.depth[i]!;
        const color = this.color[i]!;
        this.remove(i);
        if (this.weather === 'fireworks') this.burst(x, y, this.cap <= 360 ? 145 : 180, scale, color);
        continue;
      }
      if (kind === RAIN && y >= this.targets[i]!) {
        if (this.depth[i]! > 1 && this.random() < 0.5) this.addSplash(x, y, this.depth[i]!);
        this.remove(i);
        continue;
      }
      if (kind === SPARK && head &&
          sweepEllipse(oldX, oldY, x, y, vx, vy, head, dt, 1.8 * this.depth[i]!, this.collision)) {
        const impulse = Math.hypot(vx - this.collision.vx, vy - this.collision.vy);
        x = this.collision.x;
        y = this.collision.y;
        vx = this.collision.vx;
        vy = this.collision.vy;
        if (impulse > 20 && this.hitCooldown[i] === 0) {
          this.collisions++;
          if (this.collisions % 6 === 0 && this.countKind(IMPACT) < 24) this.addImpact(x, y, this.color[i]!, 0.22, 16);
          this.hitCooldown[i] = 0.1;
        }
        this.previousX[i] = x;
        this.previousY[i] = y;
        this.resetTrail(i, x, y);
      }
      this.x[i] = x;
      this.y[i] = y;
      this.vx[i] = vx;
      this.vy[i] = vy;
    }
  }

  draw(context: CanvasRenderingContext2D): void {
    if (this.count === 0 && this.tint < 0.001) return;
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = this.tint;
    context.fillStyle = '#061021';
    context.fillRect(0, 0, this.width, this.height);
    context.globalAlpha = 1;
    context.lineCap = 'round';
    for (let layer = 0; layer < 3; layer++) {
      context.beginPath();
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (this.life[i]! <= 0 || this.kind[i] !== RAIN || this.color[i] !== layer) continue;
        const length = (layer + 1) * 0.018;
        context.moveTo(this.x[i]!, this.y[i]!);
        context.lineTo(this.x[i]! - this.vx[i]! * length, this.y[i]! - this.vy[i]! * length);
      }
      context.strokeStyle = ['rgba(12,31,55,.22)', 'rgba(12,31,55,.32)', 'rgba(12,31,55,.42)'][layer]!;
      context.lineWidth = 1.8 + layer * 1.2;
      context.stroke();
      context.strokeStyle = ['rgba(153,197,221,.35)', 'rgba(183,221,246,.66)', 'rgba(230,247,255,.9)'][layer]!;
      context.lineWidth = 0.6 + layer * 0.65;
      context.stroke();
    }
    context.strokeStyle = '#d4efff';
    context.lineWidth = 1;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i]! <= 0 || this.kind[i] !== SPLASH) continue;
      const age = 1 - this.life[i]! / this.initialLife[i]!;
      context.globalAlpha = (1 - age) * 0.55;
      context.beginPath();
      context.ellipse(this.x[i]!, this.y[i]!, 3 + age * this.depth[i]! * 15, 1 + age * 3, 0, 0, Math.PI * 2);
      context.stroke();
    }
    context.globalAlpha = 1;
    this.ensureGlowAtlas();
    for (let color = 0; color < COLORS.length; color++) {
      context.strokeStyle = COLORS[color]!;
      for (let phase = 0; phase < FADE_ALPHA.length; phase++) {
        for (let segment = 0; segment < 3; segment++) {
          context.beginPath();
          for (let i = 0; i < MAX_PARTICLES; i++) {
            if (this.life[i]! <= 0 || this.kind[i] === RAIN || this.kind[i]! >= SPLASH || this.color[i] !== color) continue;
            const fade = this.life[i]! / this.initialLife[i]!;
            const bucket = fade > 0.5 ? 0 : fade > 0.2 ? 1 : fade > 0.1 ? 2 : fade > 0.04 ? 3 : fade > 0.015 ? 4 : 5;
            if (bucket !== phase) continue;
            if (this.kind[i] === ROCKET) {
              if (segment > 0) continue;
              context.moveTo(this.x[i]!, this.y[i]!);
              context.lineTo(this.previousX[i]!, this.previousY[i]!);
            } else {
              const offset = i * 4;
              context.moveTo(segment === 0 ? this.x[i]! : this.trailX[offset + segment - 1]!,
                segment === 0 ? this.y[i]! : this.trailY[offset + segment - 1]!);
              context.lineTo(this.trailX[offset + segment]!, this.trailY[offset + segment]! - 0.4);
            }
          }
          const alpha = FADE_ALPHA[phase]! * [1, 0.55, 0.2][segment]!;
          context.globalCompositeOperation = 'source-over';
          context.globalAlpha = alpha * 0.2;
          context.lineWidth = this.reducedMotion ? 2.5 : 4;
          context.stroke();
          context.globalCompositeOperation = 'lighter';
          context.globalAlpha = alpha;
          context.lineWidth = (this.reducedMotion ? 1.2 : 1.7) * (1 - segment * 0.2);
          context.stroke();
        }
      }
    }
    context.globalCompositeOperation = 'lighter';
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i]! <= 0 || this.kind[i] === RAIN || this.kind[i] === SPLASH) continue;
      const fraction = this.life[i]! / this.initialLife[i]!;
      const kind = this.kind[i]!;
      const size = kind === IMPACT ? this.depth[i]! * (1.3 - fraction * 0.3) :
        kind === ROCKET ? 22 : kind === EMBER ? 9 * fraction : (9 + 4 * fraction) * this.depth[i]!;
      context.globalAlpha = kind === IMPACT ? fraction * 0.65 : Math.min(0.9, fraction * 2);
      context.drawImage(this.glowAtlas!, this.color[i]! * 64, 0, 64, 64, this.x[i]! - size / 2, this.y[i]! - size / 2, size, size);
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.lineCap = 'butt';
  }

  private addRain(distributed: boolean): boolean {
    const index = this.allocate(RAIN);
    if (index < 0) return false;
    const layer = Math.floor(this.random() * 3);
    const depth = 0.6 + layer * 0.55;
    this.x[index] = this.random() * (this.width + 100) - 20;
    this.y[index] = distributed ? this.random() * this.height : -40;
    this.vx[index] = -50 * depth;
    this.vy[index] = (370 + this.random() * 160) * depth;
    this.depth[index] = depth;
    this.color[index] = layer;
    this.targets[index] = this.height * (0.83 + this.random() * 0.17);
    this.setLife(index, Math.max(0.5, (this.targets[index]! - this.y[index]!) / this.vy[index]! + 0.5));
    return true;
  }

  private scheduleShell(delay: number, x: number, y: number, scale: number, color: number): void {
    for (let slot = 0; slot < SHELL_LIMIT; slot++) {
      if (this.shellTime[slot]! >= 0) continue;
      this.shellTime[slot] = this.time + delay;
      this.shellX[slot] = x;
      this.shellY[slot] = y;
      this.shellScale[slot] = scale;
      this.shellColor[slot] = color;
      return;
    }
  }

  private launchRocket(x: number, targetY: number, scale: number, color: number): void {
    const index = this.allocate(ROCKET);
    if (index < 0) return;
    this.launches++;
    this.x[index] = x + (this.random() - 0.5) * 40;
    this.y[index] = Math.min(this.height + 15, targetY + this.height * 0.65);
    const duration = this.reducedMotion ? 0.65 : 0.42;
    this.vx[index] = (x - this.x[index]!) / duration;
    this.vy[index] = (targetY - this.y[index]!) / duration;
    this.targets[index] = targetY;
    this.depth[index] = scale;
    this.color[index] = color;
    this.previousX[index] = this.x[index]!;
    this.previousY[index] = this.y[index]!;
    this.setLife(index, duration + 0.3);
  }

  private addEmber(x: number, y: number, vx: number, vy: number, color: number, scale: number): void {
    const index = this.allocate(EMBER);
    if (index < 0) return;
    this.x[index] = x;
    this.y[index] = y;
    this.vx[index] = vx;
    this.vy[index] = vy;
    this.depth[index] = scale;
    this.color[index] = color;
    this.setLife(index, 0.2 + this.random() * 0.2);
  }

  private addSplash(x: number, y: number, depth: number): void {
    const index = this.allocate(SPLASH);
    if (index < 0) return;
    this.x[index] = x;
    this.y[index] = y;
    this.depth[index] = depth;
    this.setLife(index, 0.28);
  }

  private addImpact(x: number, y: number, color: number, life: number, size: number): void {
    const index = this.allocate(IMPACT);
    if (index < 0) return;
    this.x[index] = x;
    this.y[index] = y;
    this.color[index] = color;
    this.depth[index] = size;
    this.setLife(index, life);
  }

  private ensureGlowAtlas(): void {
    if (this.glowAtlas) return;
    const atlas = document.createElement('canvas');
    atlas.width = 64 * COLORS.length;
    atlas.height = 64;
    const context = atlas.getContext('2d');
    if (!context) throw new Error('Cannot create the particle glow atlas');
    for (let color = 0; color < COLORS.length; color++) {
      const x = color * 64 + 32;
      const gradient = context.createRadialGradient(x, 32, 0, x, 32, 32);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(0.08, '#ffffff');
      gradient.addColorStop(0.2, COLORS[color]!);
      gradient.addColorStop(0.45, `${COLORS[color]}70`);
      gradient.addColorStop(1, `${COLORS[color]}00`);
      context.fillStyle = gradient;
      context.fillRect(color * 64, 0, 64, 64);
    }
    this.glowAtlas = atlas;
  }

  private setLife(index: number, life: number): void {
    this.life[index] = this.initialLife[index] = life;
  }

  private resetTrail(index: number, x: number, y: number): void {
    for (let point = 0; point < 4; point++) {
      this.trailX[index * 4 + point] = x;
      this.trailY[index * 4 + point] = y;
    }
  }

  private countKind(kind: number): number {
    let count = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) if (this.life[i]! > 0 && this.kind[i] === kind) count++;
    return count;
  }

  private remove(index: number): void {
    this.life[index] = 0;
    this.count--;
  }

  private allocate(kind: number): number {
    if (this.count >= this.cap) return -1;
    for (let n = 0; n < MAX_PARTICLES; n++) {
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      if (this.life[index]! > 0) continue;
      this.count++;
      this.kind[index] = kind;
      this.hitCooldown[index] = this.timers[index] = 0;
      return index;
    }
    return -1;
  }
}
