const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
  Menu,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
let window,
  adapter,
  prefs = {},
  snapshot;
let releaseChecker, releaseStatus, releasePending;
const liveClient = require('./live.cjs').createLiveClient();
const bridgeProcess=require('./bridge-process.cjs').createBridgeProcess({app,client:liveClient});
app.on('before-quit',()=>{bridgeProcess.stop();void phoneHost?.stop();});
let liveEnabled = false;
const unsettledSends = new Set();
const {createAppUpdates,installationSupport,RELEASES_URL}=require('./app-updates.cjs');
let appUpdates,phoneHost;
const liveMessages = new Map();
async function getLiveSnapshot() {
  const response = await liveClient.roster();
  const cached=await adapter.readCache();
  const ids=new Set(response.agents.map(a=>a.id));
  const sections=cached.sections.map(s=>({...s,agentIds:s.agentIds.filter(id=>ids.has(id))})).filter(s=>s.agentIds.length);
  return {agents: response.agents.map(a => {const old=cached.agents.find(row=>row.id===a.id),section=sections.find(s=>s.agentIds.includes(a.id));return {...a, color: old?.color||'#8a9bff', section:section?.name||'Unassigned',sectionId:section?.id||'__unassigned__', pinned:old?.pinned===true,
    unreadCount:0, messages:liveMessages.get(a.id)||[]};}), sections, source:{...response.source,path:''}, warnings:response.warnings||[]};
}
function requireLive() {if(!liveEnabled)throw new Error('Connect live first');}

const defaults = {
  checkReleases: true,
  theme: "dark",
  accent: "violet",
  density: "comfortable",
  fontSize: 14,
  pins: [],
  recents: [],
  notes: {},
  seen: {},
  drafts: {},
};
const prefsFile = () => path.join(app.getPath("userData"), "preferences.json");
async function savePrefs() {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  const file = prefsFile();
  await fs.writeFile(`${file}.tmp`, JSON.stringify(prefs), { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
}
async function getSnapshot() {
  snapshot = await adapter.readCache(prefs.sourcePath);
  return snapshot;
}
function register(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (
      event.sender !== window?.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("Untrusted sender");
    try {
      return await callback(...args);
    } catch (error) {
      console.error(channel, error.name);
      throw new Error(
        "GrokDeck could not complete this action. Please try again.",
      );
    }
  });
}
function validPrefs(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("Invalid preferences");
  const result = {};
  for (const key of [
    "theme",
    "checkReleases",
    "accent",
    "density",
    "fontSize",
    "pins",
    "recents",
    "notes",
    "seen",
    "drafts",
  ])
    if (key in patch) result[key] = patch[key];
  if ("checkReleases" in result && typeof result.checkReleases !== "boolean")
    throw new Error("Invalid release preference");
  if ("theme" in result && !["dark", "light", "system"].includes(result.theme))
    throw new Error("Invalid theme");
  if (
    "accent" in result &&
    !["violet", "mint", "amber", "blue"].includes(result.accent)
  )
    throw new Error("Invalid accent");
  if (
    "density" in result &&
    !["comfortable", "compact"].includes(result.density)
  )
    throw new Error("Invalid density");
  if ("fontSize" in result && ![13, 14, 15, 16, 18].includes(result.fontSize))
    throw new Error("Invalid size");
  for (const key of ["pins", "recents"])
    if (
      key in result &&
      (!Array.isArray(result[key]) ||
        result[key].length > 2000 ||
        result[key].some((x) => typeof x !== "string" || x.length > 128))
    )
      throw new Error("Invalid list");
  for (const key of ["notes", "seen", "drafts"])
    if (
      key in result &&
      (!result[key] ||
        typeof result[key] !== "object" ||
        Array.isArray(result[key]) ||
        Object.entries(result[key]).some(
          ([k, v]) =>
            k.length > 128 ||
            (key === "seen"
              ? typeof v !== "number" || !Number.isFinite(v)
              : typeof v !== "string" || v.length > 50000),
        ))
    )
      throw new Error("Invalid map");
  if (JSON.stringify(result).length > 4 * 1024 * 1024)
    throw new Error("Preferences too large");
  return result;
}
async function boot() {
  adapter = await import(pathToFileURL(path.join(__dirname, "cache.mjs")).href);
  try {
    const existing = JSON.parse(await fs.readFile(prefsFile(), "utf8"));
    prefs = {
      ...defaults,
      ...validPrefs(existing),
      ...(typeof existing.phoneHost === 'string' ? {phoneHost:existing.phoneHost} : {}),
      ...(typeof existing.sourcePath === "string"
        ? { sourcePath: existing.sourcePath }
        : {}),
    };
  } catch {
    prefs = { ...defaults };
  }
  releaseChecker = await import(
    pathToFileURL(path.join(__dirname, "releases.mjs")).href
  );
  const {createPhoneHost}=await import('./phone-host.mjs');
  phoneHost=createPhoneHost({ensureLive:()=>bridgeProcess.ensure()});
  register('deck:phone-hosts',()=>({hosts:phoneHost.hosts(),...phoneHost.status()}));
  register('deck:phone-start',async host=>{
    if(typeof host!=='string')throw new Error('Invalid address');
    const status=await phoneHost.enable(host);
    prefs.phoneHost=host;await savePrefs();return status;
  });
  register('deck:phone-stop',async()=>{
    const status=await phoneHost.stop();delete prefs.phoneHost;await savePrefs();return status;
  });
  register('deck:phone-copy-setup',async()=>{
    const choice=await dialog.showMessageBox(window,{type:'info',title:'Pair your iPhone',
      message:'Copy a one-time phone setup?',detail:'Paste it into GrokDeck Settings on your iPhone while both devices are on your trusted network. It expires after five minutes and can only be used once.',
      buttons:['Copy setup','Cancel'],defaultId:0,cancelId:1});
    if(choice.response!==0)return {copied:false};
    const setup=phoneHost.setup();clipboard.writeText(setup.text);
    return {copied:true,expiresAt:setup.expiresAt};
  });
  const {autoUpdater}=require('electron-updater');
  appUpdates=createAppUpdates({currentVersion:app.getVersion(),updater:autoUpdater,
    supported:()=>installationSupport(app,autoUpdater),hasPendingSends:()=>unsettledSends.size>0});
  register('deck:app-updates', (force=false)=>{
    if(typeof force!=='boolean')throw new Error('Invalid request');
    return appUpdates.check(force);
  });
  register('deck:app-update-status',()=>appUpdates.status());
  register('deck:download-update',()=>appUpdates.download());
  register('deck:install-update',()=>appUpdates.install());
  register('deck:open-designer',()=>shell.openExternal('https://ronmillar.com'));
  register('deck:open-downloads',()=>shell.openExternal(RELEASES_URL));
  register("deck:check-releases", async (force = false) => {
    if (typeof force !== "boolean") throw new Error("Invalid request");
    const source = await getSnapshot();
    if (
      !force &&
      releaseStatus &&
      releaseStatus.currentVersion === source.source.version &&
      Date.now() - releaseStatus.checkedAt < 6 * 3600000
    )
      return releaseStatus;
    if (releasePending) return releasePending;
    releasePending = (async () => {
      const current = await getSnapshot();
      releaseStatus = await releaseChecker.checkRelease({
        currentVersion: current.source.version,
      });
      return releaseStatus;
    })();
    try {
      return await releasePending;
    } finally {
      releasePending = null;
    }
  });
  register("deck:snapshot", () => liveEnabled ? getLiveSnapshot() : getSnapshot());
  register("deck:connect-live", async () => {
    if(prefs.sourcePath){liveEnabled=false;return getSnapshot();}
    await bridgeProcess.ensure();
    const result=await getLiveSnapshot();
    liveEnabled=true;
    return result;
  });
  register("deck:disconnect-live", async () => {liveEnabled=false;liveMessages.clear();return getSnapshot();});
  register("deck:avatar", async id => {requireLive();return liveClient.avatar(id);});
  register('deck:organization',async()=>{requireLive();return liveClient.organization();});
  register('deck:organization-update',async(organization,expected)=>{requireLive();return liveClient.updateOrganization(organization,expected);});
  register('deck:viewer-open',async(id,window)=>{requireLive();return liveClient.openViewer(id,window);});
  register('deck:viewer-exchange',async(id,sequence,data)=>{requireLive();return liveClient.exchangeViewer(id,sequence,data);});
  register('deck:viewer-close',async id=>liveClient.closeViewer(id));
  register('deck:profile',async id=>{requireLive();return liveClient.profile(id);});
  register('deck:profile-update',async(id,profile,expected)=>{requireLive();return liveClient.updateProfile(id,profile,expected);});
  register('deck:avatar-update',async(id,png)=>{requireLive();return liveClient.setAvatar(id,png);});
  register('deck:computer-start',async id=>{requireLive();return liveClient.startComputer(id);});
  register("deck:computers", async () => {requireLive();return liveClient.computers();});
  register("deck:live-messages", async id => {requireLive();const result=await liveClient.messages(id);liveMessages.set(id,result.messages);return result;});
  register("deck:send", async (id,prompt,nonce,replyToId) => {
    requireLive();const key=JSON.stringify([id,nonce]);unsettledSends.add(key);
    const result=await liveClient.send(id,prompt,nonce,replyToId);
    if(['accepted','rejected'].includes(result.status))unsettledSends.delete(key);
    return result;
  });
  register("deck:acceptance", async (id,nonce) => {
    requireLive();const result=await liveClient.acceptance(id,nonce);
    if(['accepted','rejected'].includes(result.status))unsettledSends.delete(JSON.stringify([id,nonce]));
    return result;
  });
  register("deck:interrupt", async id => {requireLive();return liveClient.interrupt(id);});
  register("deck:preferences", () => prefs);
  register("deck:save-preferences", async (patch) => {
    prefs = { ...prefs, ...validPrefs(patch) };
    await savePrefs();
    return prefs;
  });
  register("deck:choose-source", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "Choose the Grok Bot data folder",
      properties: ["openDirectory"],
    });
    if (result.canceled) return null;
    liveEnabled=false;liveMessages.clear();
    prefs.sourcePath = result.filePaths[0];
    await savePrefs();
    return getSnapshot();
  });
  register("deck:reset-source", async () => {
    delete prefs.sourcePath;
    await savePrefs();
    return getSnapshot();
  });
  register("deck:open-agent", async (id) => {
    const current = await getSnapshot();
    if (!current.agents.some((a) => a.id === id))
      throw new Error("Unknown agent");
    await shell.openExternal(adapter.conversationURL(id));
    return true;
  });
  register("deck:copy", async (text) => {
    if (typeof text !== "string" || text.length > 1000000)
      throw new Error("Invalid text");
    clipboard.writeText(text);
    return true;
  });
  register("deck:export-conversation", async (id) => {
    const current = await getSnapshot();
    const agent = current.agents.find((a) => a.id === id);
    if (!agent) throw new Error("Unknown agent");
    const result = await dialog.showSaveDialog(window, {
      title: "Export cached discussion",
      defaultPath: `${agent.name.replace(/[^a-z0-9_-]/gi, "_")}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (result.canceled || !result.filePath) return false;
    const body =
      `# ${agent.name}\n\nCached discussion exported from GrokDeck. This may be incomplete.\n\n` +
      agent.messages
        .map(
          (m) =>
            `## ${m.author || (m.role === "user" ? "You" : m.role === "assistant" ? agent.name : "Activity")} · ${m.timestamp ? new Date(m.timestamp).toISOString() : "Time unavailable"}\n\n${m.content}`,
        )
        .join("\n\n---\n\n");
    await fs.writeFile(result.filePath, body, { mode: 0o600 });
    return true;
  });
  register("deck:info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    supportedSourceVersion: adapter.SUPPORTED_VERSION,
  }));
  window = new BrowserWindow({
    width: 1440,
    height: 950,
    minWidth: 860,
    minHeight: 600,
    title: "GrokDeck",
    backgroundColor: "#101114",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 18, y: 19 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin"
        ? [
            {
              label: "GrokDeck",
              submenu: [
                { role: "about" },
                { type: "separator" },
                { role: "hide" },
                { role: "hideOthers" },
                { type: "separator" },
                { role: "quit" },
              ],
            },
          ]
        : []),
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "togglefullscreen" },
        ],
      },
      { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] },
    ]),
  );
  const devURL = process.env.GROKDECK_DEV_URL;
  if (devURL === "http://127.0.0.1:5173" && !app.isPackaged)
    await window.loadURL(devURL);
  else await window.loadFile(path.join(__dirname, "../dist/index.html"));
  if(prefs.phoneHost)void phoneHost.enable(prefs.phoneHost).catch(()=>{
    console.error('Saved phone connection could not start; select an available private network in Settings.');
  });
  if (process.env.GROKDECK_SCREENSHOT) {
    setTimeout(async () => {
      try {
        const image = await window.webContents.capturePage();
        await fs.writeFile(process.env.GROKDECK_SCREENSHOT, image.toPNG());
        app.quit();
      } catch {
        app.exit(1);
      }
    }, 3500);
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(boot)
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
  app.on("window-all-closed", () => app.quit());
}
