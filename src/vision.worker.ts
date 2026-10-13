import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceMetrics, HeadPoints, VisionRequest, VisionResponse } from './protocol';

let detector: FaceLandmarker | null = null;
const send = (message: VisionResponse): void => self.postMessage(message);

self.onmessage = async (event: MessageEvent<VisionRequest>) => {
  const message = event.data;
  if (message.type === 'init') {
    try {
      const fileset = await FilesetResolver.forVisionTasks(message.wasmRoot);
      detector = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: message.modelUrl, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numFaces: 2,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
        minFaceDetectionConfidence: 0.6,
        minFacePresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
      send({ type: 'ready' });
    } catch (error) {
      send({ type: 'error', message: `人脸模型初始化失败：${error instanceof Error ? error.message : String(error)}` });
    }
    return;
  }

  try {
    if (!detector) throw new Error('模型尚未就绪');
    const start = performance.now();
    const result = detector.detectForVideo(message.bitmap, message.timestamp);
    const landmarks = result.faceLandmarks[0];
    let metrics: FaceMetrics | null = null;
    let points: HeadPoints | null = null;
    if (result.faceLandmarks.length === 1 && landmarks) {
      const categories = result.faceBlendshapes[0]?.categories;
      if (!categories) throw new Error('模型没有返回表情系数');
      const scores = new Map(categories.map(item => [item.categoryName, item.score]));
      const score = (name: string): number => {
        const value = scores.get(name);
        if (value === undefined || !Number.isFinite(value)) throw new Error(`缺少有效系数：${name}`);
        return value;
      };
      metrics = {
        smile: (score('mouthSmileLeft') + score('mouthSmileRight')) / 2,
        jaw: score('jawOpen'),
        cheek: (score('cheekSquintLeft') + score('cheekSquintRight')) / 2,
      };
      const point = (index: number) => {
        const item = landmarks[index];
        if (!item || !Number.isFinite(item.x) || !Number.isFinite(item.y)) throw new Error('头部关键点无效');
        return { x: item.x, y: item.y };
      };
      points = { top: point(10), chin: point(152), left: point(234), right: point(454) };
    }
    send({
      type: 'result',
      timestamp: message.timestamp,
      inferenceMs: performance.now() - start,
      faces: result.faceLandmarks.length,
      metrics,
      points,
    });
  } catch (error) {
    send({ type: 'error', message: `人脸推理失败：${error instanceof Error ? error.message : String(error)}` });
  } finally {
    message.bitmap.close();
  }
};
