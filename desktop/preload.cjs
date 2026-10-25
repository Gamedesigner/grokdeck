const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("grokdeck", {
  getAvatar: id => ipcRenderer.invoke("deck:avatar",id),
  computers: () => ipcRenderer.invoke("deck:computers"),
  connectLive: () => ipcRenderer.invoke("deck:connect-live"),
  disconnectLive: () => ipcRenderer.invoke("deck:disconnect-live"),
  liveMessages: id => ipcRenderer.invoke("deck:live-messages",id),
  send: (id,prompt,nonce,replyToId) => ipcRenderer.invoke("deck:send",id,prompt,nonce,replyToId),
  acceptance: (id,nonce) => ipcRenderer.invoke("deck:acceptance",id,nonce),
  interrupt: id => ipcRenderer.invoke("deck:interrupt",id),
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
