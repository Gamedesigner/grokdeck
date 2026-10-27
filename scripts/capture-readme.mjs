// Capture the real renderer with an entirely fictional, in-memory workspace.
// No desktop helper, vendor account, private cache, or outbound request is used.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'docs/images');
const origin = 'http://127.0.0.1:5178';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5178', '--strictPort'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw Error('Screenshot server exited; port 5178 must be free.');
    try { ready = (await fetch(origin)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw Error('Screenshot server did not start.');
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1, colorScheme: 'dark', timezoneId: 'America/Los_Angeles' });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.clock.setFixedTime(new Date('2026-10-26T17:00:00-07:00'));
  await page.addInitScript(({ version }) => {
    const now = Date.now();
    const specs = [
      ['launch', 'Launch planner', 'Creative studio', 'studio', 'The launch checklist is ready. Two decisions need your attention.'],
      ['design', 'Design partner', 'Creative studio', 'studio', 'Three layout directions, with room for your own ideas.'],
      ['build', 'Build partner', 'Creative studio', 'studio', 'The latest build is ready for a walkthrough.'],
      ['research', 'Research desk', 'Everyday', 'everyday', 'Your reading list is organized and ready to explore.'],
      ['day', 'Daily planner', 'Everyday', 'everyday', 'A little space for focused work this afternoon.'],
    ];
    const messages = [
      { id: 'example-user', role: 'user', content: 'Let’s make the launch feel simple. What should I focus on today?', timestamp: now - 720000, type: 'text', streaming: false },
      { id: 'example-reply', role: 'assistant', content: '## A clear path to launch\n\nThe details are organized. Here are the three things worth your attention today:\n\n1. **Pick the first impression.** Choose the hero image and the short introduction.\n2. **Try the whole journey.** Install the app, connect your account, and open a conversation.\n3. **Invite a few fresh eyes.** Ask someone new to try it and share where they get stuck.\n\nEverything else can wait until tomorrow. ✨', timestamp: now - 600000, type: 'text', streaming: false },
      { id: 'example-followup', role: 'user', content: 'Start with the first impression. I want it to feel calm and easy to find my way around.', timestamp: now - 300000, type: 'text', streaming: false },
      { id: 'example-latest', role: 'assistant', content: 'That gives us a good direction: clear groups, favorite agents close at hand, and one obvious next step.\n\nThe three layout options are ready when you are. 👍\n\n*Fictional example conversation for the GrokDeck README.*', timestamp: now - 120000, type: 'text', streaming: false },
    ];
    const agents = specs.map(([id, name, section, sectionId, preview], i) => ({ id, name, section, sectionId, preview, description: 'Fictional example agent', color: ['#b4a2ff', '#85d4bd', '#92b7ff', '#e3bc78', '#db9bce'][i], pinned: i === 0, hasUnread: i < 2, unreadCount: i < 2 ? 1 : 0, awaitingResponse: i === 0, lastActivityAt: now - (i + 1) * 120000, cachedAt: now, messages: i === 0 ? messages : [] }));
    const sections = [{ id: 'studio', name: 'Creative studio', agentIds: ['launch', 'design', 'build'] }, { id: 'everyday', name: 'Everyday', agentIds: ['research', 'day'] }];
    const source = { kind: 'live-gateway', available: true, checkedAt: now, cacheUpdatedAt: now, version: '0.75.8', path: 'Fictional example workspace', warning: null };
    let prefs = { checkReleases: false, theme: 'dark', accent: 'violet', density: 'comfortable', fontSize: 15, pins: ['launch'], recents: ['launch', 'design', 'build'], notes: {}, seen: {}, drafts: {} };
    const snapshot = () => ({ agents, sections, source, warnings: [] });
    const forbidden = async () => { throw Error('Screenshot fixtures cannot write to an account.'); };
    window.grokdeck = {
      snapshot: async () => snapshot(), connectLive: async () => snapshot(), preferences: async () => prefs, savePreferences: async patch => (prefs = { ...prefs, ...patch }),
      info: async () => ({ version, platform: 'darwin', arch: 'arm64', supportedSourceVersion: '0.75.8' }),
      organization: async () => ({ organization: { sections, pins: ['launch'] } }), updateOrganization: forbidden,
      liveMessages: async id => ({ messages: agents.find(a => a.id === id).messages, source }),
      openAgent: forbidden, send: forbidden, openViewer: forbidden, startComputer: forbidden,
      agentProfile: async id => ({ profile: { name: agents.find(a => a.id === id).name, title: 'A little clarity for your next project', description: 'Help organize ideas, explore options, and turn a busy workspace into a clear next step.' } }),
      updateAgentProfile: forbidden, setAgentAvatar: forbidden,
      computers: async () => ({ apiVersion: 1, checkedAt: now, complete: true, computers: agents.slice(0, 3).map(a => ({ agentId: a.id, name: a.name, state: 'running', windows: [{ index: 1, label: 'Desktop 2' }], checkedAt: now })) }),
    };
  }, { version });
  await page.goto(origin);
  await page.getByRole('region', { name: 'Pinned group' }).waitFor();
  await page.getByRole('button', { name: 'New group', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'overview.png') });
  await page.getByRole('region', { name: 'Pinned group' }).getByText('Launch planner', { exact: true }).click();
  await page.getByLabel('Discussion with Launch planner').waitFor();
  await page.getByText('Fictional example conversation for the GrokDeck README.', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'conversation.png') });
  await page.getByRole('button', { name: 'Edit agent', exact: true }).click();
  await page.getByLabel('Agent name').waitFor();
  await page.screenshot({ path: path.join(output, 'agent-editor.png') });
  await page.getByRole('dialog', { name: 'Edit agent' }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Computers', exact: true }).click();
  await page.getByRole('button', { name: 'View computer', exact: true }).first().waitFor();
  await page.screenshot({ path: path.join(output, 'computers.png') });
  await page.getByRole('button', { name: 'About GrokDeck', exact: true }).click();
  await page.getByRole('dialog', { name: 'GrokDeck', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'about.png'), animations: 'disabled' });
  console.log('Captured five desktop screenshots using fictional local fixtures only.');
} finally {
  await browser?.close();
  if (server.exitCode === null) { const closed = once(server, 'exit'); server.kill('SIGTERM'); await closed; }
}
