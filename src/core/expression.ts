import type { FaceMetrics } from '../protocol';

export type Expression = 'neutral' | 'smile' | 'laugh';

export interface ExpressionDiagnostics {
  readonly laughProgress: number;
  readonly reason: string;
  readonly openingSource: 'geometry' | 'blendshape' | 'both';
}

export interface ExpressionResult {
  state: Expression;
  burst: boolean;
  smooth: Readonly<FaceMetrics>;
  diagnostics: Readonly<ExpressionDiagnostics>;
}

const LAUGH_EVIDENCE_MS = 520;
const EVIDENCE_GAP_MS = 180;
const LAUGH_RELEASE_MS = 240;
// A confirmed laugh must survive the first rocket's approximately 420ms launch.
const LAUGH_MIN_HOLD_MS = 650;
const RECENT_SMILE_MS = 900;
const TRACKING_GAP_MS = 250;
const BURST_COOLDOWN_MS = 1200;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const copyMetrics = (metrics: FaceMetrics): FaceMetrics => ({
  ...metrics,
  mouth: metrics.mouth ? { ...metrics.mouth } : null,
});

export class ExpressionTracker {
  state: Expression = 'neutral';
  readonly smooth: FaceMetrics = { smile: 0, jaw: 0, cheek: 0, mouth: null };
  private baseline: FaceMetrics = { smile: 0, jaw: 0, cheek: 0 };
  private laughReference: FaceMetrics | null = null;
  private sensitivity = 0.5;
  private lastUpdate: number | null = null;
  private candidate: 'neutral' | 'smile' = 'neutral';
  private candidateSince = 0;
  private evidenceMs = 0;
  private evidenceGapMs = 0;
  private releaseMs = 0;
  private laughAcceptedAt = -Infinity;
  private lastSmileAt = -Infinity;
  private lastBurst = -Infinity;
  private currentDiagnostics: Readonly<ExpressionDiagnostics> = Object.freeze({
    laughProgress: 0, reason: '等待有效的人脸信号', openingSource: 'blendshape',
  });

  get diagnostics(): Readonly<ExpressionDiagnostics> {
    return this.currentDiagnostics;
  }

  setSensitivity(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('Sensitivity must be a finite value in [0, 1]');
    }
    if (value === this.sensitivity) return;
    this.sensitivity = value;
    this.reset();
  }

  calibrate(baseline: FaceMetrics): void {
    this.validate(baseline);
    this.baseline = copyMetrics(baseline);
    this.laughReference = null;
    this.reset();
  }

  calibrateLaugh(reference: FaceMetrics): void {
    this.validate(reference);
    const baseOpen = this.baseline.mouth?.openRatio ?? 0;
    const learned = this.thresholds(reference);
    const smileIsDistinct = reference.smile >= Math.max(0.38, this.baseline.smile + 0.18) &&
      reference.smile - learned.laughSmile >= 0.005;
    const geometryIsOpen = !!reference.mouth &&
      reference.mouth.openRatio >= Math.max(0.12, baseOpen + 0.08) &&
      reference.mouth.openRatio - learned.mouthOpen >= 0.005;
    const geometryIsCompatible = !reference.mouth ||
      (reference.mouth.openRatio >= Math.max(0.08, baseOpen + 0.05) &&
        (!this.baseline.mouth || reference.mouth.widthRatio >= this.baseline.mouth.widthRatio * 0.94));
    const jawIsOpen = reference.jaw >= Math.max(0.18, this.baseline.jaw + 0.12) &&
      reference.jaw - learned.jawOpen >= 0.005;
    if (!smileIsDistinct || !geometryIsCompatible || (!geometryIsOpen && !jawIsOpen)) {
      throw new Error('大笑参考不够明显：请保持嘴角上扬并张嘴，与自然表情形成明显区别后重试。');
    }
    this.laughReference = copyMetrics(reference);
    this.reset();
  }

  // Tracking interruptions discard evidence, not the session's firework cooldown.
  reset(): void {
    this.state = 'neutral';
    this.candidate = 'neutral';
    this.candidateSince = 0;
    this.lastUpdate = null;
    this.evidenceMs = this.evidenceGapMs = this.releaseMs = 0;
    this.laughAcceptedAt = -Infinity;
    this.lastSmileAt = -Infinity;
    this.smooth.smile = this.smooth.jaw = this.smooth.cheek = 0;
    this.smooth.mouth = null;
    this.currentDiagnostics = Object.freeze({
      laughProgress: 0, reason: '等待有效的人脸信号', openingSource: 'blendshape',
    });
  }

  // Sensitivity is a user preference; personal samples belong to the camera session.
  resetSession(): void {
    this.baseline = { smile: 0, jaw: 0, cheek: 0 };
    this.laughReference = null;
    this.lastBurst = -Infinity;
    this.reset();
  }

  update(metrics: FaceMetrics, now: number): ExpressionResult {
    this.validate(metrics);
    if (!Number.isFinite(now) || (this.lastUpdate !== null && now < this.lastUpdate)) {
      throw new Error('Expression timestamps must be finite and monotonic');
    }
    if (this.lastUpdate !== null && now - this.lastUpdate > TRACKING_GAP_MS) this.reset();
    const dt = this.lastUpdate === null ? 0 : now - this.lastUpdate;
    const alpha = 1 - Math.exp(-(this.lastUpdate === null ? 100 : dt) / 90);
    this.lastUpdate = now;
    this.smooth.smile += alpha * (metrics.smile - this.smooth.smile);
    this.smooth.jaw += alpha * (metrics.jaw - this.smooth.jaw);
    this.smooth.cheek += alpha * (metrics.cheek - this.smooth.cheek);
    if (metrics.mouth) {
      const previous = this.smooth.mouth;
      this.smooth.mouth = previous ? {
        openRatio: previous.openRatio + alpha * (metrics.mouth.openRatio - previous.openRatio),
        widthRatio: previous.widthRatio + alpha * (metrics.mouth.widthRatio - previous.widthRatio),
      } : { ...metrics.mouth };
    } else {
      this.smooth.mouth = null;
    }

    const thresholds = this.thresholds();
    const mouth = this.smooth.mouth;
    const rawMouth = metrics.mouth;
    const baseMouth = this.baseline.mouth;
    const widthSupportsSmile = !!mouth && !!rawMouth && !!baseMouth &&
      mouth.widthRatio >= baseMouth.widthRatio * 1.08 &&
      rawMouth.widthRatio >= baseMouth.widthRatio * 1.05;
    const compatibleWidth = !mouth || !rawMouth || !baseMouth ||
      (mouth.widthRatio >= baseMouth.widthRatio * 0.94 && rawMouth.widthRatio >= baseMouth.widthRatio * 0.94);
    const cheekSupportsSmile = this.smooth.cheek - this.baseline.cheek >= 0.08;
    const laughSmile = Math.max(thresholds.smileFloor + 0.02,
      thresholds.laughSmile - (cheekSupportsSmile || widthSupportsSmile ? 0.02 : 0));
    const currentSmile = this.smooth.smile >= thresholds.smileFloor && metrics.smile >= thresholds.smileFloor;
    const directSmile = currentSmile && this.smooth.smile >= laughSmile && metrics.smile >= laughSmile - 0.04;
    const recentSmile = currentSmile && compatibleWidth && now - this.lastSmileAt <= RECENT_SMILE_MS;
    const smileEvidence = directSmile || recentSmile;

    // Raw floors prevent the smoothing tail of a closed mouth from counting as more open-mouth time.
    const geometryFloor = Math.max(0.06, thresholds.mouthOpen - 0.08);
    const jawFloor = Math.max(0.12, thresholds.jawOpen - 0.1);
    const geometryCompatible = !mouth || !rawMouth ||
      (mouth.openRatio >= geometryFloor && rawMouth.openRatio >= geometryFloor);
    const geometryOpen = !!mouth && !!rawMouth &&
      mouth.openRatio >= thresholds.mouthOpen && rawMouth.openRatio >= thresholds.mouthOpen - 0.035;
    const jawOpen = this.smooth.jaw >= thresholds.jawOpen &&
      metrics.jaw >= thresholds.jawOpen - 0.04 && geometryCompatible;
    const opening = geometryOpen || jawOpen;
    const holdingOpening = geometryCompatible &&
      ((!!mouth && !!rawMouth && mouth.openRatio >= Math.max(0.08, thresholds.mouthOpen - 0.06) &&
        rawMouth.openRatio >= geometryFloor) ||
        (this.smooth.jaw >= Math.max(0.14, thresholds.jawOpen - 0.08) && metrics.jaw >= jawFloor));
    const holdingEvidence = currentSmile && (directSmile || compatibleWidth) && holdingOpening;
    const source: ExpressionDiagnostics['openingSource'] = geometryOpen
      ? jawOpen ? 'both' : 'geometry'
      : rawMouth && (!geometryCompatible || !jawOpen) ? 'geometry' : 'blendshape';

    const smiling = this.smooth.smile >= (this.state === 'neutral' ? thresholds.smileOn : thresholds.smileOff);
    if (this.state === 'laugh') {
      this.releaseMs = holdingEvidence ? 0 : this.releaseMs + dt;
      this.evidenceMs = holdingEvidence ? LAUGH_EVIDENCE_MS : Math.max(0, this.evidenceMs - dt);
      if (this.releaseMs >= LAUGH_RELEASE_MS && now - this.laughAcceptedAt >= LAUGH_MIN_HOLD_MS) {
        this.state = smiling ? 'smile' : 'neutral';
        this.candidate = this.state;
        this.candidateSince = now;
        this.evidenceMs = this.evidenceGapMs = this.releaseMs = 0;
        this.laughAcceptedAt = -Infinity;
      }
    } else {
      const target = smiling ? 'smile' : 'neutral';
      if (target !== this.candidate) {
        this.candidate = target;
        this.candidateSince = now;
      }
      if (target !== this.state && now - this.candidateSince >= (target === 'smile' ? 180 : 260)) {
        this.state = target;
      }
      if (smileEvidence && opening) {
        this.evidenceGapMs = 0;
        this.evidenceMs = Math.min(LAUGH_EVIDENCE_MS, this.evidenceMs + dt);
      } else {
        this.evidenceGapMs += dt;
        this.evidenceMs = this.evidenceGapMs >= EVIDENCE_GAP_MS ? 0 : Math.max(0, this.evidenceMs - dt * 0.5);
      }
      if (smileEvidence && opening && this.evidenceMs >= LAUGH_EVIDENCE_MS) {
        this.state = 'laugh';
        this.laughAcceptedAt = now;
      }
    }

    if (this.state !== 'neutral' && this.smooth.smile >= thresholds.laughSmile && metrics.smile >= thresholds.laughSmile) {
      this.lastSmileAt = now;
    }
    const burst = this.state === 'laugh' && holdingEvidence && now - this.lastBurst >= BURST_COOLDOWN_MS;
    if (burst) this.lastBurst = now;
    const reason = this.state === 'laugh'
      ? holdingEvidence ? '张嘴笑已确认'
        : now - this.laughAcceptedAt < LAUGH_MIN_HOLD_MS ? '已确认张嘴笑，短暂保留展示' : '笑容短暂波动，等待恢复'
      : !currentSmile ? '请先保持微笑，单独张嘴不会触发'
        : !smileEvidence ? '微笑信号不足，可先微笑或重新校准'
          : !opening ? '请保持笑容并张开嘴'
            : '正在确认持续的张嘴笑';
    this.currentDiagnostics = Object.freeze({
      laughProgress: clamp(this.evidenceMs / LAUGH_EVIDENCE_MS, 0, 1),
      reason,
      openingSource: source,
    });
    return { state: this.state, burst, smooth: this.smooth, diagnostics: this.currentDiagnostics };
  }

  private thresholds(reference: FaceMetrics | null = this.laughReference) {
    const shift = (0.5 - this.sensitivity) * 0.12;
    const base = this.baseline;
    const baseOpen = base.mouth?.openRatio ?? 0;
    let laughSmile = Math.max(0.47 + shift, base.smile + 0.22);
    let jawOpen = Math.max(0.24 + shift * 0.5, base.jaw + 0.12);
    let mouthOpen = Math.max(0.18 + shift * 0.35, baseOpen + 0.1);
    if (reference) {
      laughSmile = Math.max(0.36 + shift * 0.5, base.smile + 0.16,
        Math.min(laughSmile, base.smile + (reference.smile - base.smile) * 0.7 + shift * 0.5));
      if (reference.jaw >= base.jaw + 0.12) {
        jawOpen = Math.max(0.17 + shift * 0.3, base.jaw + 0.09,
          Math.min(jawOpen, base.jaw + (reference.jaw - base.jaw) * 0.65 + shift * 0.3));
      }
      if (reference.mouth && reference.mouth.openRatio >= baseOpen + 0.08) {
        mouthOpen = Math.max(0.11 + shift * 0.2, baseOpen + 0.07,
          Math.min(mouthOpen, baseOpen + (reference.mouth.openRatio - baseOpen) * 0.65 + shift * 0.2));
      }
    }
    return {
      smileOn: Math.max(0.34 + shift * 0.5, base.smile + 0.16),
      smileOff: Math.max(0.23 + shift * 0.5, base.smile + 0.09),
      smileFloor: Math.max(0.32 + shift / 3, base.smile + 0.1),
      laughSmile, jawOpen, mouthOpen,
    };
  }

  private validate(metrics: FaceMetrics): void {
    for (const value of [metrics.smile, metrics.jaw, metrics.cheek]) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error('Blendshape coefficients must be finite values in [0, 1]');
      }
    }
    if (metrics.mouth && (!Number.isFinite(metrics.mouth.openRatio) || metrics.mouth.openRatio < 0 ||
      !Number.isFinite(metrics.mouth.widthRatio) || metrics.mouth.widthRatio <= 0)) {
      throw new Error('Mouth geometry must have a finite non-negative openRatio and a positive widthRatio');
    }
  }
}
