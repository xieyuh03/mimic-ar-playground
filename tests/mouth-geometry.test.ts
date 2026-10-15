import { describe, expect, it } from 'vitest';
import { mouthGeometry } from '../src/core/mouth-geometry';
import type { Point } from '../src/protocol';

function face(width: number, height: number, angle = 0): Point[] {
  const points: Point[] = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5 }));
  const assign = (index: number, x: number, y: number) => {
    points[index] = {
      x: (width / 2 + x * Math.cos(angle) - y * Math.sin(angle)) / width,
      y: (height / 2 + x * Math.sin(angle) + y * Math.cos(angle)) / height,
    };
  };
  assign(61, -50, 0);
  assign(291, 50, 0);
  assign(13, 0, -15);
  assign(14, 0, 15);
  assign(234, -100, 0);
  assign(454, 100, 0);
  return points;
}

describe('mouth geometry independent of viewport shape', () => {
  it.each([[640, 480], [480, 640], [1920, 1080]])('uses pixel distances in %ix%i frames', (width, height) => {
    const result = mouthGeometry(face(width, height), width, height);
    expect(result?.openRatio).toBeCloseTo(0.3);
    expect(result?.widthRatio).toBeCloseTo(0.5);
  });
  it('is invariant to face roll', () => {
    const result = mouthGeometry(face(640, 480, Math.PI / 4), 640, 480);
    expect(result?.openRatio).toBeCloseTo(0.3);
    expect(result?.widthRatio).toBeCloseTo(0.5);
  });
  it('uses perpendicular lip opening instead of along-mouth displacement', () => {
    const points = face(640, 480);
    points[14]!.x += 0.1;
    expect(mouthGeometry(points, 640, 480)?.openRatio).toBeCloseTo(0.3);
  });
  it('reports unavailable geometry rather than a pretend zero', () => {
    expect(mouthGeometry([], 640, 480)).toBeNull();
    expect(mouthGeometry(face(640, 480), 0, 480)).toBeNull();
    const points = face(640, 480);
    points[61] = points[291]!;
    expect(mouthGeometry(points, 640, 480)).toBeNull();
    points[61] = { x: NaN, y: 0 };
    expect(mouthGeometry(points, 640, 480)).toBeNull();
  });
});
