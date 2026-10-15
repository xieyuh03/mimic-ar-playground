import type { FaceMetrics } from '../protocol';

export type CalibrationMode = 'neutral' | 'laugh';
export type CalibrationResult =
  | { status: 'waiting' | 'collecting'; progress: number }
  | { status: 'complete'; reference: FaceMetrics }
  | { status: 'timeout' };

export class CalibrationSampler {
  private samples: FaceMetrics[] = [];
  private firstSample: number | null = null;
  private lastSample: number | null = null;

  constructor(readonly mode: CalibrationMode, readonly startedAt: number) {}

  interrupt(): void {
    this.samples = [];
    this.firstSample = this.lastSample = null;
  }

  update(metrics: FaceMetrics, now: number): CalibrationResult {
    if (!Number.isFinite(now) || now < this.startedAt || (this.lastSample !== null && now < this.lastSample)) {
      throw new Error('Calibration requires finite, monotonic timestamps');
    }
    if (now - this.startedAt > 10000) return { status: 'timeout' };
    if ([metrics.smile, metrics.jaw, metrics.cheek].some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error('Calibration received invalid facial coefficients');
    }
    if (this.lastSample !== null && now - this.lastSample > 350) this.interrupt();
    const geometryOpen = metrics.mouth?.openRatio ?? 0;
    const suitable = this.mode === 'neutral'
      ? metrics.smile <= 0.32 && metrics.jaw <= 0.22 && geometryOpen <= 0.18
      : metrics.smile >= 0.25 && (metrics.jaw >= 0.16 || geometryOpen >= 0.18);
    if (!suitable) {
      this.interrupt();
      return { status: 'waiting', progress: 0 };
    }
    this.firstSample ??= now;
    this.lastSample = now;
    this.samples.push({ ...metrics, mouth: metrics.mouth ? { ...metrics.mouth } : null });
    if (this.samples.length > 64) this.samples.shift();
    const duration = this.mode === 'neutral' ? 1500 : 1100;
    const progress = Math.min((now - this.firstSample) / duration, this.samples.length / 8, 1);
    if (progress < 1) return { status: 'collecting', progress };
    const reference: FaceMetrics = { smile: 0, jaw: 0, cheek: 0, mouth: null };
    let open = 0;
    let width = 0;
    let geometryCount = 0;
    for (const sample of this.samples) {
      reference.smile += sample.smile / this.samples.length;
      reference.jaw += sample.jaw / this.samples.length;
      reference.cheek += sample.cheek / this.samples.length;
      if (sample.mouth) {
        open += sample.mouth.openRatio;
        width += sample.mouth.widthRatio;
        geometryCount++;
      }
    }
    if (geometryCount >= this.samples.length * 0.8) {
      reference.mouth = { openRatio: open / geometryCount, widthRatio: width / geometryCount };
    }
    return { status: 'complete', reference };
  }
}
