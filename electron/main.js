const { app, BrowserWindow, Menu, shell, Tray, nativeImage, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");

// Load .env from the project root so PORT and ELECTRON_DATA_ROOT are available
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch (_) {}

const PORT = process.env.PORT || 3201;
let mainWindow;
let tray;

const STALL_MS = 60000;
const WATCHDOG_INTERVAL_MS = 10000;

let updateStatus = {
  state: "idle", version: null, message: null, checkedAt: null,
  percent: null, transferred: null, total: null, bytesPerSecond: null,
  lastActivityAt: null,
};

function setUpdateStatus(patch) {
  updateStatus = { ...updateStatus, ...patch, lastActivityAt: Date.now() };
}

function setupAutoUpdater() {
  // Default no-op checker; overridden below when running packaged
  global.__appUpdater = {
    getStatus: () => updateStatus,
    checkNow: () => Promise.reject(new Error("Auto-update is only available in the installed app.")),
  };

  // Only run in packaged app, not during development
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => {
      setUpdateStatus({
        state: "checking", version: null, message: null, checkedAt: new Date().toISOString(),
        percent: null, transferred: null, total: null, bytesPerSecond: null,
      });
    });

    autoUpdater.on("update-available", info => {
      // autoDownload is on, so the download starts immediately after this fires
      setUpdateStatus({
        state: "downloading", version: info.version, message: null, checkedAt: new Date().toISOString(),
        percent: 0, transferred: 0, total: null, bytesPerSecond: null,
      });
    });

    autoUpdater.on("download-progress", progress => {
      setUpdateStatus({
        state: "downloading", checkedAt: new Date().toISOString(),
        percent: progress.percent, transferred: progress.transferred,
        total: progress.total, bytesPerSecond: progress.bytesPerSecond,
      });
    });

    autoUpdater.on("update-not-available", () => {
      setUpdateStatus({ state: "not-available", version: null, message: null, checkedAt: new Date().toISOString() });
    });

    autoUpdater.on("update-cancelled", () => {
      setUpdateStatus({ state: "error", message: "Update download was cancelled.", checkedAt: new Date().toISOString() });
    });

    autoUpdater.on("update-downloaded", info => {
      setUpdateStatus({ state: "downloaded", version: info.version, message: null, checkedAt: new Date().toISOString() });
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
      setUpdateStatus({ state: "error", version: null, message: err.message, checkedAt: new Date().toISOString() });
      console.error("[updater] error:", err.message);
    });

    global.__appUpdater.checkNow = () => autoUpdater.checkForUpdates();

    // Check for updates shortly after launch
    setTimeout(() => autoUpdater.checkForUpdates(), 5000);

    // Stall watchdog: if downloading but no progress event for over a minute,
    // flag it as stalled. Recovers automatically on the next progress event.
    setInterval(() => {
      if (updateStatus.state === "downloading" && Date.now() - updateStatus.lastActivityAt > STALL_MS) {
        updateStatus = { ...updateStatus, state: "stalled", message: "No download progress for over a minute." };
      }
    }, WATCHDOG_INTERVAL_MS);
  } catch (e) {
    console.error("[updater] electron-updater not available:", e.message);
    updateStatus = { ...updateStatus, state: "error", version: null, message: e.message, checkedAt: new Date().toISOString() };
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

// data-location.json lives at the FIXED default userData path (never moves), since it's the
// bootstrap record of where the real dataRoot is — config.json itself lives *inside* dataRoot,
// so it can't be used to answer this question before dataRoot is already decided.
function getDataLocationFile() {
  return path.join(app.getPath("userData"), "data-location.json");
}

function readDataLocationChoice() {
  const fp = getDataLocationFile();
  if (!fs.existsSync(fp)) return null; // never chosen yet -> first-run chooser should show
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch (_) {
    return null;
  }
}

function writeDataLocationChoice(dataRoot) {
  fs.writeFileSync(getDataLocationFile(), JSON.stringify({ dataRoot: dataRoot || null }, null, 2));
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
  const iconPath = path.join(__dirname, "tray.png");
  console.log(`[icon] trying tray icon: ${iconPath}`);
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  if (icon.isEmpty()) console.warn("[icon] tray icon is empty - check tray.png");
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
      spellcheck: true,
      zoomFactor: 1.12,
      preload: path.join(__dirname, "main-window-preload.js"),
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

  mainWindow.webContents.on("context-menu", (event, params) => {
    const menuItems = [];
    if (params.misspelledWord) {
      params.dictionarySuggestions.forEach(suggestion => {
        menuItems.push({
          label: suggestion,
          click: () => mainWindow.webContents.replaceMisspelling(suggestion),
        });
      });
      if (!params.dictionarySuggestions.length) {
        menuItems.push({ label: "No suggestions", enabled: false });
      }
      menuItems.push({ type: "separator" });
      menuItems.push({
        label: "Add to Dictionary",
        click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      menuItems.push({ type: "separator" });
    }
    if (params.isEditable) {
      menuItems.push({ label: "Undo", role: "undo", enabled: params.editFlags.canUndo });
      menuItems.push({ label: "Redo", role: "redo", enabled: params.editFlags.canRedo });
      menuItems.push({ type: "separator" });
      menuItems.push({ label: "Cut", role: "cut", enabled: params.editFlags.canCut });
      menuItems.push({ label: "Copy", role: "copy", enabled: params.editFlags.canCopy });
      menuItems.push({ label: "Paste", role: "paste", enabled: params.editFlags.canPaste });
      menuItems.push({ type: "separator" });
      menuItems.push({ label: "Select All", role: "selectAll", enabled: params.editFlags.canSelectAll });
    } else if (params.selectionText) {
      menuItems.push({ label: "Copy", role: "copy" });
    }
    if (menuItems.length) {
      Menu.buildFromTemplate(menuItems).popup();
    }
  });
}

// Registered once (not inside createWindow) so re-creating the window never double-registers it.
// Used by the Settings "Data Location" → "Change…" flow in the main window.
ipcMain.handle("main-window:pick-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
    title: "Choose a new folder for My Projects data",
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

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

  app.whenReady().then(async () => {
    // DATA_ROOT lets a user redirect their data folder (e.g. into a synced
    // OneDrive/Dropbox location) without touching anything else. It's read
    // from a .env placed at the FIXED default userData path, since that's
    // the one location that doesn't itself depend on knowing dataRoot yet.
    // Unset for everyone by default, so this has no effect unless opted in.
    try { require("dotenv").config({ path: path.join(app.getPath("userData"), ".env") }); } catch (_) {}

    // Precedence (highest to lowest):
    //   1. ELECTRON_DATA_ROOT=local  -> dev copies, always use the project dir
    //   2. DATA_ROOT env var         -> power-user override via .env (pre-dates the picker)
    //   3. data-location.json       -> the choice made via the setup screen / Settings
    //   4. app.getPath("userData")  -> default, unchanged until a choice is recorded
    //
    // Unlike the data folder itself, this choice doesn't need to be known before the window
    // opens: the setup screen (shown inside the normal main window, alongside name/team/org)
    // asks about it as one more field. If someone picks a custom folder there, the data already
    // written to the default location gets copied over and the app restarts — see
    // POST /api/data-location in server.js. So on a true first run, before any choice exists,
    // we just proceed with the default; nothing is lost since ensureData() hasn't diverged yet.
    let dataRoot;
    if (process.env.ELECTRON_DATA_ROOT === "local") {
      dataRoot = path.join(__dirname, "..");
    } else if (process.env.DATA_ROOT) {
      dataRoot = process.env.DATA_ROOT;
    } else {
      const choice = readDataLocationChoice();
      dataRoot = (choice && choice.dataRoot) || app.getPath("userData");
    }
    ensureData(dataRoot);
    process.env.APP_DATA_PATH = dataRoot;
    process.env.ELECTRON_APP = "1";

    // For installed builds the first dotenv call (line 7) finds no .env inside
    // the asar archive.  Try again from the persistent data root so users can
    // place a .env in %AppData%/my-projects and have it picked up on every
    // launch — surviving auto-updates that replace the app directory.
    // dotenv.config() never overwrites vars that are already set, so for dev
    // copies where line 7 already loaded .env this is a safe no-op.
    if (dataRoot !== path.join(__dirname, "..")) {
      try { require("dotenv").config({ path: path.join(dataRoot, ".env") }); } catch (_) {}
    }

    // Exposed so server.js can trigger a relaunch after a Settings-driven data-location
    // change — mirrors the existing global.__appUpdater pattern used for auto-update status.
    global.__appRestart = () => { app.isQuitting = true; app.relaunch(); app.quit(); };

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
