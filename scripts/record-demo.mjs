#!/usr/bin/env node
// Short demo (20-40 s): drop three files, the verdict, the PDF leaks, a venue rule, camera-ready mode.
// Headless Playwright recordVideo against the live URL. No glides: each view is an instant jump, then a wait.
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const BASE = process.env.BASE_URL || 'https://voyager-from-space.github.io/blindsanitize/';
const FIX = root + 'test/fixtures/';
const OUT_DIR = process.env.OUT_DIR || '/tmp/blindsanitize-demo';
const FINAL = process.env.FINAL || '/workspace/anon-shipper/share/blindsanitize-launch-demo.webm';
const VIEW = { width: 1280, height: 720 };
rmSync(OUT_DIR, { recursive: true, force: true }); mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/google/chrome/chrome', args: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, recordVideo: { dir: OUT_DIR, size: VIEW }, reducedMotion: 'reduce' });
const page = await context.newPage();
const view = async (sel, pad, ms) => {
  await page.evaluate(([sel, pad]) => { const y = document.querySelector(sel).getBoundingClientRect().top + window.scrollY - pad; window.scrollTo({ top: y, behavior: 'instant' }); }, [sel, pad]);
  await page.waitForTimeout(500);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(ms);
};
await page.goto(BASE + '?cb=' + Date.now(), { waitUntil: 'networkidle', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1800);                                        // the start screen: one drop zone
await page.evaluate(() => document.getElementById('drop').classList.add('over'));
await page.waitForTimeout(500);
await page.setInputFiles('#file', ['sample-source.zip', 'sample-paper.pdf', 'sample-supplementary.zip'].map((f) => FIX + f));
await page.evaluate(() => document.getElementById('drop').classList.remove('over'));
await page.waitForSelector('#results:not([hidden]) .cell', { timeout: 60000 });
await page.waitForTimeout(800);
await page.fill('#names', 'Ada Example'); await page.fill('#others', 'Acme Lab\nadaexample');
await page.waitForTimeout(1500);
await view('#results', 16, 3600);                                       // verdict, per-file counts, three cleaned downloads
await view('#findings h3[data-scope="pdf"]', 40, 4200);                 // what is still inside the PDF
await page.selectOption('#venue', 'rtas2026'); await page.waitForTimeout(900);
await view('#venue-rules', 60, 800);
await page.click('#venue-rules summary'); await page.waitForTimeout(500);
await view('#venue-rules', 60, 3800);                                   // the venue's own words, with links
await view('#drop', 16, 300);
await page.setInputFiles('#file', FIX + 'anon-source.zip');
await page.waitForTimeout(1200);
await page.check('#camera'); await page.waitForTimeout(1200);
await page.fill('#author-block', 'Ada Example \\and Bo Writer'); await page.fill('#ack', 'We thank the Acme Lab staff.');
await page.waitForTimeout(1500);
await view('#camera-panel', 60, 4200);                                  // camera-ready: put the real author block back
await context.close(); await browser.close();
const vid = readdirSync(OUT_DIR).find((f) => f.endsWith('.webm'));
renameSync(`${OUT_DIR}/${vid}`, FINAL);
console.log('saved ' + FINAL);
