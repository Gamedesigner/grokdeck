const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("grokdeck", {
  snapshot: () => ipcRenderer.invoke("deck:snapshot"),
  checkReleases: (force = false) =>
    ipcRenderer.invoke("deck:check-releases", force),
  preferences: () => ipcRenderer.invoke("deck:preferences"),
  savePreferences: (patch) =>
    ipcRenderer.invoke("deck:save-preferences", patch),
  chooseSource: () => ipcRenderer.invoke("deck:choose-source"),
  resetSource: () => ipcRenderer.invoke("deck:reset-source"),
  openAgent: (id) => ipcRenderer.invoke("deck:open-agent", id),
  copy: (text) => ipcRenderer.invoke("deck:copy", text),
  exportConversation: (id) =>
    ipcRenderer.invoke("deck:export-conversation", id),
  info: () => ipcRenderer.invoke("deck:info"),
});
