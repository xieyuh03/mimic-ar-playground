import type { HeadPoints, Point } from '../protocol';

export interface Ellipse {
  x: number;
  y: number;
  rx: number;
  ry: number;
  angle: number;
  vx: number;
  vy: number;
}

export interface Collision {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function coverPoint(point: Point, videoWidth: number, videoHeight: number, width: number, height: number, mirrored: boolean): Point {
  if ([videoWidth, videoHeight, width, height].some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Video and viewport dimensions must be positive');
  }
  const scale = Math.max(width / videoWidth, height / videoHeight);
  return {
    x: (mirrored ? 1 - point.x : point.x) * videoWidth * scale + (width - videoWidth * scale) / 2,
    y: point.y * videoHeight * scale + (height - videoHeight * scale) / 2,
  };
}

export function headEllipse(points: HeadPoints, videoWidth: number, videoHeight: number, width: number, height: number, mirrored: boolean): Ellipse {
  const map = (point: Point) => coverPoint(point, videoWidth, videoHeight, width, height, mirrored);
  const top = map(points.top);
  const chin = map(points.chin);
  const left = map(points.left);
  const right = map(points.right);
  let angle = Math.atan2(right.y - left.y, right.x - left.x);
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle < -Math.PI / 2) angle += Math.PI;
  return {
    x: (top.x + chin.x) / 2,
    y: (top.y + chin.y) / 2 - (chin.y - top.y) * 0.05,
    rx: Math.max(12, Math.hypot(right.x - left.x, right.y - left.y) * 0.57),
    ry: Math.max(16, Math.hypot(chin.x - top.x, chin.y - top.y) * 0.61),
    angle,
    vx: 0,
    vy: 0,
  };
}

export function isInside(x: number, y: number, head: Ellipse, padding = 0): boolean {
  const cos = Math.cos(head.angle);
  const sin = Math.sin(head.angle);
  const dx = x - head.x;
  const dy = y - head.y;
  return ((dx * cos + dy * sin) / (head.rx + padding)) ** 2 +
    ((-dx * sin + dy * cos) / (head.ry + padding)) ** 2 < 1;
}

export function sweepEllipse(
  x0: number, y0: number, x1: number, y1: number,
  vx: number, vy: number, head: Ellipse, dt: number, radius: number, out: Collision,
): boolean {
  const cos = Math.cos(head.angle);
  const sin = Math.sin(head.angle);
  const rx = head.rx + radius;
  const ry = head.ry + radius;
  const previousDx = x0 - head.x + head.vx * dt;
  const previousDy = y0 - head.y + head.vy * dt;
  const currentDx = x1 - head.x;
  const currentDy = y1 - head.y;
  const sx = (previousDx * cos + previousDy * sin) / rx;
  const sy = (-previousDx * sin + previousDy * cos) / ry;
  const ex = (currentDx * cos + currentDy * sin) / rx;
  const ey = (-currentDx * sin + currentDy * cos) / ry;
  const dx = ex - sx;
  const dy = ey - sy;
  const a = dx * dx + dy * dy;
  const b = 2 * (sx * dx + sy * dy);
  const c = sx * sx + sy * sy - 1;
  let time = 0;
  if (c > 0) {
    if (a < 1e-12) return false;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return false;
    time = (-b - Math.sqrt(discriminant)) / (2 * a);
    if (time < 0 || time > 1) return false;
  }
  let qx = sx + dx * time;
  let qy = sy + dy * time;
  const length = Math.hypot(qx, qy);
  if (length < 1e-8) { qx = 0; qy = -1; }
  else { qx /= length; qy /= length; }

  // The ellipse gradient, not its radial vector, is the surface normal.
  const localNx = qx / rx;
  const localNy = qy / ry;
  const normalLength = Math.hypot(localNx, localNy);
  const nx = (localNx * cos - localNy * sin) / normalLength;
  const ny = (localNx * sin + localNy * cos) / normalLength;
  const relativeX = vx - head.vx;
  const relativeY = vy - head.vy;
  const incoming = relativeX * nx + relativeY * ny;
  out.vx = incoming < 0 ? vx - 1.68 * incoming * nx : vx;
  out.vy = incoming < 0 ? vy - 1.68 * incoming * ny : vy;
  const speed = Math.hypot(out.vx, out.vy);
  if (speed > 1200) { out.vx *= 1200 / speed; out.vy *= 1200 / speed; }
  out.x = head.x + qx * rx * cos - qy * ry * sin + nx * 0.6;
  out.y = head.y + qx * rx * sin + qy * ry * cos + ny * 0.6;
  return true;
}
