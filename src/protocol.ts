export interface Point {
  x: number;
  y: number;
}

export interface FaceMetrics {
  smile: number;
  jaw: number;
  cheek: number;
}

export interface HeadPoints {
  top: Point;
  chin: Point;
  left: Point;
  right: Point;
}

export type VisionRequest =
  | { type: 'init'; wasmRoot: string; modelUrl: string }
  | { type: 'frame'; bitmap: ImageBitmap; timestamp: number };

export type VisionResponse =
  | { type: 'ready' }
  | {
      type: 'result';
      timestamp: number;
      inferenceMs: number;
      faces: number;
      metrics: FaceMetrics | null;
      points: HeadPoints | null;
    }
  | { type: 'error'; message: string };
