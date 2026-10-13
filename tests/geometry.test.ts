import { describe, expect, it } from 'vitest';
import { coverPoint, headEllipse, isInside, sweepEllipse } from '../src/core/geometry';
import type { Collision, Ellipse } from '../src/core/geometry';

const head: Ellipse = { x: 0, y: 0, rx: 30, ry: 50, angle: 0, vx: 0, vy: 0 };
const output = (): Collision => ({ x: 0, y: 0, vx: 0, vy: 0 });

describe('mirrored cover coordinates', () => {
  it('keeps the center centered in portrait crop', () => {
    expect(coverPoint({ x: 0.5, y: 0.5 }, 640, 480, 300, 600, true)).toEqual({ x: 150, y: 300 });
  });
  it('accounts for both horizontal crop and reflection', () => {
    expect(coverPoint({ x: 0.25, y: 0.5 }, 640, 480, 300, 600, true).x).toBe(350);
    expect(coverPoint({ x: 0.25, y: 0.5 }, 640, 480, 300, 600, false).x).toBe(-50);
  });
  it('rejects zero dimensions rather than producing NaN geometry', () => {
    expect(() => coverPoint({ x: 0, y: 0 }, 0, 480, 300, 600, true)).toThrow();
  });
  it('derives a stable ellipse from rotated facial anchors', () => {
    const result = headEllipse({
      top: { x: 0.5, y: 0.2 }, chin: { x: 0.5, y: 0.8 },
      left: { x: 0.3, y: 0.45 }, right: { x: 0.7, y: 0.55 },
    }, 640, 480, 640, 480, true);
    expect(result.x).toBe(320);
    expect(result.rx).toBeGreaterThan(100);
    expect(Math.abs(result.angle)).toBeLessThan(Math.PI / 2);
  });
});

describe('continuous moving-head collision', () => {
  it('catches a fast particle even when both endpoints are outside', () => {
    const result = output();
    expect(sweepEllipse(0, -100, 0, 100, 0, 1000, head, 1 / 120, 2, result)).toBe(true);
    expect(result.vy).toBeLessThan(0);
    expect(isInside(result.x, result.y, head, 2)).toBe(false);
  });
  it('does not collide with a segment that misses the head', () => {
    expect(sweepEllipse(40, -100, 40, 100, 0, 1000, head, 1 / 120, 2, output())).toBe(false);
  });
  it('resolves a particle spawned inside without NaN', () => {
    const result = output();
    expect(sweepEllipse(0, 0, 0, 0, 0, 0, head, 1 / 120, 2, result)).toBe(true);
    expect(Object.values(result).every(Number.isFinite)).toBe(true);
    expect(isInside(result.x, result.y, head, 2)).toBe(false);
  });
  it('transfers momentum from a moving head to a stationary particle', () => {
    const moving = { ...head, rx: 10, ry: 15, vx: 600 };
    const result = output();
    expect(sweepEllipse(8, 0, 8, 0, 0, 0, moving, 1 / 60, 1, result)).toBe(true);
    expect(result.vx).toBeGreaterThan(0);
    expect(Math.hypot(result.vx, result.vy)).toBeLessThanOrEqual(1200);
  });
  it('respects rotation and non-circular normals', () => {
    const rotated = { ...head, angle: Math.PI / 2 };
    const result = output();
    expect(sweepEllipse(-100, 0, 100, 0, 1000, 0, rotated, 1 / 120, 2, result)).toBe(true);
    expect(result.vx).toBeLessThan(0);
    expect(isInside(result.x, result.y, rotated, 2)).toBe(false);
  });
  it('does not inject energy into outward-moving particles', () => {
    const result = output();
    sweepEllipse(0, -40, 0, -55, 0, -100, head, 1 / 120, 2, result);
    expect(result.vy).toBe(-100);
  });
});
