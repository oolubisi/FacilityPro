const { contextBridge, ipcRenderer } = require("electron");

// Minimal, safe surface exposed to the renderer for multi-window support.
// The renderer never gets direct access to BrowserWindow/ipcRenderer —
// only this one function, which just asks the main process to open a
// small read-only snapshot window.
contextBridge.exposeInMainWorld("desktopBridge", {
  openRecordWindow: (title, rowsHtml) =>
    ipcRenderer.invoke("open-record-window", { title, rowsHtml }),
});
