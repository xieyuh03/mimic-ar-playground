import './style.css';
import { ExpressionTracker } from './core/expression';
import type { Expression } from './core/expression';
import { headEllipse } from './core/geometry';
import type { Ellipse } from './core/geometry';
import { ParticleEngine } from './core/particles';
import { PerformanceBudget } from './core/performance';
import { CalibrationSampler } from './core/calibration';
import type { CalibrationMode } from './core/calibration';
import type { FaceMetrics, VisionRequest, VisionResponse } from './protocol';

declare const __VISION_WORKER_REVISION__: string;

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
const learnLaughButton = element('learn-laugh-button', HTMLButtonElement);
const sensitivityInput = element('laugh-sensitivity', HTMLInputElement);
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
  diagnostic: element('expression-diagnostic', HTMLParagraphElement),
  rawSignals: element('raw-signals', HTMLDivElement),
  sensitivity: element('sensitivity-value', HTMLOutputElement),
  stopDemo: element('stop-demo', HTMLButtonElement),
  fps: element('fps-value', HTMLOutputElement),
  particles: element('particles-value', HTMLOutputElement),
  cap: element('particle-cap', HTMLSpanElement),
  inference: element('inference-value', HTMLOutputElement),
  collisions: element('collisions-value', HTMLOutputElement),
  quality: element('quality-label', HTMLSpanElement),
  calibration: element('calibration-label', HTMLParagraphElement),
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
let cancelVisionLoad: (() => void) | null = null;
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
let calibration: CalibrationSampler | null = null;
let lastMetrics: FaceMetrics | null = null;
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
let burstRequests = 0;
let lastBurstRequest = -Infinity;
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
engine.setCap(reducedMotion.checked ? 180 : budget.particleCap);

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
  learnLaughButton.disabled = mode !== 'camera';
  ui.stopDemo.hidden = mode !== 'demo';
  ui.caption.textContent = mode === 'demo' ? '演示模式 · 拖动虚拟头像观察碰撞' : '不录制 · 不上传 · 无需登录';
}

function setExpression(next: Expression): void {
  engine.setWeather(next === 'laugh' ? 'fireworks' : next === 'smile' ? 'rain' : 'clear', width, height);
  stage.dataset.expression = next;
  if (expression === next) return;
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
  const nextDpr = Math.min(devicePixelRatio || 1, budget.dprCap, Math.sqrt(2_500_000 / (nextWidth * nextHeight)));
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
    engine.setWeather(expression === 'laugh' ? 'fireworks' : expression === 'smile' ? 'rain' : 'clear', width, height);
  }
}

function releaseMedia(): void {
  session++;
  cancelVisionLoad?.();
  cancelVisionLoad = null;
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
  burstRequests = 0;
  lastBurstRequest = -Infinity;
  lastInference = -Infinity;
  lastVideoTime = -1;
  lastFaceAt = -Infinity;
  inferenceMs = 0;
  targetHead = head = null;
  calibration = null;
  lastMetrics = null;
  autoCalibrated = false;
  tracker.resetSession();
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
    const workerUrl = new URL('vision-worker.js', base);
    workerUrl.searchParams.set('rev', __VISION_WORKER_REVISION__);
    const instance = new Worker(workerUrl);
    worker = instance;
    let initializing = true;
    const complete = (): void => {
      clearTimeout(timeout);
      cancelVisionLoad = null;
    };
    const timeout = setTimeout(() => {
      if (session !== currentSession) return;
      complete();
      reject(new Error('本地模型加载超过 45 秒。请检查网络或换用新版 Chrome / Safari。'));
    }, 45_000);
    cancelVisionLoad = () => {
      clearTimeout(timeout);
      reject(new DOMException('模型加载已取消', 'AbortError'));
    };
    instance.onerror = event => {
      complete();
      if (session !== currentSession) return;
      const message = `推理 Worker 启动失败：${event.message || '浏览器不支持所需能力'}`;
      if (initializing) reject(new Error(message));
      else fail(message);
    };
    instance.onmessageerror = () => {
      complete();
      if (session !== currentSession) return;
      if (initializing) reject(new Error('模型线程返回了无法读取的数据'));
      else fail('模型线程返回了无法读取的数据，已停止摄像头。');
    };
    instance.onmessage = (event: MessageEvent<VisionResponse>) => {
      if (session !== currentSession) return;
      const message = event.data;
      if (message.type === 'ready') {
        complete();
        initializing = false;
        modelReady = true;
        resolve();
      } else if (message.type === 'error') {
        complete();
        if (initializing) reject(new Error(message.message));
        else fail(message.message);
      } else {
        try { handleResult(message); }
        catch (error) { fail(`识别数据无效：${error instanceof Error ? error.message : String(error)}`); }
      }
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

function beginCalibration(kind: CalibrationMode): void {
  if (mode !== 'camera') return;
  calibration = new CalibrationSampler(kind, performance.now());
  autoCalibrated = true;
  tracker.reset();
  setExpression('neutral');
  ui.calibration.textContent = kind === 'neutral' ? '请保持自然表情' : '请保持自然的大笑口型';
  ui.status.textContent = kind === 'neutral'
    ? '基线校准：放松嘴角、轻合嘴唇，连续保持约 2 秒。中断后会重新计时。'
    : '大笑学习：微笑并自然张嘴，连续保持约 1.5 秒。只在本次会话使用，不保存人脸或系数。';
}

function collectCalibration(metrics: FaceMetrics): void {
  if (!calibration) return;
  const result = calibration.update(metrics, performance.now());
  if (result.status === 'waiting') {
    ui.calibration.textContent = calibration.mode === 'neutral' ? '先收起笑容并轻合嘴唇' : '请微笑并自然张嘴';
  } else if (result.status === 'collecting') {
    ui.calibration.textContent = `连续采样 ${Math.round(result.progress * 100)}%`;
  } else if (result.status === 'complete') {
    const kind = calibration.mode;
    try {
      if (kind === 'neutral') tracker.calibrate(result.reference);
      else tracker.calibrateLaugh(result.reference);
      ui.calibration.textContent = kind === 'neutral' ? '自然基线已校准' : '你的大笑参考已学习';
      ui.status.textContent = kind === 'neutral'
        ? '校准完成。微笑下雨，大笑优先切换烟花；如果难触发，可点击“学习我的大笑”或调高灵敏度。'
        : '已学习本次会话的大笑参考。恢复自然表情后再笑一笑，观察“大笑准备”进度。';
    } catch (error) {
      console.warn('[MIMIC] Rejected calibration reference:', error);
      ui.calibration.textContent = '参考未通过，未修改识别阈值';
      ui.status.textContent = `校准未完成：${error instanceof Error ? error.message : String(error)}`;
    }
    calibration = null;
  } else finishCalibrationTimeout();
}

function finishCalibrationTimeout(): void {
  calibration = null;
  ui.calibration.textContent = '校准未完成，可手动重试';
  ui.status.textContent = '未采集到足够连续的合格表情，继续使用原有阈值；请正对镜头后重新校准。';
}

function handleResult(message: Extract<VisionResponse, { type: 'result' }>): void {
  inFlight = false;
  pendingFrames--;
  inferenceMs = message.inferenceMs;
  totalInferenceFrames++;
  if (mode !== 'camera' || document.hidden) return;
  if (performance.now() - message.timestamp > FACE_TTL_MS) {
    calibration?.interrupt();
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
    calibration?.interrupt();
    lastMetrics = null;
    return;
  }
  lastFaceAt = message.timestamp;
  lastMetrics = message.metrics;
  targetHead = headEllipse(message.points, video.videoWidth, video.videoHeight, width, height, true);
  head ??= { ...targetHead };
  ui.tracking.textContent = calibration ? '表情校准中，暂不播放特效' : '已锁定单人头部';
  if (!autoCalibrated) beginCalibration('neutral');
  if (calibration) { collectCalibration(message.metrics); return; }
  const result = tracker.update(message.metrics, message.timestamp);
  setExpression(result.state);
  if (result.burst) firework(message.timestamp);
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
  if (effect === 'laugh') { firework(performance.now()); lastDemoBurst = performance.now(); }
}

function firework(now: number): void {
  const cooldown = reducedMotion.checked ? 2400 : 1200;
  if (now - lastBurstRequest < cooldown) return;
  lastBurstRequest = now;
  burstRequests++;
  engine.launchShow(width, height, head);
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
  const metrics = calibration ? lastMetrics : tracker.smooth;
  const smile = mode === 'demo' ? expression === 'neutral' ? 0 : 78 : (metrics?.smile ?? 0) * 100;
  const jaw = mode === 'demo' ? expression === 'laugh' ? 100 : 0 : calibration ? 0 : tracker.diagnostics.laughProgress * 100;
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
  ui.signal.textContent = mode === 'demo' ? '手动演示值' : calibration ? '采样中 · 特效暂停' : mode === 'camera' && head ? '实时信号' : '未连接';
  ui.diagnostic.textContent = mode === 'demo' ? '这是手动演示，不是摄像头识别结果。' :
    calibration ? '校准期间只采集参考，不把当前表情当作触发信号。' :
      mode === 'camera' && head ? tracker.diagnostics.reason : '等待单人入镜。大笑优先，雨幕与烟花互斥。';
  ui.rawSignals.textContent = mode === 'camera' && metrics
    ? `张嘴系数 ${metrics.jaw.toFixed(2)} · 嘴部开度 ${metrics.mouth ? metrics.mouth.openRatio.toFixed(2) : '几何不可用，使用系数'}`
    : '开度是嘴唇间距 / 嘴宽，不是情绪概率。';
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
  stage.dataset.rainParticles = String(engine.rainCount);
  stage.dataset.sparkParticles = String(engine.sparkCount);
  stage.dataset.rockets = String(engine.rocketCount);
  stage.dataset.pendingShells = String(engine.pendingShells);
  stage.dataset.bursts = String(engine.bursts);
  stage.dataset.burstRequests = String(burstRequests);
  stage.dataset.calibrating = calibration?.mode ?? 'none';
  stage.dataset.openingSource = tracker.diagnostics.openingSource;
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
    if (budget.quality !== previousQuality) {
      engine.setCap(reducedMotion.checked ? 180 : budget.particleCap);
      resize();
    }
  }
  if (mode === 'camera') {
    if (calibration && now - calibration.startedAt > 10000) finishCalibrationTimeout();
    if (now - lastFaceAt > FACE_TTL_MS && head) {
      head = targetHead = null;
      tracker.reset();
      calibration?.interrupt();
      lastMetrics = null;
      setExpression('neutral');
      ui.tracking.textContent = '跟踪已过期，等待新的人脸';
    }
    if (inFlight && now - submittedAt > 4000) fail('单帧推理超过 4 秒，已停止摄像头和计算。请关闭其他高负载页面后重试。');
    if (mode === 'camera' && modelReady && !inFlight && video.readyState >= 2 &&
        video.videoWidth > 0 && video.currentTime !== lastVideoTime &&
        now - lastInference >= budget.inferenceInterval(inferenceMs)) void captureFrame(now);
  } else if (mode === 'demo' && expression === 'laugh' && now - lastDemoBurst >= (reducedMotion.checked ? 2600 : 1900)) {
    firework(now);
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
calibrateButton.addEventListener('click', () => beginCalibration('neutral'));
learnLaughButton.addEventListener('click', () => beginCalibration('laugh'));
sensitivityInput.addEventListener('input', () => {
  tracker.setSensitivity(Number(sensitivityInput.value) / 100);
  ui.sensitivity.value = `${sensitivityInput.value}%`;
});
element('demo-rain', HTMLButtonElement).addEventListener('click', () => startDemo('smile'));
element('demo-fireworks', HTMLButtonElement).addEventListener('click', () => startDemo('laugh'));
ui.stopDemo.addEventListener('click', stopCamera);
element('fullscreen-button', HTMLButtonElement).addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (stage.requestFullscreen) await stage.requestFullscreen();
    else {
      stage.classList.toggle('expanded');
      resize();
    }
  } catch (error) {
    console.warn('[MIMIC] Cannot enter fullscreen:', error);
    ui.status.textContent = '浏览器不允许全屏，已保持当前画面；可旋转设备获得更大显示空间。';
  }
});
reducedMotion.addEventListener('change', () => {
  engine.reducedMotion = reducedMotion.checked;
  engine.clear();
  engine.setCap(reducedMotion.checked ? 180 : budget.particleCap);
  engine.setWeather(expression === 'laugh' ? 'fireworks' : expression === 'smile' ? 'rain' : 'clear', width, height);
  lastDemoBurst = performance.now();
});
document.addEventListener('visibilitychange', () => {
  accumulator = 0;
  lastFrame = frameWindow = performance.now();
  frameCount = 0;
  if (document.hidden) {
    stream?.getVideoTracks().forEach(track => { track.enabled = false; });
    targetHead = head = null;
    tracker.reset();
    calibration?.interrupt();
    lastMetrics = null;
    if (mode === 'camera') setExpression('neutral');
    engine.clear();
  } else {
    stream?.getVideoTracks().forEach(track => { track.enabled = true; });
    if (mode === 'demo') {
      makeDemoHead();
      engine.setWeather(expression === 'laugh' ? 'fireworks' : expression === 'smile' ? 'rain' : 'clear', width, height);
    }
  }
});
window.addEventListener('pagehide', stopCamera);
new ResizeObserver(resize).observe(stage);
resize();
requestAnimationFrame(render);
