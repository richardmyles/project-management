const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronBridge", {
  pickFolder: () => ipcRenderer.invoke("main-window:pick-folder"),
});
