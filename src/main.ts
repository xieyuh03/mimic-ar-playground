import './style.css';
import { ExpressionTracker } from './core/expression';
import type { Expression } from './core/expression';
import { headEllipse } from './core/geometry';
import type { Ellipse } from './core/geometry';
import { ParticleEngine } from './core/particles';
import { PerformanceBudget } from './core/performance';
import type { FaceMetrics, VisionRequest, VisionResponse } from './protocol';

function element<T extends HTMLElement>(id: string, type: { new(): T }): T {
  const result = document.getElementById(id);
  if (!(result instanceof type)) throw new Error(`Missing UI element: ${id}`);
  return result;
}

const stage = element('stage', HTMLDivElement);
const canvas = element('effects', HTMLCanvasElement);
const video = element('camera', HTMLVideoElement);
const context = canvas.getContext('2d', { alpha: true });
if (!context) throw new Error('This browser does not support Canvas 2D');
const ctx = context;
const cameraButton = element('camera-button', HTMLButtonElement);
const calibrateButton = element('calibrate-button', HTMLButtonElement);
const reducedMotion = element('reduced-motion', HTMLInputElement);
const showCollider = element('show-collider', HTMLInputElement);
const ui = {
  welcome: element('welcome', HTMLDivElement),
  loading: element('loading-overlay', HTMLDivElement),
  badge: element('mode-badge', HTMLSpanElement),
  cameraLabel: element('camera-button-label', HTMLSpanElement),
  status: element('status-message', HTMLDivElement),
  error: element('error-message', HTMLDivElement),
  state: element('state-title', HTMLElement),
  stateLabel: element('state-label', HTMLElement),
  weather: element('weather-icon', HTMLSpanElement),
  pill: element('expression-pill', HTMLDivElement),
  tracking: element('tracking-label', HTMLSpanElement),
  signal: element('signal-status', HTMLSpanElement),
  smileValue: element('smile-value', HTMLOutputElement),
  jawValue: element('jaw-value', HTMLOutputElement),
  smileMeter: element('smile-meter', HTMLSpanElement),
  jawMeter: element('jaw-meter', HTMLSpanElement),
  fps: element('fps-value', HTMLOutputElement),
  particles: element('particles-value', HTMLOutputElement),
  cap: element('particle-cap', HTMLSpanElement),
  inference: element('inference-value', HTMLOutputElement),
  collisions: element('collisions-value', HTMLOutputElement),
  quality: element('quality-label', HTMLSpanElement),
  calibration: element('calibration-label', HTMLSpanElement),
  caption: element('stage-caption', HTMLSpanElement),
};

type Mode = 'idle' | 'loading' | 'camera' | 'demo' | 'error';
let mode: Mode = 'idle';
let width = 1;
let height = 1;
let dpr = 1;
let session = 0;
let stream: MediaStream | null = null;
let worker: Worker | null = null;
let modelReady = false;
let inFlight = false;
let submittedAt = 0;
let lastInference = -Infinity;
let lastVideoTime = -1;
let inferenceMs = 0;
let lastFaceAt = -Infinity;
let targetHead: Ellipse | null = null;
let head: Ellipse | null = null;
let expression: Expression = 'neutral';
let autoCalibrated = false;
let calibrating = false;
let calibrationStarted = 0;
let calibrationSamples = 0;
const calibrationSum: FaceMetrics = { smile: 0, jaw: 0, cheek: 0 };
let lastDemoBurst = -Infinity;
let lastFrame = performance.now();
let accumulator = 0;
let lastHud = 0;
let fps = 0;
let frameCount = 0;
let frameWindow = performance.now();
let frameCostMs = 0;
let maxInFlight = 0;
let pendingFrames = 0;
let totalInferenceFrames = 0;
const frameCosts = new Float32Array(180);
let frameCostCount = 0;
let frameCostCursor = 0;
const tracker = new ExpressionTracker();
const engine = new ParticleEngine();
const budget = new PerformanceBudget();
const STEP = 1 / 120;
const FACE_TTL_MS = 400;
const reducedPreference = matchMedia('(prefers-reduced-motion: reduce)');
reducedMotion.checked = reducedPreference.matches;
engine.reducedMotion = reducedMotion.checked;

function setMode(next: Mode): void {
  mode = next;
  stage.dataset.mode = mode;
  ui.welcome.hidden = mode === 'camera' || mode === 'demo' || mode === 'loading';
  ui.loading.hidden = mode !== 'loading';
  ui.cameraLabel.textContent = mode === 'camera' ? '停止摄像头' : mode === 'loading' ? '取消连接' : '开启摄像头';
  const badge = mode === 'camera' ? 'LIVE · 本地识别' : mode === 'demo' ? '演示模式 · 非摄像头' : mode === 'loading' ? '正在连接' : '等待开启';
  ui.badge.replaceChildren();
  ui.badge.append(document.createElement('i'), document.createTextNode(badge));
  calibrateButton.disabled = mode !== 'camera';
  ui.caption.textContent = mode === 'demo' ? '演示模式 · 拖动虚拟头像观察碰撞' : '不录制 · 不上传 · 无需登录';
}

function setExpression(next: Expression): void {
  expression = next;
  ui.pill.dataset.expression = next;
  ui.weather.textContent = next === 'laugh' ? '✳' : next === 'smile' ? '〰' : '○';
  ui.state.textContent = next === 'laugh' ? '你的笑容，正在发光' : next === 'smile' ? '一场只属于你的雨' : '等你一个笑容';
  ui.stateLabel.textContent = next === 'laugh' ? 'LAUGHTER → FIREWORKS' : next === 'smile' ? 'SMILE → RAIN' : 'READY WHEN YOU ARE';
}

function resize(): void {
  const box = stage.getBoundingClientRect();
  const nextWidth = Math.max(1, box.width);
  const nextHeight = Math.max(1, box.height);
  const nextDpr = Math.min(devicePixelRatio || 1, budget.dprCap);
  const sizeChanged = width !== nextWidth || height !== nextHeight;
  if (!sizeChanged && dpr === nextDpr) return;
  width = nextWidth;
  height = nextHeight;
  dpr = nextDpr;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (sizeChanged) {
    engine.clear();
    head = targetHead = null;
    if (mode === 'demo') makeDemoHead();
  }
}

function releaseMedia(): void {
  session++;
  worker?.terminate();
  worker = null;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.pause();
  video.srcObject = null;
  modelReady = inFlight = false;
  pendingFrames = 0;
  maxInFlight = 0;
  totalInferenceFrames = 0;
  lastInference = -Infinity;
  lastVideoTime = -1;
  lastFaceAt = -Infinity;
  inferenceMs = 0;
  targetHead = head = null;
  calibrating = false;
  autoCalibrated = false;
  tracker.calibrate({ smile: 0, jaw: 0, cheek: 0 });
  setExpression('neutral');
  engine.clear();
}

function stopCamera(): void {
  releaseMedia();
  setMode('idle');
  ui.error.hidden = true;
  ui.status.textContent = '摄像头已关闭，媒体轨道已释放。';
  ui.tracking.textContent = '摄像头尚未开启';
  ui.calibration.textContent = '使用默认阈值';
}

function fail(message: string): void {
  console.error(`[MIMIC] ${message}`);
  releaseMedia();
  setMode('error');
  ui.error.textContent = message;
  ui.error.hidden = false;
  ui.status.textContent = '未启动识别。修复问题后可重试，也可单独使用演示模式。';
  ui.tracking.textContent = '连接未完成';
}

function explainCameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return '摄像头权限被拒绝。请在浏览器地址栏允许摄像头后重试；微信等内置浏览器可改用系统浏览器打开。';
    if (error.name === 'NotFoundError') return '未找到摄像头。请连接摄像头或在有前置摄像头的手机上打开。';
    if (error.name === 'NotReadableError') return '摄像头无法读取，可能正被其他应用占用。关闭占用应用后重试。';
  }
  return error instanceof Error ? error.message : String(error);
}

function loadVision(currentSession: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const base = new URL(import.meta.env.BASE_URL, document.baseURI);
    const instance = new Worker(new URL('vision-worker.js', base));
    worker = instance;
    let initializing = true;
    const timeout = setTimeout(() => {
      if (session !== currentSession) return;
      reject(new Error('本地模型加载超过 45 秒。请检查网络或换用新版 Chrome / Safari。'));
    }, 45_000);
    instance.onerror = event => {
      clearTimeout(timeout);
      if (session !== currentSession) return;
      const message = `推理 Worker 启动失败：${event.message || '浏览器不支持所需能力'}`;
      if (initializing) reject(new Error(message));
      else fail(message);
    };
    instance.onmessage = (event: MessageEvent<VisionResponse>) => {
      if (session !== currentSession) return;
      const message = event.data;
      if (message.type === 'ready') {
        clearTimeout(timeout);
        initializing = false;
        modelReady = true;
        resolve();
      } else if (message.type === 'error') {
        clearTimeout(timeout);
        if (initializing) reject(new Error(message.message));
        else fail(message.message);
      } else handleResult(message);
    };
    const message: VisionRequest = {
      type: 'init',
      wasmRoot: new URL('vendor/wasm', base).href,
      modelUrl: new URL('models/face_landmarker.task', base).href,
    };
    instance.postMessage(message);
  });
}

async function startCamera(): Promise<void> {
  releaseMedia();
  ui.error.hidden = true;
  if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    fail('浏览器需要 HTTPS（或 localhost）才能使用摄像头。请使用正式在线链接。');
    return;
  }
  if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') {
    fail('当前浏览器缺少 Worker 或 ImageBitmap 支持，请升级浏览器。');
    return;
  }
  const currentSession = session;
  setMode('loading');
  ui.status.textContent = '请允许摄像头。人脸推理全部在设备本地进行，模型也从本站加载。';
  try {
    const cameraReady = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
    }).then(async media => {
      if (session !== currentSession) {
        media.getTracks().forEach(track => track.stop());
        throw new DOMException('Cancelled', 'AbortError');
      }
      stream = media;
      for (const track of media.getVideoTracks()) {
        track.onended = () => { if (session === currentSession) fail('摄像头连接已中断，请重新开启。'); };
      }
      video.srcObject = media;
      await video.play();
    });
    await cameraReady;
    if (session !== currentSession) return;
    ui.status.textContent = '摄像头已授权，正在加载本地模型。首次需获取约 15 MB 原始模型与推理资源，后续可使用浏览器缓存。';
    await loadVision(currentSession);
    if (session !== currentSession) return;
    setMode('camera');
    ui.status.textContent = '模型已就绪。请单人正对镜头，放松表情，准备自动校准。';
    ui.tracking.textContent = '正在寻找人脸';
  } catch (error) {
    if (session === currentSession) fail(explainCameraError(error));
  }
}

function startCalibration(): void {
  if (mode !== 'camera') return;
  calibrating = true;
  autoCalibrated = true;
  calibrationStarted = performance.now();
  calibrationSamples = 0;
  calibrationSum.smile = calibrationSum.jaw = calibrationSum.cheek = 0;
  tracker.reset();
  setExpression('neutral');
  ui.calibration.textContent = '请保持自然表情';
  ui.status.textContent = '校准中：放松嘴角，轻合嘴唇，正对镜头约 2 秒。';
}

function collectCalibration(metrics: FaceMetrics): void {
  if (metrics.smile > 0.3 || metrics.jaw > 0.22) {
    calibrationSamples = 0;
    calibrationSum.smile = calibrationSum.jaw = calibrationSum.cheek = 0;
    ui.calibration.textContent = '请先收起笑容并合嘴';
    return;
  }
  calibrationSum.smile += metrics.smile;
  calibrationSum.jaw += metrics.jaw;
  calibrationSum.cheek += metrics.cheek;
  calibrationSamples++;
  ui.calibration.textContent = `校准 ${Math.round(calibrationSamples / 24 * 100)}%`;
  if (calibrationSamples >= 24) {
    tracker.calibrate({
      smile: calibrationSum.smile / calibrationSamples,
      jaw: calibrationSum.jaw / calibrationSamples,
      cheek: calibrationSum.cheek / calibrationSamples,
    });
    calibrating = false;
    ui.calibration.textContent = '个人基线已校准';
    ui.status.textContent = '校准完成。微笑会下雨；保持微笑并张大嘴会触发烟花。试着左右移动头部。';
  }
}

function handleResult(message: Extract<VisionResponse, { type: 'result' }>): void {
  inFlight = false;
  pendingFrames--;
  inferenceMs = message.inferenceMs;
  totalInferenceFrames++;
  if (mode !== 'camera' || document.hidden) return;
  if (performance.now() - message.timestamp > FACE_TTL_MS) {
    targetHead = head = null;
    tracker.reset();
    setExpression('neutral');
    ui.tracking.textContent = '识别延迟较高，请使用性能更好的设备';
    return;
  }
  if (message.faces !== 1 || !message.metrics || !message.points) {
    targetHead = head = null;
    tracker.reset();
    setExpression('neutral');
    ui.tracking.textContent = message.faces > 1 ? '请只保留一张人脸' : '未检测到人脸';
    if (calibrating) {
      calibrationSamples = 0;
      calibrationSum.smile = calibrationSum.jaw = calibrationSum.cheek = 0;
    }
    return;
  }
  lastFaceAt = message.timestamp;
  targetHead = headEllipse(message.points, video.videoWidth, video.videoHeight, width, height, true);
  head ??= { ...targetHead };
  ui.tracking.textContent = calibrating ? '自然表情校准中' : '已锁定单人头部';
  if (!autoCalibrated) startCalibration();
  if (calibrating) { collectCalibration(message.metrics); return; }
  const result = tracker.update(message.metrics, message.timestamp);
  setExpression(result.state);
  if (result.burst) firework();
}

async function captureFrame(now: number): Promise<void> {
  const currentSession = session;
  inFlight = true;
  pendingFrames++;
  submittedAt = now;
  lastInference = now;
  lastVideoTime = video.currentTime;
  maxInFlight = Math.max(maxInFlight, pendingFrames);
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(video, {
      resizeWidth: 480,
      resizeHeight: Math.max(1, Math.round(480 * video.videoHeight / video.videoWidth)),
      resizeQuality: 'low',
    });
    if (session !== currentSession || !worker || mode !== 'camera' || document.hidden) {
      bitmap.close();
      if (session === currentSession) { inFlight = false; pendingFrames--; }
      return;
    }
    const message: VisionRequest = { type: 'frame', bitmap, timestamp: now };
    worker.postMessage(message, [bitmap]);
  } catch (error) {
    bitmap?.close();
    if (session === currentSession) fail(`视频帧读取失败：${explainCameraError(error)}`);
  }
}

function makeDemoHead(): void {
  targetHead = {
    x: width * 0.5, y: height * 0.63,
    rx: Math.min(75, width * 0.17), ry: Math.min(94, width * 0.21),
    angle: -0.08, vx: 0, vy: 0,
  };
  head = { ...targetHead };
}

function startDemo(effect: 'smile' | 'laugh'): void {
  if (mode !== 'demo') {
    releaseMedia();
    setMode('demo');
    makeDemoHead();
  }
  ui.error.hidden = true;
  setExpression(effect);
  ui.status.textContent = '当前是手动演示，并未识别人脸。拖动画面中的虚拟头像，观察烟花粒子反弹。';
  ui.tracking.textContent = '拖动头像 · 观察反弹';
  ui.calibration.textContent = '演示模式不使用校准';
  if (effect === 'laugh') { firework(); lastDemoBurst = performance.now(); }
}

function firework(): void {
  const center = head ?? { x: width * 0.5, y: height * 0.62, ry: height * 0.15 };
  engine.burst(center.x + (Math.random() - 0.5) * width * 0.25, Math.max(90, center.y - center.ry - 100));
}

function advanceHead(dt: number): void {
  if (!targetHead || !head) return;
  const alpha = 1 - Math.exp(-dt / 0.055);
  const x = head.x;
  const y = head.y;
  head.x += (targetHead.x - head.x) * alpha;
  head.y += (targetHead.y - head.y) * alpha;
  head.rx += (targetHead.rx - head.rx) * alpha;
  head.ry += (targetHead.ry - head.ry) * alpha;
  let angle = targetHead.angle - head.angle;
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle < -Math.PI / 2) angle += Math.PI;
  head.angle += angle * alpha;
  head.vx = Math.max(-900, Math.min(900, (head.x - x) / dt));
  head.vy = Math.max(-900, Math.min(900, (head.y - y) / dt));
}

function drawHead(): void {
  if (!head || (mode !== 'demo' && !showCollider.checked)) return;
  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.rotate(head.angle);
  ctx.beginPath();
  ctx.ellipse(0, 0, head.rx, head.ry, 0, 0, Math.PI * 2);
  if (mode === 'demo') {
    ctx.fillStyle = '#c8d5a0';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#f5ffd7';
    ctx.stroke();
    ctx.fillStyle = '#323c31';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * head.rx * 0.32, -head.ry * 0.17, 4.5, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(0, head.ry * 0.15, head.rx * 0.34, head.ry * 0.22, 0, 0, Math.PI);
    ctx.strokeStyle = '#323c31';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  if (showCollider.checked) {
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#bdf4ec';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, head.rx + 3, head.ry + 3, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function updateHud(now: number): void {
  if (now - lastHud < 200) return;
  lastHud = now;
  const smile = mode === 'demo' ? expression === 'neutral' ? 0 : 78 : tracker.smooth.smile * 100;
  const jaw = mode === 'demo' ? expression === 'laugh' ? 65 : 8 : tracker.smooth.jaw * 100;
  ui.smileValue.value = `${Math.round(smile)}%`;
  ui.jawValue.value = `${Math.round(jaw)}%`;
  ui.smileMeter.style.width = `${smile}%`;
  ui.jawMeter.style.width = `${jaw}%`;
  ui.fps.value = fps ? String(Math.round(fps)) : '—';
  ui.particles.value = String(engine.count);
  ui.cap.textContent = String(engine.cap);
  ui.inference.value = mode === 'camera' && totalInferenceFrames ? inferenceMs.toFixed(1) : '—';
  ui.collisions.value = String(engine.collisions);
  ui.quality.textContent = budget.quality === 'economy' ? '节能档 · 自动降级' : '自动画质';
  ui.signal.textContent = mode === 'demo' ? '手动演示值' : mode === 'camera' && head ? '实时信号' : '未连接';
  stage.dataset.particles = String(engine.count);
  stage.dataset.collisions = String(engine.collisions);
  stage.dataset.inferenceFrames = String(totalInferenceFrames);
  stage.dataset.maxInFlight = String(maxInFlight);
  stage.dataset.frameCostMs = frameCostMs.toFixed(3);
  if (frameCostCount) {
    const sorted = Array.from(frameCosts.subarray(0, frameCostCount)).sort((a, b) => a - b);
    stage.dataset.frameCostP95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!.toFixed(3);
  }
  stage.dataset.quality = budget.quality;
  stage.dataset.modelReady = String(modelReady);
}

function render(now: number): void {
  requestAnimationFrame(render);
  if (document.hidden) { lastFrame = now; return; }
  const start = performance.now();
  const elapsed = Math.min(1 / 30, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  accumulator = Math.min(accumulator + elapsed, 4 * STEP);
  frameCount++;
  if (now - frameWindow >= 1000) {
    fps = frameCount * 1000 / (now - frameWindow);
    frameCount = 0;
    frameWindow = now;
    const previousQuality = budget.quality;
    budget.update(fps, now);
    if (budget.quality !== previousQuality) { engine.setCap(budget.particleCap); resize(); }
  }
  if (mode === 'camera') {
    if (calibrating && now - calibrationStarted > 8000) {
      calibrating = false;
      ui.calibration.textContent = '校准未完成，可手动重试';
      ui.status.textContent = '未采集到足够连续的自然表情，继续使用原有阈值；请正对镜头后点击重新校准。';
    }
    if (now - lastFaceAt > FACE_TTL_MS && head) {
      head = targetHead = null;
      tracker.reset();
      setExpression('neutral');
      ui.tracking.textContent = '跟踪已过期，等待新的人脸';
    }
    if (inFlight && now - submittedAt > 4000) fail('单帧推理超过 4 秒，已停止摄像头和计算。请关闭其他高负载页面后重试。');
    if (mode === 'camera' && modelReady && !inFlight && video.readyState >= 2 &&
        video.videoWidth > 0 && video.currentTime !== lastVideoTime &&
        now - lastInference >= budget.inferenceInterval(inferenceMs)) void captureFrame(now);
  } else if (mode === 'demo' && expression === 'laugh' && now - lastDemoBurst >= 1500) {
    firework();
    lastDemoBurst = now;
  }
  while (accumulator >= STEP) {
    advanceHead(STEP);
    engine.step(STEP, width, height, expression === 'smile', head);
    accumulator -= STEP;
  }
  ctx.clearRect(0, 0, width, height);
  drawHead();
  engine.draw(ctx);
  updateHud(now);
  frameCostMs = performance.now() - start;
  frameCosts[frameCostCursor] = frameCostMs;
  frameCostCursor = (frameCostCursor + 1) % frameCosts.length;
  frameCostCount = Math.min(frameCosts.length, frameCostCount + 1);
}

let dragging = false;
stage.addEventListener('pointerdown', event => {
  if (mode !== 'demo') return;
  dragging = true;
  stage.setPointerCapture(event.pointerId);
  moveDemoHead(event);
});
stage.addEventListener('pointermove', event => { if (dragging) moveDemoHead(event); });
stage.addEventListener('pointerup', () => { dragging = false; });
stage.addEventListener('pointercancel', () => { dragging = false; });
function moveDemoHead(event: PointerEvent): void {
  if (mode !== 'demo' || !targetHead) return;
  const box = stage.getBoundingClientRect();
  targetHead.x = Math.max(targetHead.rx, Math.min(width - targetHead.rx, event.clientX - box.left));
  targetHead.y = Math.max(targetHead.ry + 60, Math.min(height - targetHead.ry - 60, event.clientY - box.top));
}

cameraButton.addEventListener('click', () => {
  if (mode === 'camera' || mode === 'loading') stopCamera();
  else void startCamera();
});
calibrateButton.addEventListener('click', startCalibration);
element('demo-rain', HTMLButtonElement).addEventListener('click', () => startDemo('smile'));
element('demo-fireworks', HTMLButtonElement).addEventListener('click', () => startDemo('laugh'));
reducedMotion.addEventListener('change', () => { engine.reducedMotion = reducedMotion.checked; });
document.addEventListener('visibilitychange', () => {
  accumulator = 0;
  lastFrame = frameWindow = performance.now();
  frameCount = 0;
  if (document.hidden) {
    stream?.getVideoTracks().forEach(track => { track.enabled = false; });
    targetHead = head = null;
    tracker.reset();
    if (mode === 'camera') setExpression('neutral');
    engine.clear();
  } else {
    stream?.getVideoTracks().forEach(track => { track.enabled = true; });
    if (mode === 'demo') makeDemoHead();
  }
});
window.addEventListener('pagehide', stopCamera);
new ResizeObserver(resize).observe(stage);
resize();
requestAnimationFrame(render);
