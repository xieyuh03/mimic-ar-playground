import { describe, expect, it } from 'vitest';
import { CalibrationSampler } from '../src/core/calibration';
import type { CalibrationResult } from '../src/core/calibration';

const neutral = { smile: 0.1, jaw: 0.08, cheek: 0.04, mouth: { openRatio: 0.04, widthRatio: 0.42 } };
const laugh = { smile: 0.48, jaw: 0.18, cheek: 0.02, mouth: { openRatio: 0.34, widthRatio: 0.5 } };

describe('time-based personal calibration', () => {
  it('requires actual stable time, not just many quick samples', () => {
    const sampler = new CalibrationSampler('neutral', 0);
    let result: CalibrationResult = { status: 'waiting', progress: 0 };
    for (let now = 0; now < 100; now++) result = sampler.update(neutral, now);
    expect(result.status).toBe('collecting');
    for (let now = 100; now <= 1700; now += 100) result = sampler.update(neutral, now);
    expect(result.status).toBe('complete');
    if (result.status === 'complete') expect(result.reference.mouth?.openRatio).toBeCloseTo(0.04);
  });
  it('does not include time spent without a face', () => {
    const sampler = new CalibrationSampler('neutral', 0);
    for (let now = 0; now < 1400; now += 100) sampler.update(neutral, now);
    sampler.interrupt();
    expect(sampler.update(neutral, 1500).status).toBe('collecting');
    expect(sampler.update(neutral, 2500).status).toBe('collecting');
  });
  it('rejects laughter during neutral calibration', () => {
    const sampler = new CalibrationSampler('neutral', 0);
    expect(sampler.update(laugh, 0).status).toBe('waiting');
  });
  it('accepts low-cheek, low-jaw open smiles for personalized laugh reference', () => {
    const sampler = new CalibrationSampler('laugh', 0);
    let result: CalibrationResult = { status: 'waiting', progress: 0 };
    for (let now = 0; now <= 1300; now += 100) result = sampler.update(laugh, now);
    expect(result.status).toBe('complete');
  });
  it('does not teach pure jaw opening as laughter', () => {
    const sampler = new CalibrationSampler('laugh', 0);
    expect(sampler.update({ ...laugh, smile: 0.06, jaw: 0.8 }, 0).status).toBe('waiting');
  });
  it('reports an explicit timeout and invalid time', () => {
    const sampler = new CalibrationSampler('neutral', 0);
    expect(sampler.update(neutral, 10001).status).toBe('timeout');
    expect(() => sampler.update(neutral, -1)).toThrow();
  });
});
