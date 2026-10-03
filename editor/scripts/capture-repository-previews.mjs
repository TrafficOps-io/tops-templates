// Capture local rendered demo pages as repository thumbnails. Build the repository first, then rebuild after capture.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const source = resolve(process.argv[2] || 'repositories/demo');
const output = resolve(process.argv[3] || 'editor/public/template-repositories/demo');
const metadata = JSON.parse(await readFile(`${source}/repository.json`, 'utf8'));
const index = JSON.parse(await readFile(`${output}/index.json`, 'utf8'));
const browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  for (const entry of metadata.templates) {
    const published = index.templates.find(item => item.id === entry.id);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(entry.id) || !published) throw new Error('Rebuild the repository before capturing thumbnails.');
    const preview = resolve(output, published.preview);
    if (!preview.startsWith(output + '/')) throw new Error('Preview must be inside the repository output folder.');
    await page.goto(pathToFileURL(preview).href);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    entry.thumbnail = `${entry.id}.png`;
    await page.screenshot({ path: `${source}/${entry.thumbnail}` });
    console.log(`Captured ${entry.name}`);
  }
  await writeFile(`${source}/repository.json`, JSON.stringify(metadata, null, 2) + '\n');
} finally { await browser.close(); }
