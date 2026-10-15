import type { MouthGeometry, Point } from '../protocol';

export function mouthGeometry(points: readonly Point[], width: number, height: number): MouthGeometry | null {
  const left = points[61];
  const right = points[291];
  const top = points[13];
  const bottom = points[14];
  const cheekLeft = points[234];
  const cheekRight = points[454];
  if (!left || !right || !top || !bottom || !cheekLeft || !cheekRight ||
      !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const ux = (right.x - left.x) * width;
  const uy = (right.y - left.y) * height;
  const vx = (bottom.x - top.x) * width;
  const vy = (bottom.y - top.y) * height;
  const mouthWidthSquared = ux * ux + uy * uy;
  const faceWidth = Math.hypot((cheekRight.x - cheekLeft.x) * width, (cheekRight.y - cheekLeft.y) * height);
  if (mouthWidthSquared < 1 || faceWidth < 1) return null;
  const openRatio = Math.abs(vx * uy - vy * ux) / mouthWidthSquared;
  const widthRatio = Math.sqrt(mouthWidthSquared) / faceWidth;
  if (!Number.isFinite(openRatio) || !Number.isFinite(widthRatio)) return null;
  return { openRatio, widthRatio };
}
