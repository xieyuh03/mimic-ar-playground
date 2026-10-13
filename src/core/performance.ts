export type Quality = 'balanced' | 'economy';

export class PerformanceBudget {
  quality: Quality = 'balanced';
  private slowSince: number | null = null;
  private healthySince: number | null = null;

  update(fps: number, now: number): Quality {
    if (fps < 42) {
      this.healthySince = null;
      this.slowSince ??= now;
      if (now - this.slowSince >= 2000) this.quality = 'economy';
    } else if (fps > 54) {
      this.slowSince = null;
      this.healthySince ??= now;
      if (now - this.healthySince >= 8000) this.quality = 'balanced';
    } else {
      this.slowSince = this.healthySince = null;
    }
    return this.quality;
  }

  get particleCap(): number { return this.quality === 'economy' ? 360 : 720; }
  get dprCap(): number { return this.quality === 'economy' ? 1 : 1.75; }
  inferenceInterval(inferenceMs: number): number {
    return Math.max(this.quality === 'economy' ? 150 : 80, inferenceMs * 1.5);
  }
}
