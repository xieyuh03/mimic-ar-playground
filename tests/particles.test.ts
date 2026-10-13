import { describe, expect, it } from 'vitest';
import { MAX_PARTICLES, ParticleEngine } from '../src/core/particles';
import { PerformanceBudget } from '../src/core/performance';

describe('bounded particle pool', () => {
  it('never exceeds 720 particles under repeated bursts', () => {
    const engine = new ParticleEngine();
    for (let i = 0; i < 100; i++) engine.burst(200, 100);
    expect(engine.count).toBe(MAX_PARTICLES);
  });
  it('enforces a lower adaptive cap on already live particles', () => {
    const engine = new ParticleEngine();
    engine.burst(200, 100, 720);
    engine.setCap(360);
    engine.burst(200, 100);
    expect(engine.count).toBe(360);
    expect(Array.from(engine.life).filter(value => value > 0)).toHaveLength(360);
  });
  it('eventually releases every particle', () => {
    const engine = new ParticleEngine();
    engine.burst(200, 100);
    for (let i = 0; i < 500; i++) engine.step(1 / 120, 500, 700, false, null);
    expect(engine.count).toBe(0);
  });
  it('caps reduced-motion bursts', () => {
    const engine = new ParticleEngine();
    engine.reducedMotion = true;
    engine.burst(200, 100);
    expect(engine.count).toBe(50);
  });
  it('bounds rain without creating per-frame object lists', () => {
    const engine = new ParticleEngine();
    for (let i = 0; i < 2000; i++) engine.step(1 / 120, 500, 700, true, null);
    expect(engine.count).toBeGreaterThan(20);
    expect(engine.count).toBeLessThanOrEqual(720);
    expect(engine.x).toBeInstanceOf(Float32Array);
  });
  it('changes a spark velocity on head contact', () => {
    const engine = new ParticleEngine();
    engine.burst(200, 100, 1);
    engine.vx[0] = 0;
    engine.vy[0] = 500;
    const head = { x: 200, y: 180, rx: 40, ry: 50, angle: 0, vx: 0, vy: 0 };
    for (let i = 0; i < 10; i++) engine.step(1 / 120, 500, 700, false, head);
    expect(engine.collisions).toBeGreaterThan(0);
    expect(engine.vy[0]).toBeLessThan(0);
  });
  it('clears state and rejects unsafe time steps', () => {
    const engine = new ParticleEngine();
    engine.burst(100, 100);
    engine.clear();
    expect(engine.count).toBe(0);
    expect(engine.collisions).toBe(0);
    expect(() => engine.step(0.5, 500, 700, false, null)).toThrow();
    expect(() => engine.setCap(721)).toThrow();
  });
});

describe('adaptive quality hysteresis', () => {
  it('does not downgrade for one slow frame', () => {
    const budget = new PerformanceBudget();
    expect(budget.update(20, 0)).toBe('balanced');
    expect(budget.update(60, 1000)).toBe('balanced');
  });
  it('downgrades after sustained slow rendering and recovers slowly', () => {
    const budget = new PerformanceBudget();
    budget.update(30, 0);
    expect(budget.update(30, 2000)).toBe('economy');
    expect(budget.particleCap).toBe(360);
    expect(budget.dprCap).toBe(1);
    budget.update(60, 3000);
    expect(budget.update(60, 10000)).toBe('economy');
    expect(budget.update(60, 11000)).toBe('balanced');
  });
  it('never schedules inference faster than its backpressure budget', () => {
    const budget = new PerformanceBudget();
    expect(budget.inferenceInterval(100)).toBe(150);
    expect(budget.inferenceInterval(10)).toBe(80);
  });
});
