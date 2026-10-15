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
    expect(engine.count).toBeLessThanOrEqual(50);
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
  it('clears every rain particle immediately when laughter wins', () => {
    const engine = new ParticleEngine();
    engine.setWeather('rain', 720, 700);
    for (let i = 0; i < 80; i++) engine.step(1 / 120, 720, 700, true, null);
    expect(engine.rainCount).toBeGreaterThan(50);
    engine.launchShow(720, 700, null);
    expect(engine.rainCount).toBe(0);
    expect(engine.weather).toBe('fireworks');
  });
  it('cancels rockets and queued shells on a return to rain', () => {
    const engine = new ParticleEngine();
    engine.launchShow(720, 700, null);
    engine.step(1 / 120, 720, 700, false, null);
    expect(engine.rocketCount).toBe(1);
    expect(engine.pendingShells).toBe(2);
    engine.setWeather('rain', 720, 700);
    expect(engine.rocketCount).toBe(0);
    expect(engine.pendingShells).toBe(0);
    expect(engine.sparkCount).toBe(0);
  });
  it('cannot detonate an airborne rocket after expression returns to neutral', () => {
    const engine = new ParticleEngine(() => 0.5);
    engine.launchShow(720, 700, null);
    for (let i = 0; i < 24; i++) engine.step(1 / 120, 720, 700, false, null);
    expect(engine.rocketCount).toBeGreaterThan(0);
    engine.setWeather('clear', 720, 700);
    for (let i = 0; i < 60; i++) engine.step(1 / 120, 720, 700, false, null);
    expect(engine.bursts).toBe(0);
    expect(engine.rocketCount).toBe(0);
    expect(engine.pendingShells).toBe(0);
    expect(engine.count).toBe(0);
  });
  it('gives slow fullscreen rain enough lifetime to reach the bottom', () => {
    const engine = new ParticleEngine(() => 0.1);
    engine.setWeather('rain', 3840, 2160);
    for (let i = 0; i < 720; i++) {
      if (engine.life[i]! <= 0 || engine.kind[i] !== 0) continue;
      const travelToBottom = (2160 - engine.y[i]!) / engine.vy[i]!;
      expect(engine.life[i]!).toBeGreaterThan(travelToBottom * 0.8);
    }
  });
  it('launches before exploding instead of an instant confetti ring', () => {
    const engine = new ParticleEngine(() => 0.5);
    engine.launchShow(720, 700, null);
    for (let i = 0; i < 20; i++) engine.step(1 / 120, 720, 700, false, null);
    expect(engine.launches).toBeGreaterThan(0);
    expect(engine.bursts).toBe(0);
    for (let i = 0; i < 100; i++) engine.step(1 / 120, 720, 700, false, null);
    expect(engine.bursts).toBe(3);
    expect(engine.sparkCount).toBeGreaterThan(200);
  });
  it('keeps scheduling and particle work bounded under repeated requests', () => {
    const engine = new ParticleEngine();
    for (let i = 0; i < 1000; i++) engine.launchShow(720, 700, null);
    expect(engine.pendingShells).toBeLessThanOrEqual(6);
    for (let i = 0; i < 1000; i++) {
      engine.step(1 / 120, 720, 700, false, null);
      expect(engine.count).toBeLessThanOrEqual(720);
      expect(engine.count).toBeGreaterThanOrEqual(0);
    }
    expect(engine.count).toBe(0);
  });
  it('uses one slower shell in reduced motion and respects an aggregate cap', () => {
    const engine = new ParticleEngine();
    engine.reducedMotion = true;
    engine.setCap(180);
    engine.launchShow(390, 520, null);
    expect(engine.pendingShells).toBe(1);
    for (let i = 0; i < 60; i++) engine.step(1 / 120, 390, 520, false, null);
    expect(engine.bursts).toBe(0);
    for (let i = 0; i < 60; i++) engine.step(1 / 120, 390, 520, false, null);
    expect(engine.bursts).toBe(1);
    expect(engine.count).toBeLessThanOrEqual(180);
  });
  it('retains total lifetime for terminal alpha fade', () => {
    const engine = new ParticleEngine(() => 0.5);
    engine.burst(300, 200, 20);
    const initial = engine.initialLife[0]!;
    engine.step(1 / 120, 800, 800, false, null);
    expect(engine.life[0]!).toBeLessThan(initial);
    expect(engine.initialLife[0]).toBe(initial);
  });
  it('keeps the complete numeric pool and trail history below 64 KiB', () => {
    const engine = new ParticleEngine();
    const bytes = Object.values(engine).reduce((sum, value) => sum + (ArrayBuffer.isView(value) ? value.byteLength : 0), 0);
    expect(bytes).toBeLessThanOrEqual(64 * 1024);
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
