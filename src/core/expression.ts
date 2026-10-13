import type { FaceMetrics } from '../protocol';

export type Expression = 'neutral' | 'smile' | 'laugh';

export interface ExpressionResult {
  state: Expression;
  burst: boolean;
  smooth: Readonly<FaceMetrics>;
}

export class ExpressionTracker {
  state: Expression = 'neutral';
  readonly smooth: FaceMetrics = { smile: 0, jaw: 0, cheek: 0 };
  private baseline: FaceMetrics = { smile: 0, jaw: 0, cheek: 0 };
  private lastUpdate: number | null = null;
  private candidate: Expression = 'neutral';
  private candidateSince = 0;
  private lastBurst = -Infinity;

  calibrate(baseline: FaceMetrics): void {
    this.validate(baseline);
    this.baseline = { ...baseline };
    this.reset();
  }

  reset(): void {
    this.state = 'neutral';
    this.candidate = 'neutral';
    this.lastUpdate = null;
    this.lastBurst = -Infinity;
    this.smooth.smile = this.smooth.jaw = this.smooth.cheek = 0;
  }

  update(metrics: FaceMetrics, now: number): ExpressionResult {
    this.validate(metrics);
    if (!Number.isFinite(now) || (this.lastUpdate !== null && now < this.lastUpdate)) {
      throw new Error('Expression timestamps must be finite and monotonic');
    }
    const dt = this.lastUpdate === null ? 100 : Math.min(250, now - this.lastUpdate);
    this.lastUpdate = now;
    const alpha = 1 - Math.exp(-dt / 90);
    this.smooth.smile += alpha * (metrics.smile - this.smooth.smile);
    this.smooth.jaw += alpha * (metrics.jaw - this.smooth.jaw);
    this.smooth.cheek += alpha * (metrics.cheek - this.smooth.cheek);

    const baseSmile = Math.min(this.baseline.smile, 0.22);
    const baseJaw = Math.min(this.baseline.jaw, 0.15);
    const smileOn = Math.max(0.34, baseSmile + 0.23);
    const smileOff = Math.max(0.23, baseSmile + 0.13);
    const laughSmile = Math.max(0.55, baseSmile + 0.38);
    const laughJaw = Math.max(0.24, baseJaw + 0.18);
    const holdingLaugh = this.state === 'laugh';
    const laughing =
      this.smooth.smile >= laughSmile - (holdingLaugh ? 0.1 : 0) &&
      this.smooth.jaw >= laughJaw - (holdingLaugh ? 0.08 : 0) &&
      (this.smooth.cheek >= 0.1 || this.smooth.smile >= 0.75);
    const smiling = this.smooth.smile >= (this.state === 'neutral' ? smileOn : smileOff);
    const target: Expression = laughing ? 'laugh' : smiling ? 'smile' : 'neutral';
    if (target !== this.candidate) {
      this.candidate = target;
      this.candidateSince = now;
    }
    const dwell = target === 'neutral' ? 260 : target === 'laugh' ? 140 : 180;
    if (target !== this.state && now - this.candidateSince >= dwell) this.state = target;

    const burst = this.state === 'laugh' && now - this.lastBurst >= 1200;
    if (burst) this.lastBurst = now;
    return { state: this.state, burst, smooth: this.smooth };
  }

  private validate(metrics: FaceMetrics): void {
    for (const value of [metrics.smile, metrics.jaw, metrics.cheek]) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error('Blendshape coefficients must be finite values in [0, 1]');
      }
    }
  }
}
