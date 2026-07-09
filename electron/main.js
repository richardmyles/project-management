const { app, BrowserWindow, Menu, shell, Tray, nativeImage, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");

// Load .env from the project root so PORT and ELECTRON_DATA_ROOT are available
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch (_) {}

const PORT = process.env.PORT || 3201;
let mainWindow;
let tray;

function setupAutoUpdater() {
  // Only run in packaged app, not during development
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("update-available", () => {
      // Download happens automatically; user is notified when ready to install
    });

    autoUpdater.on("update-downloaded", () => {
      const result = dialog.showMessageBoxSync(mainWindow, {
        type: "info",
        title: "Update Ready",
        message: "A new version of My Projects has been downloaded.",
        detail: "Restart the app to apply the update.",
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
      });
      if (result === 0) {
        app.isQuitting = true;
        autoUpdater.quitAndInstall();
      }
    });

    autoUpdater.on("error", err => {
      console.error("[updater] error:", err.message);
    });

    // Check for updates shortly after launch
    setTimeout(() => autoUpdater.checkForUpdates(), 5000);
  } catch (e) {
    console.error("[updater] electron-updater not available:", e.message);
  }
}

function ensureData(dataRoot) {
  [
    path.join(dataRoot, "data"),
    path.join(dataRoot, "data", "goals"),
    path.join(dataRoot, "data", "archive"),
    path.join(dataRoot, "data", "reports"),
  ].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

  const defaults = {
    [path.join(dataRoot, "config.json")]:
      { name: "", team: "", org: "", primaryColor: "#0F3A85", setupComplete: false },
    [path.join(dataRoot, "data", "state.json")]:
      { lastUpdated: null, projects: [], journal: [], tasks: [] },
    [path.join(dataRoot, "data", "goals", "goal_project_map.json")]:
      { lastUpdated: null, mappings: [] },
    [path.join(dataRoot, "data", "notes.json")]:
      { notes: [] },
  };
  Object.entries(defaults).forEach(([fp, val]) => {
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, JSON.stringify(val, null, 2));
  });
}

function waitForServer(cb, tries = 40) {
  http.get(`http://localhost:${PORT}`, () => cb()).on("error", () => {
    if (tries > 0) setTimeout(() => waitForServer(cb, tries - 1), 100);
    else cb();
  });
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.setAlwaysOnTop(true);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(false);
}

function createTray() {
  const iconPath = path.join(__dirname, "icon.ico");
  console.log(`[icon] trying tray icon: ${iconPath}`);
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  if (icon.isEmpty()) console.warn("[icon] tray icon is empty - check icon.ico");
  else console.log("[icon] tray icon loaded OK");
  tray = new Tray(icon);
  tray.setToolTip("My Projects");
  tray.on("click", showWindow);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open My Projects", click: showWindow },
    { type: "separator" },
    { label: "Quit", click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 820,
    minHeight: 600,
    title: "My Projects",
    backgroundColor: "#f5f0ef",
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      zoomFactor: 1.12,
    },
    show: true,
  });

  mainWindow.loadFile(path.join(__dirname, "loading.html"));

  waitForServer(() => { if (mainWindow) mainWindow.loadURL(`http://localhost:${PORT}`); });

  // Hide to tray instead of quitting when window is closed
  mainWindow.on("close", e => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.exit(0);
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      // setAlwaysOnTop trick bypasses Windows focus-stealing prevention
      mainWindow.setAlwaysOnTop(true);
      mainWindow.show();
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(false);
    }
  });

  app.whenReady().then(() => {
    // ELECTRON_DATA_ROOT=local → use project dir (personal dev copies)
    // Default → use userData (distributable builds, portable .exe)
    const dataRoot = process.env.ELECTRON_DATA_ROOT === "local"
      ? path.join(__dirname, "..")
      : app.getPath("userData");
    ensureData(dataRoot);
    process.env.APP_DATA_PATH = dataRoot;
    process.env.ELECTRON_APP = "1";

    createTray();
    createWindow();
    setupAutoUpdater();

    setImmediate(() => {
      require(path.join(__dirname, "..", "server.js"));
    });
  });

  // Keep process alive when all windows are closed (tray keeps it running)
  app.on("window-all-closed", () => {});

  app.on("before-quit", () => { app.isQuitting = true; });
}
