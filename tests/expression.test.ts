import { describe, expect, it } from 'vitest';
import { ExpressionTracker } from '../src/core/expression';
import type { FaceMetrics } from '../src/protocol';

const neutral = { smile: 0.05, jaw: 0.04, cheek: 0.02 };
const smile = { smile: 0.8, jaw: 0.06, cheek: 0.25 };
const laugh = { smile: 0.85, jaw: 0.65, cheek: 0.3 };

function feed(tracker: ExpressionTracker, metrics: FaceMetrics, start = 0, duration = 1000, interval = 50) {
  const bursts: number[] = [];
  for (let now = start; now < start + duration; now += interval) {
    if (tracker.update(metrics, now).burst) bursts.push(now);
  }
  return bursts;
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
  it('combines smile, jaw and cheek cues for laughter', () => {
    const tracker = new ExpressionTracker();
    expect(feed(tracker, laugh).length).toBe(1);
    expect(tracker.state).toBe('laugh');
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
  it('limits sustained laughter to one burst per 1200 ms', () => {
    const tracker = new ExpressionTracker();
    const bursts = feed(tracker, laugh, 0, 6000);
    expect(bursts.length).toBeGreaterThan(2);
    for (let i = 1; i < bursts.length; i++) expect(bursts[i]! - bursts[i - 1]!).toBeGreaterThanOrEqual(1200);
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
  it('works at both 10 Hz and 30 Hz', () => {
    for (const interval of [100, 1000 / 30]) {
      const tracker = new ExpressionTracker();
      feed(tracker, laugh, 0, 1000, interval);
      expect(tracker.state).toBe('laugh');
    }
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
  it('clears smoothed cues when tracking is lost', () => {
    const tracker = new ExpressionTracker();
    feed(tracker, laugh);
    tracker.reset();
    expect(tracker.state).toBe('neutral');
    expect(tracker.smooth.smile).toBe(0);
  });
  it('explicitly rejects invalid model values and non-monotonic time', () => {
    const tracker = new ExpressionTracker();
    expect(() => tracker.update({ ...neutral, smile: NaN }, 0)).toThrow();
    expect(() => tracker.update({ ...neutral, jaw: 1.2 }, 0)).toThrow();
    tracker.update(neutral, 100);
    expect(() => tracker.update(neutral, 99)).toThrow(/monotonic/);
  });
});
