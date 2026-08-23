const { app, BrowserWindow, shell, ipcMain } = require("electron");
const fs = require("fs");
const http = require("http");
const path = require("path");

const appRoot = path.join(__dirname, "..");
const indexPath = path.join(appRoot, "index.html");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

let staticServer;

function resolveAsset(requestUrl) {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = pathname === "/" ? indexPath : path.join(appRoot, pathname);
  const normalizedPath = path.normalize(requestedPath);

  if (!normalizedPath.startsWith(appRoot)) {
    return null;
  }

  return normalizedPath;
}

// [BUG FIX] This used to be startStaticServer() calling
// staticServer.listen(0, ...) — port 0 means "OS picks any free port,"
// so the app's local origin (http://127.0.0.1:<port>/) was different
// on every single launch. Browsers scope localStorage, IndexedDB, and
// Service Worker registration per-origin — with a different port each
// time, none of that ever persisted between app restarts. That's the
// actual reason the desktop app couldn't log in offline: the stored
// session lived at the previous launch's now-nonexistent origin, so
// every restart looked like a first-ever visit as far as the browser's
// storage was concerned. Same root cause silently broke the offline
// Service Worker cache on desktop the whole time, too.
//
// Fix: use a fixed port so the origin is identical across launches.
// Falls back to a random port (with a warning) only if the fixed one
// is somehow already taken by something else on the machine — the app
// still works in that case, it just won't get offline persistence for
// that one session.
const PREFERRED_PORT = 47821;

function tryListen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const assetPath = resolveAsset(request.url);

      if (!assetPath) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      fs.readFile(assetPath, (error, data) => {
        if (error) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }

        response.writeHead(200, {
          "Cache-Control": "no-cache",
          "Content-Type": mimeTypes[path.extname(assetPath)] || "application/octet-stream",
        });
        response.end(data);
      });
    });

    server.once("error", (err) => {
      server.close();
      reject(err);
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function startStaticServer() {
  try {
    staticServer = await tryListen(PREFERRED_PORT);
  } catch (err) {
    console.warn(
      `Facility Pro: preferred port ${PREFERRED_PORT} unavailable (${err.code}), falling back to a random port. ` +
        "Offline login/caching won't persist across restarts for this session.",
    );
    staticServer = await tryListen(0);
  }
  const { port } = staticServer.address();
  return `http://127.0.0.1:${port}/`;
}

async function createWindow() {
  const appUrl = await startStaticServer();
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 390,
    minHeight: 640,
    title: "Facility Pro",
    backgroundColor: "#ffffff",
    icon: path.join(appRoot, "logo.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(`${appUrl}desktop.html`);
}

// § MULTI-WINDOW SUPPORT
// Opens a small, self-contained read-only window showing a snapshot of a
// single record, so the user can keep it open for reference alongside the
// main window. It's static HTML built from data already fetched by the
// renderer — no shared app state, no extra network/data load, no preload
// needed for this window since it has no app logic of its own.
const openRecordWindows = new Set();

ipcMain.handle("open-record-window", (event, payload) => {
  const title = String((payload && payload.title) || "Record Detail").slice(0, 120);
  const rowsHtml = typeof (payload && payload.rowsHtml) === "string" ? payload.rowsHtml : "";

  const win = new BrowserWindow({
    width: 460,
    height: 620,
    minWidth: 360,
    minHeight: 320,
    title,
    backgroundColor: "#ffffff",
    icon: path.join(appRoot, "logo.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  openRecordWindows.add(win);
  win.on("closed", () => openRecordWindows.delete(win));

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const page = `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family:'Inter',-apple-system,sans-serif; background:#fff; color:#07111f; }
  header { position:sticky; top:0; background:#0b1b2f; color:#fff; padding:16px 20px; display:flex; align-items:center; justify-content:space-between; }
  header h1 { margin:0; font-size:16px; font-weight:800; }
  header button { background:rgba(255,255,255,0.12); border:0; color:#fff; border-radius:8px; padding:8px 12px; font-weight:800; cursor:pointer; font-size:12px; }
  main { padding:18px 20px 30px; }
  .row { padding:10px 0; border-bottom:1px solid #eef1f4; }
  .row span { display:block; color:#6f7a88; font-size:11px; font-weight:900; text-transform:uppercase; }
  .row strong { display:block; margin-top:3px; overflow-wrap:anywhere; font-size:14px; }
</style>
</head>
<body>
  <header>
    <h1>${title}</h1>
    <button onclick="window.print()"><i></i>Print</button>
  </header>
  <main>${rowsHtml || "<p>No details available.</p>"}</main>
</body>
</html>`;

  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(page));
  return true;
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (staticServer) {
    staticServer.close();
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
