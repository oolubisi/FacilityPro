const { contextBridge, ipcRenderer } = require("electron");

// Minimal, safe surface exposed to the renderer for multi-window support.
// The renderer never gets direct access to BrowserWindow/ipcRenderer —
// only this one function, which just asks the main process to open a
// small read-only snapshot window.
contextBridge.exposeInMainWorld("desktopBridge", {
  openRecordWindow: (title, rowsHtml) =>
    ipcRenderer.invoke("open-record-window", { title, rowsHtml }),
});

// [FEATURE] Local data bridge — replaces network calls to Apps Script
// with an IPC call to the local JSON store (see db.js/local-api.js).
// Deliberately the same (action, data, sessionToken) -> Promise<result>
// shape as the old fetch(GAS_URL, ...) call it replaces, so Core.js's
// callApi only needs to switch which transport it uses, not how any
// of its hundreds of callers throughout the app work.
contextBridge.exposeInMainWorld("localApi", {
  call: (action, data, sessionToken) =>
    ipcRenderer.invoke("local-api-call", { action, data, sessionToken }),
  // [FEATURE] One-time import from the existing cloud backend — see
  // migration.js. Kept separate from .call() since it isn't a normal
  // app action, just a one-off setup step.
  runMigration: () => ipcRenderer.invoke("run-migration"),
  // [FEATURE] Opens the native folder picker so the person can choose
  // where attachments (photos, PDFs) are saved locally — see
  // main.js's select-attachments-folder handler.
  selectAttachmentsFolder: () => ipcRenderer.invoke("select-attachments-folder"),
  // [FEATURE] Pushes a read-only snapshot to the mobile relay — see
  // mobile-sync.js. Also happens automatically on app exit; this is
  // for the "Sync Now" button so it doesn't require closing the app
  // to get mobile caught up.
  syncMobileSnapshot: () => ipcRenderer.invoke("sync-mobile-snapshot"),
});
