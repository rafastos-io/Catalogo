// Render HTML → JPG via Puppeteer local (Chrome instalado no Ubuntu runner).
// Substitui lib/templates/screenshot.ts do MarketCenter (que usa Browserless.io).

import puppeteer, { type Browser, type Page } from 'puppeteer-core';

export interface ScreenshotOptions {
  width: number;
  height: number;
}

// Caminhos do Chrome/Chromium em ambientes suportados
function findChromePath(): string {
  // GitHub Actions Ubuntu (chrome-stable via apt)
  const ghRunner = '/usr/bin/google-chrome';
  // Outros ambientes Linux
  const linuxCommon = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable'];
  // Windows (desenvolvimento local)
  const winPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  // GH Actions/Ubuntu
  for (const p of [ghRunner, ...linuxCommon]) {
    try {
      const fs = require('fs');
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  // Windows
  for (const p of winPaths) {
    try {
      const fs = require('fs');
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }

  // Fallback: tenta via npx @puppeteer/browsers install (não resolve path)
  throw new Error(
    'Chrome/Chromium não encontrado. No GitHub Actions, instale com:\n' +
    '  - name: Install Chrome\n' +
    '    run: sudo apt-get install -y google-chrome-stable\n\n' +
    'Localmente, instale Chrome e ajuste findChromePath() se necessário.',
  );
}

let _browser: Browser | null = null;

/** Inicia um browser compartilhado (reaproveita entre renders). */
export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.connected) return _browser;

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH ?? findChromePath();
  _browser = await puppeteer.launch({
    executablePath,
    headless: true,
    protocolTimeout: 60_000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // importante no GH Actions (shm limitado)
      '--disable-gpu',
      '--font-render-hinting=none',
      '--hide-scrollbars',
      '--mute-audio',
      `--window-size=1080,1920`,
    ],
  });
  return _browser;
}

/** Fecha o browser compartilhado (chamar no fim do processo). */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

/** Renderiza HTML → JPG Buffer (quality 85). Reaproveita browser, abre nova page cada chamada. */
export async function screenshotHtml(html: string, opts: ScreenshotOptions): Promise<Buffer> {
  const browser = await getBrowser();
  const page: Page = await browser.newPage();

  try {
    await page.setViewport({
      width: opts.width,
      height: opts.height,
      deviceScaleFactor: 1,
    });
    await page.setContent(html, {
      waitUntil: 'networkidle0', // espera fonts e imagens carregarem
      timeout: 45_000,
    });
    // Dá um tempinho pra fonts Google carregarem após networkidle
    await page.evaluate(() => {
      return (document as any).fonts?.ready ?? Promise.resolve();
    });
    const buf = await page.screenshot({
      type: 'jpeg',
      quality: 85,
      clip: { x: 0, y: 0, width: opts.width, height: opts.height },
      omitBackground: false,
    });
    return Buffer.from(buf);
  } finally {
    await page.close();
  }
}

/**
 * Renderiza N HTMLs em paralelo (com concorrência limitada).
 * Reaproveita o mesmo browser (múltiplas pages concorrentes).
 *
 * @param items  Array de { html, opts }
 * @param concurrency  Número de renders paralelos (10 é bom pra Ubuntu runner)
 * @param onResult  Callback opcional pra acompanhar progresso por item
 */
export async function screenshotBatch<T>(
  items: Array<T & { html: string; opts: ScreenshotOptions }>,
  concurrency: number,
  onResult?: (item: T, index: number, png: Buffer | null, error: Error | null) => void | Promise<void>,
): Promise<Array<{ index: number; png: Buffer | null; error: Error | null }>> {
  const results: Array<{ index: number; png: Buffer | null; error: Error | null }> = [];
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      const item = items[i];
      try {
        const png = await screenshotHtml(item.html, item.opts);
        results[i] = { index: i, png, error: null };
        await onResult?.(item as T, i, png, null);
      } catch (err) {
        results[i] = { index: i, png: null, error: err instanceof Error ? err : new Error(String(err)) };
        await onResult?.(item as T, i, null, err instanceof Error ? err : new Error(String(err)));
      }
      completed++;
      if (completed % 50 === 0 || completed === items.length) {
        console.info(`[screenshot] ${completed}/${items.length} renders concluídos`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
