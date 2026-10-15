import { describe, expect, it } from 'vitest';
import { ExpressionTracker } from '../src/core/expression';
import type { FaceMetrics } from '../src/protocol';

// These are synthetic coefficient/geometry traces, not measurements of recognition accuracy.
const neutral: FaceMetrics = { smile: 0.05, jaw: 0.04, cheek: 0.02 };
const smile: FaceMetrics = { smile: 0.8, jaw: 0.06, cheek: 0.25 };
const laugh: FaceMetrics = { smile: 0.85, jaw: 0.65, cheek: 0.3 };
const restingGeometry: FaceMetrics = { ...neutral, mouth: { openRatio: 0.02, widthRatio: 0.32 } };
const smilingGeometry: FaceMetrics = { ...smile, mouth: { openRatio: 0.025, widthRatio: 0.43 } };

function feed(tracker: ExpressionTracker, metrics: FaceMetrics | ((now: number) => FaceMetrics),
  start = 0, duration = 1000, interval = 50) {
  const bursts: number[] = [];
  for (let frame = 0; frame * interval < duration - 1e-6; frame++) {
    const now = start + frame * interval;
    if (tracker.update(typeof metrics === 'function' ? metrics(now) : metrics, now).burst) bursts.push(now);
  }
  return bursts;
}

function acceptLaugh(tracker: ExpressionTracker, start = 0, interval = 50) {
  for (let frame = 0; frame * interval < 2000; frame++) {
    const now = start + frame * interval;
    const result = tracker.update(laugh, now);
    if (result.state === 'laugh') return { now, result };
  }
  throw new Error('The synthetic sustained laugh was not accepted');
}

describe('expression classification', () => {
  it('keeps a neutral face neutral', () => {
    const tracker = new ExpressionTracker();
    expect(feed(tracker, neutral)).toHaveLength(0);
    expect(tracker.state).toBe('neutral');
  });
  it('maps a sustained smile to rain without fireworks', () => {
    const tracker = new ExpressionTracker();
    expect(feed(tracker, smile)).toHaveLength(0);
    expect(tracker.state).toBe('smile');
  });
  it('recognizes a sustained open-mouth smile', () => {
    const tracker = new ExpressionTracker();
    expect(feed(tracker, laugh).length).toBe(1);
    expect(tracker.state).toBe('laugh');
  });
  it.each([0, 0.03])('does not require cheek evidence (%s)', cheek => {
    const tracker = new ExpressionTracker();
    expect(feed(tracker, { smile: 0.68, jaw: 0.62, cheek })).toHaveLength(1);
    expect(tracker.state).toBe('laugh');
  });
  it.each([
    { smile: 0.48, jaw: 0.38, cheek: 0.025 },
    { smile: 0.68, jaw: 0.31, cheek: 0.03 },
  ])('recognizes the reported low-cheek regression trace: %j', metrics => {
    const tracker = new ExpressionTracker();
    expect(feed(tracker, metrics, 0, 2000).length).toBeGreaterThan(0);
    expect(tracker.state).toBe('laugh');
  });
  it('recognizes smile coefficients dropping as the jaw opens', () => {
    const tracker = new ExpressionTracker();
    feed(tracker, { smile: 0.72, jaw: 0.06, cheek: 0.16 });
    expect(feed(tracker, { smile: 0.46, jaw: 0.65, cheek: 0.2 }, 1000)).toHaveLength(1);
    expect(tracker.state).toBe('laugh');
  });
  it('uses a recent established smile, even without cheek support', () => {
    const tracker = new ExpressionTracker();
    feed(tracker, smile);
    expect(feed(tracker, { smile: 0.35, jaw: 0.65, cheek: 0.01 }, 1000)).toHaveLength(1);
    expect(tracker.state).toBe('laugh');
  });
  it('expires recent smile evidence instead of promoting a later weak expression', () => {
    const tracker = new ExpressionTracker();
    feed(tracker, smile);
    feed(tracker, { smile: 0.35, jaw: 0.04, cheek: 0.01 }, 1000, 1500);
    expect(feed(tracker, { smile: 0.35, jaw: 0.65, cheek: 0.01 }, 2500, 2000)).toHaveLength(0);
    expect(tracker.state).toBe('smile');
  });
  it('does not let a recent smile override the current smile floor', () => {
    const tracker = new ExpressionTracker();
    feed(tracker, smile);
    expect(feed(tracker, { smile: 0.08, jaw: 0.95, cheek: 0.2 }, 1000, 2000)).toHaveLength(0);
    expect(tracker.state).toBe('neutral');
  });
  it('uses actual mouth opening when jawOpen underreports it', () => {
    const tracker = new ExpressionTracker();
    expect(feed(tracker, {
      smile: 0.72, jaw: 0.14, cheek: 0.14, mouth: { openRatio: 0.28, widthRatio: 0.43 },
    })).toHaveLength(1);
    expect(tracker.state).toBe('laugh');
    expect(tracker.diagnostics.openingSource).toBe('geometry');
  });
  it('reports corroborating opening cues and discards missing geometry immediately', () => {
    const tracker = new ExpressionTracker();
    feed(tracker, { ...laugh, mouth: { openRatio: 0.3, widthRatio: 0.43 } });
    expect(tracker.diagnostics.openingSource).toBe('both');
    feed(tracker, { smile: 0.72, jaw: 0.05, cheek: 0.14, mouth: null }, 1000);
    expect(tracker.smooth.mouth).toBeNull();
    expect(tracker.diagnostics.openingSource).toBe('blendshape');
    expect(tracker.state).toBe('smile');
  });
  it('does not trust an elevated jaw coefficient over visibly closed lips', () => {
    const tracker = new ExpressionTracker();
    expect(feed(tracker, {
      ...laugh, mouth: { openRatio: 0.02, widthRatio: 0.43 },
    }, 0, 3000)).toHaveLength(0);
    expect(tracker.state).toBe('smile');
  });
  it.each([100, 50, 1000 / 30])('tolerates short threshold jitter at %s ms/frame', interval => {
    const tracker = new ExpressionTracker();
    feed(tracker, { smile: 0.62, jaw: 0.1, cheek: 0.2 }, 0, 1000, interval);
    const bursts = feed(tracker, now => ({
      smile: 0.62, jaw: now % 200 < 100 ? 0.35 : 0.16, cheek: 0.2,
    }), 1000, 4000, interval);
    expect(bursts.length).toBeGreaterThan(0);
    expect(tracker.state).toBe('laugh');
  });
  it.each([100, 50, 1000 / 30])('rejects repeated 350ms speech pulses at %s ms/frame', interval => {
    const tracker = new ExpressionTracker();
    const bursts = feed(tracker, now => ({
      smile: 0.6, jaw: now % 600 < 350 ? 0.5 : 0.1, cheek: 0.12,
    }), 0, 6000, interval);
    expect(bursts).toHaveLength(0);
    expect(tracker.state).toBe('smile');
  });
  it.each([100, 50, 1000 / 30])('does not let geometry smoothing extend speech pulses at %s ms/frame', interval => {
    const tracker = new ExpressionTracker();
    const bursts = feed(tracker, now => {
      const open = now % 600 < 350;
      return {
        smile: 0.6, jaw: open ? 0.5 : 0.1, cheek: 0.12,
        mouth: { openRatio: open ? 0.45 : 0.1, widthRatio: 0.4 },
      };
    }, 0, 6000, interval);
    expect(bursts).toHaveLength(0);
    expect(tracker.state).toBe('smile');
  });
  it('does not join longer low-jaw gaps just because brief low-jaw jitter is tolerated', () => {
    const tracker = new ExpressionTracker();
    expect(feed(tracker, now => ({
      smile: 0.62, jaw: now % 600 < 350 ? 0.5 : 0.16, cheek: 0.2,
    }), 0, 6000)).toHaveLength(0);
  });
  it('does not mistake jaw opening alone for laughter', () => {
    const tracker = new ExpressionTracker();
    expect(feed(tracker, { smile: 0.05, jaw: 0.95, cheek: 0.2 }, 0, 4000)).toHaveLength(0);
    expect(tracker.state).toBe('neutral');
  });
  it('rejects a single-frame smile spike', () => {
    const tracker = new ExpressionTracker();
    tracker.update(laugh, 0);
    feed(tracker, neutral, 50);
    expect(tracker.state).toBe('neutral');
  });
  it.each([0, 0.5, 1])('keeps negative poses safe at sensitivity %s', sensitivity => {
    const tracker = new ExpressionTracker();
    tracker.setSensitivity(sensitivity);
    const negatives: Array<FaceMetrics | ((now: number) => FaceMetrics)> = [
      neutral,
      smilingGeometry,
      { smile: 0.08, jaw: 0.95, cheek: 0.3, mouth: { openRatio: 0.8, widthRatio: 0.29 } },
      now => ({ smile: 0.12, jaw: now % 500 < 300 ? 0.6 : 0.1, cheek: 0.04 }),
      now => ({ smile: 0.6, jaw: now % 600 < 350 ? 0.5 : 0.1, cheek: 0.12 }),
    ];
    for (const metrics of negatives) {
      tracker.resetSession();
      expect(feed(tracker, metrics, 0, 4000)).toHaveLength(0);
      expect(tracker.state).not.toBe('laugh');
    }
  });
  it('rejects a narrowed yawn after a smile even with borderline smile coefficients', () => {
    const tracker = new ExpressionTracker();
    tracker.calibrate(restingGeometry);
    feed(tracker, smilingGeometry);
    expect(feed(tracker, {
      smile: 0.35, jaw: 0.95, cheek: 0.01, mouth: { openRatio: 0.8, widthRatio: 0.27 },
    }, 1000, 2000)).toHaveLength(0);
    expect(tracker.state).not.toBe('laugh');
  });
  it('limits sustained laughter to one burst per 1200 ms', () => {
    const tracker = new ExpressionTracker();
    const bursts = feed(tracker, laugh, 0, 6000);
    expect(bursts.length).toBeGreaterThan(2);
    for (let i = 1; i < bursts.length; i++) expect(bursts[i]! - bursts[i - 1]!).toBeGreaterThanOrEqual(1200);
  });
  it('preserves cooldown across tracking resets and calibration', () => {
    const tracker = new ExpressionTracker();
    const bursts = feed(tracker, laugh);
    tracker.reset();
    bursts.push(...feed(tracker, laugh, 1000));
    tracker.calibrate(neutral);
    bursts.push(...feed(tracker, laugh, 2000, 2000));
    expect(bursts.length).toBeGreaterThan(1);
    for (let i = 1; i < bursts.length; i++) expect(bursts[i]! - bursts[i - 1]!).toBeGreaterThanOrEqual(1200);
  });
  it('starts a new cooldown and clock only for a new session', () => {
    const tracker = new ExpressionTracker();
    const first = feed(tracker, laugh);
    tracker.resetSession();
    expect(feed(tracker, laugh)).toEqual(first);
  });
  it('does not count missing frames toward entry dwell', () => {
    const tracker = new ExpressionTracker();
    expect(feed(tracker, laugh, 0, 400)).toHaveLength(0);
    const result = tracker.update(laugh, 3000);
    expect(result.state).not.toBe('laugh');
    expect(result.burst).toBe(false);
    expect(result.diagnostics.laughProgress).toBe(0);
    expect(feed(tracker, laugh, 3050)).toHaveLength(1);
  });
  it('does not accumulate evidence from repeated timestamps', () => {
    const tracker = new ExpressionTracker();
    for (let i = 0; i < 100; i++) expect(tracker.update(laugh, 0).burst).toBe(false);
    expect(tracker.diagnostics.laughProgress).toBe(0);
    expect(tracker.state).toBe('neutral');
  });
  it.each([100, 50, 1000 / 30])('holds an accepted short laugh for 650ms at %s ms/frame', interval => {
    const tracker = new ExpressionTracker();
    const accepted = acceptLaugh(tracker, 0, interval);
    expect(accepted.result.burst).toBe(true);
    let releasedAt: number | null = null;
    for (let frame = 1; frame * interval <= 1000; frame++) {
      const now = accepted.now + frame * interval;
      const result = tracker.update(neutral, now);
      expect(result.burst).toBe(false);
      if (now - accepted.now < 650) {
        expect(result.state).toBe('laugh');
        expect(result.diagnostics.reason).toContain('保留展示');
      } else if (result.state !== 'laugh') {
        releasedAt = now;
        break;
      }
    }
    expect(releasedAt).not.toBeNull();
    expect(releasedAt! - accepted.now).toBeGreaterThanOrEqual(650);
    expect(releasedAt! - accepted.now).toBeLessThan(650 + interval + 1e-6);
    expect(tracker.state).toBe('neutral');
  });
  it('returns to a closed smile when the minimum display hold ends', () => {
    const tracker = new ExpressionTracker();
    const accepted = acceptLaugh(tracker);
    expect(feed(tracker, smile, accepted.now + 50, 650)).toHaveLength(0);
    expect(tracker.state).toBe('smile');
    expect(tracker.diagnostics.laughProgress).toBe(0);
  });
  it('does not fire without positive evidence when cooldown expires inside a display hold', () => {
    const tracker = new ExpressionTracker();
    const first = acceptLaugh(tracker);
    tracker.reset();
    const second = acceptLaugh(tracker, first.now + 300);
    expect(second.result.burst).toBe(false);
    const due = first.now + 1200;
    expect(due - second.now).toBeGreaterThan(0);
    expect(due - second.now).toBeLessThan(650);
    for (let offset = 50; offset < 650; offset += 50) {
      const result = tracker.update(neutral, second.now + offset);
      expect(result.state).toBe('laugh');
      expect(result.burst).toBe(false);
    }
    expect(tracker.diagnostics.laughProgress).toBe(0);
    expect(tracker.update(neutral, second.now + 650).state).toBe('neutral');
  });
  it('cancels the minimum display hold immediately when tracking is reset', () => {
    const tracker = new ExpressionTracker();
    const accepted = acceptLaugh(tracker);
    tracker.reset();
    expect(tracker.state).toBe('neutral');
    expect(tracker.diagnostics.laughProgress).toBe(0);
    const result = tracker.update(neutral, accepted.now + 50);
    expect(result.state).toBe('neutral');
    expect(result.burst).toBe(false);
  });
  it('does not preserve a display hold across an expired observation gap', () => {
    const tracker = new ExpressionTracker();
    const accepted = acceptLaugh(tracker);
    const result = tracker.update(neutral, accepted.now + 300);
    expect(result.state).toBe('neutral');
    expect(result.burst).toBe(false);
    expect(result.diagnostics.laughProgress).toBe(0);
  });
  it('never starts a display hold for unconfirmed speech pulses', () => {
    const tracker = new ExpressionTracker();
    for (let now = 0; now < 4000; now += 50) {
      const result = tracker.update({ smile: 0.6, jaw: now % 600 < 350 ? 0.5 : 0.1, cheek: 0.12 }, now);
      expect(result.state).not.toBe('laugh');
      expect(result.burst).toBe(false);
    }
  });
  it('keeps laughter through a short interruption but not a sustained release', () => {
    const tracker = new ExpressionTracker();
    feed(tracker, laugh);
    feed(tracker, neutral, 1000, 100);
    expect(tracker.state).toBe('laugh');
    feed(tracker, laugh, 1100, 400);
    expect(tracker.state).toBe('laugh');
    feed(tracker, smile, 1500, 600);
    expect(tracker.state).toBe('smile');
  });
  it('does not emit a due burst while release hysteresis is keeping an unsupported state', () => {
    const tracker = new ExpressionTracker();
    const bursts = feed(tracker, laugh, 0, 1000);
    const due = bursts[0]! + 1200;
    feed(tracker, laugh, 1000, due - 1000);
    const result = tracker.update(neutral, due);
    expect(result.state).toBe('laugh');
    expect(result.burst).toBe(false);
    expect(result.diagnostics.laughProgress).toBeLessThan(1);
  });
  it('releases to neutral rather than sticking after laughter', () => {
    const tracker = new ExpressionTracker();
    feed(tracker, laugh);
    feed(tracker, neutral, 1000);
    expect(tracker.state).toBe('neutral');
  });
  it('does not flutter around the smile onset threshold', () => {
    const tracker = new ExpressionTracker();
    for (let t = 0; t < 1500; t += 50) tracker.update({ smile: t % 100 ? 0.32 : 0.35, jaw: 0, cheek: 0 }, t);
    expect(tracker.state).toBe('neutral');
  });
  it('has comparable entry timing at 10 Hz and 30 Hz', () => {
    const entries: number[] = [];
    for (const interval of [100, 1000 / 30]) {
      const tracker = new ExpressionTracker();
      const bursts = feed(tracker, laugh, 0, 1000, interval);
      expect(bursts).toHaveLength(1);
      entries.push(bursts[0]!);
      expect(tracker.state).toBe('laugh');
    }
    expect(Math.abs(entries[0]! - entries[1]!)).toBeLessThanOrEqual(100);
  });
  it('uses calibration without allowing a resting mouth to trigger', () => {
    const tracker = new ExpressionTracker();
    const baseline = { smile: 0.2, jaw: 0.12, cheek: 0.05 };
    tracker.calibrate(baseline);
    feed(tracker, baseline);
    expect(tracker.state).toBe('neutral');
    feed(tracker, laugh, 1000);
    expect(tracker.state).toBe('laugh');
  });
  it('does not unnecessarily make a modest open-mouth smile unreachable after neutral calibration', () => {
    const tracker = new ExpressionTracker();
    tracker.calibrate({ smile: 0.2, jaw: 0.12, cheek: 0.05 });
    expect(feed(tracker, { smile: 0.56, jaw: 0.26, cheek: 0.12 }, 0, 2000).length).toBeGreaterThan(0);
    expect(tracker.state).toBe('laugh');
  });
  it('learns a useful bounded laugh reference and clears it when the neutral baseline changes', () => {
    const tracker = new ExpressionTracker();
    const reference: FaceMetrics = { smile: 0.4, jaw: 0.2, cheek: 0.02, mouth: { openRatio: 0.15, widthRatio: 0.38 } };
    tracker.calibrate(restingGeometry);
    expect(feed(tracker, reference)).toHaveLength(0);
    tracker.calibrateLaugh(reference);
    expect(feed(tracker, reference, 1000)).toHaveLength(1);
    tracker.calibrate(restingGeometry);
    expect(feed(tracker, reference, 2000)).toHaveLength(0);
  });
  it.each([
    neutral,
    smile,
    { smile: 0.1, jaw: 0.9, cheek: 0.3 },
    { ...laugh, mouth: { openRatio: 0.02, widthRatio: 0.43 } },
  ])('rejects a non-discriminative laugh reference: %j', reference => {
    const tracker = new ExpressionTracker();
    tracker.calibrate(restingGeometry);
    expect(() => tracker.calibrateLaugh(reference)).toThrow(/参考不够明显/);
  });
  it('copies calibration geometry instead of retaining caller-owned objects', () => {
    const tracker = new ExpressionTracker();
    const baseline = { ...neutral, mouth: { openRatio: 0.02, widthRatio: 0.32 } };
    tracker.calibrate(baseline);
    baseline.mouth.openRatio = 0.9;
    expect(feed(tracker, { ...laugh, mouth: { openRatio: 0.3, widthRatio: 0.43 } })).toHaveLength(1);
  });
  it('rejects a reference below the current conservative sensitivity bounds', () => {
    const tracker = new ExpressionTracker();
    tracker.setSensitivity(0);
    expect(() => tracker.calibrateLaugh({ smile: 0.38, jaw: 0.18, cheek: 0.02 })).toThrow(/参考不够明显/);
  });
  it('does not erase a useful reference after an invalid calibration attempt', () => {
    const tracker = new ExpressionTracker();
    const reference = { smile: 0.4, jaw: 0.2, cheek: 0.02 };
    tracker.calibrateLaugh(reference);
    expect(() => tracker.calibrateLaugh(neutral)).toThrow();
    expect(feed(tracker, reference)).toHaveLength(1);
  });
  it('provides a bounded sensitivity adjustment without changing the default implicitly', () => {
    const metrics = { smile: 0.46, jaw: 0.25, cheek: 0.01 };
    const tracker = new ExpressionTracker();
    expect(feed(tracker, metrics, 0, 2000)).toHaveLength(0);
    tracker.setSensitivity(1);
    expect(feed(tracker, metrics, 2000, 2000).length).toBeGreaterThan(0);
    tracker.setSensitivity(0);
    expect(feed(tracker, metrics, 4000, 2000)).toHaveLength(0);
  });
  it.each([NaN, Infinity, -0.1, 1.1])('rejects invalid sensitivity %s', value => {
    expect(() => new ExpressionTracker().setSensitivity(value)).toThrow(/Sensitivity/);
  });
  it('exposes immutable evidence progress rather than a jaw percentage', () => {
    const tracker = new ExpressionTracker();
    feed(tracker, laugh, 0, 300);
    const snapshot = tracker.diagnostics;
    expect(snapshot.laughProgress).toBeGreaterThan(0);
    expect(snapshot.laughProgress).toBeLessThan(1);
    expect(snapshot.reason.length).toBeGreaterThan(0);
    expect(Object.isFrozen(snapshot)).toBe(true);
    feed(tracker, laugh, 300);
    expect(tracker.diagnostics.laughProgress).toBe(1);
    expect(snapshot.laughProgress).toBeLessThan(1);
    tracker.reset();
    expect(tracker.diagnostics.laughProgress).toBe(0);
  });
  it('clears smoothed cues when tracking is lost', () => {
    const tracker = new ExpressionTracker();
    feed(tracker, laugh);
    tracker.reset();
    expect(tracker.state).toBe('neutral');
    expect(tracker.smooth.smile).toBe(0);
    expect(tracker.smooth.mouth).toBeNull();
  });
  it('explicitly rejects invalid model values and non-monotonic time', () => {
    const tracker = new ExpressionTracker();
    expect(() => tracker.update({ ...neutral, smile: NaN }, 0)).toThrow();
    expect(() => tracker.update({ ...neutral, jaw: 1.2 }, 0)).toThrow();
    tracker.update(neutral, 100);
    expect(() => tracker.update(neutral, 99)).toThrow(/monotonic/);
  });
  it.each([
    { openRatio: NaN, widthRatio: 0.4 },
    { openRatio: -0.1, widthRatio: 0.4 },
    { openRatio: 0.2, widthRatio: Infinity },
    { openRatio: 0.2, widthRatio: 0 },
  ])('rejects invalid geometry: %j', mouth => {
    expect(() => new ExpressionTracker().update({ ...neutral, mouth }, 0)).toThrow(/Mouth geometry/);
  });
  it('accepts ratios above one because geometry is not a blendshape coefficient', () => {
    const tracker = new ExpressionTracker();
    expect(() => tracker.update({ ...neutral, mouth: { openRatio: 1.2, widthRatio: 1.1 } }, 0)).not.toThrow();
  });
});
