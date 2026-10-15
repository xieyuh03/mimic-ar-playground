import type { Page } from '@playwright/test';

export async function installVisionFixture(page: Page, readyDelay = 0): Promise<void> {
  await page.addInitScript(({ readyDelay }) => {
    let seed = 92751;
    Math.random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    class FixtureWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      private terminated = false;
      private timer: ReturnType<typeof setTimeout> | null = null;
      postMessage(message: { type: string; bitmap?: ImageBitmap; timestamp?: number }): void {
        if (this.terminated) return;
        if (message.type === 'init') {
          this.timer = setTimeout(() => {
            if (!this.terminated) this.onmessage?.(new MessageEvent('message', { data: { type: 'ready' } }));
          }, readyDelay);
          return;
        }
        message.bitmap?.close();
        const preset = document.documentElement.dataset.fixture ?? 'neutral';
        const metrics = {
          neutral: { smile: 0.08, jaw: 0.05, cheek: 0.015, mouth: { openRatio: 0.035, widthRatio: 0.42 } },
          smile: { smile: 0.72, jaw: 0.06, cheek: 0.02, mouth: { openRatio: 0.055, widthRatio: 0.49 } },
          laugh: { smile: 0.48, jaw: 0.38, cheek: 0.025, mouth: { openRatio: 0.32, widthRatio: 0.51 } },
          lowJaw: { smile: 0.68, jaw: 0.12, cheek: 0.018, mouth: { openRatio: 0.34, widthRatio: 0.51 } },
          yawn: { smile: 0.055, jaw: 0.8, cheek: 0.02, mouth: { openRatio: 0.58, widthRatio: 0.38 } },
        };
        const faceCount = preset === 'missing' ? 0 : preset === 'multiple' ? 2 : 1;
        let current = metrics.neutral;
        if (preset === 'smile') current = metrics.smile;
        else if (preset === 'laugh') current = metrics.laugh;
        else if (preset === 'lowJaw') current = metrics.lowJaw;
        else if (preset === 'yawn') current = metrics.yawn;
        else if (preset === 'speech') {
          const open = performance.now() % 650 < 330;
          current = { smile: 0.58, jaw: open ? 0.5 : 0.08, cheek: 0.1, mouth: { openRatio: open ? 0.3 : 0.04, widthRatio: 0.48 } };
        }
        const x = Number(document.documentElement.dataset.faceX ?? '0.5');
        this.timer = setTimeout(() => {
          if (this.terminated) return;
          this.onmessage?.(new MessageEvent('message', {
            data: {
              type: 'result', timestamp: message.timestamp, inferenceMs: 14,
              faces: faceCount, metrics: faceCount === 1 ? current : null,
              points: faceCount === 1 ? {
                top: { x, y: 0.26 }, chin: { x, y: 0.78 },
                left: { x: x - 0.16, y: 0.5 }, right: { x: x + 0.16, y: 0.5 },
              } : null,
            },
          }));
        }, 14);
      }
      terminate(): void {
        this.terminated = true;
        if (this.timer !== null) clearTimeout(this.timer);
      }
    }
    Object.defineProperty(window, 'Worker', { configurable: true, value: FixtureWorker });
  }, { readyDelay });
}

export async function setFixture(page: Page, name: string): Promise<void> {
  await page.evaluate(preset => { document.documentElement.dataset.fixture = preset; }, name);
}
