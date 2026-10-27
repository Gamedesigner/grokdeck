// Exercise the real renderer with a fictional in-memory bridge. No account access.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:5181';
const output = path.join(os.tmpdir(), 'grokdeck-about-ui');
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5181', '--strictPort'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
let serverError = '';
server.stderr.on('data', data => { serverError += data; });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw Error(`About fixture server exited: ${serverError.trim()}`);
    try { ready = (await fetch(origin)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw Error('About fixture server did not start.');
  await mkdir(output, { recursive: true });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.addInitScript(() => {
    const now = Date.now();
    const agents = [{ id: 'sample', name: 'Idea partner', section: 'Creative studio', sectionId: 'studio', preview: 'A little room for your next idea.', description: 'Fictional test agent', color: '#b4a2ff', pinned: true, hasUnread: false, unreadCount: 0, awaitingResponse: false, lastActivityAt: now, cachedAt: now, messages: [] }];
    const sections = [{ id: 'studio', name: 'Creative studio', agentIds: ['sample'] }];
    const source = { kind: 'live-gateway', available: true, checkedAt: now, cacheUpdatedAt: now, version: '0.75.8', path: 'Fictional fixture', warning: null };
    let prefs = { checkReleases: false, theme: 'dark', accent: 'violet', density: 'comfortable', fontSize: 14, pins: ['sample'], recents: [], notes: {}, seen: {}, drafts: {} };
    window.aboutFixtureCalls = { website: 0, x: 0 };
    const snapshot = async () => ({ agents, sections, source, warnings: [] });
    window.grokdeck = {
      snapshot, connectLive: snapshot, preferences: async () => prefs,
      savePreferences: async patch => (prefs = { ...prefs, ...patch }),
      info: async () => ({ version: '0.0.0-fixture', platform: 'darwin', arch: 'arm64', supportedSourceVersion: '0.75.8' }),
      organization: async () => ({ organization: { sections, pins: ['sample'] } }),
      openDesigner: async () => { window.aboutFixtureCalls.website++; },
      openCreatorX: async () => { window.aboutFixtureCalls.x++; },
    };
  });
  await page.goto(origin);
  const trigger = page.getByRole('button', { name: 'About GrokDeck', exact: true });
  const dialog = page.getByRole('dialog', { name: 'GrokDeck', exact: true });
  const close = page.getByRole('button', { name: 'Close About', exact: true });
  const website = page.getByRole('button', { name: 'Visit Ron Millar’s website', exact: true });
  const x = page.getByRole('button', { name: 'Visit Ron Millar on X', exact: true });
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeInViewport();
  await page.screenshot({ path: path.join(output, 'overview.png'), animations: 'disabled' });
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByText('GrokDeck by Ron Millar 2026', { exact: true })).toBeVisible();
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(x).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(website).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(x).toBeFocused();
  await trigger.evaluate(element => element.focus());
  await expect(close).toBeFocused();
  for (const shortcut of ['Control+k', 'Meta+k']) {
    await page.keyboard.press(shortcut);
    await expect(dialog).toBeVisible();
    await expect(page.locator('.command-palette')).toHaveCount(0);
  }
  await website.click();
  await x.click();
  assert.deepEqual(await page.evaluate(() => window.aboutFixtureCalls), { website: 1, x: 1 });
  await expect(dialog).toBeVisible();

  const assertFits = async () => {
    const bounds = await dialog.boundingBox();
    const viewport = page.viewportSize();
    assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, 'About dialog must fit the viewport');
    assert(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'About content must not overflow horizontally');
    await expect(close).toBeInViewport();
    await expect(website).toBeInViewport();
    await expect(x).toBeInViewport();
  };
  await expect.poll(() => dialog.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await assertFits();
  const darkBackground = await dialog.evaluate(element => getComputedStyle(element).backgroundColor);
  assert.notEqual(await page.locator('.about-card-top').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.screenshot({ path: path.join(output, 'dark.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');

  // The actual theme controls update the same application state used by About.
  await page.getByRole('button', { name: 'Settings & appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.keyboard.press('Escape');
  await trigger.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  assert.notEqual(await dialog.evaluate(element => getComputedStyle(element).backgroundColor), darkBackground);
  await assertFits();
  await page.screenshot({ path: path.join(output, 'light.png'), animations: 'disabled' });
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.deepEqual(await page.locator('.about-backdrop, .about-splash, .about-card, .about-spark').evaluateAll(elements => [...new Set(elements.map(element => getComputedStyle(element).animationName))]), ['none']);
  await page.setViewportSize({ width: 390, height: 844 });
  await assertFits();
  await page.screenshot({ path: path.join(output, 'mobile.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 860, height: 600 });
  await assertFits();
  await page.screenshot({ path: path.join(output, 'small-desktop.png'), animations: 'disabled' });
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  assert.deepEqual(pageErrors, [], 'Renderer must not report uncaught errors');
  console.log(`About UI passed: sidebar entry, focus/Escape/backdrop, shortcut isolation, both callbacks, themes, reduced motion, and responsive layouts. Fictional screenshots: ${output}`);
} finally {
  await browser?.close();
  if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; }
}
