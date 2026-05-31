// Rambow desktop — an Electron shell that loads the Rambow web app, the same
// way Discord's desktop client wraps its web app. The win over a browser:
//  - we force the app origin to be treated as a SECURE CONTEXT, so the mic /
//    camera / screen-share (getUserMedia / getDisplayMedia) work even when the
//    site is served over http://<ip> (a plain browser blocks them there);
//  - native window, tray, single-instance, and external-link handling.

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  shell,
  session,
  desktopCapturer,
  nativeImage,
  dialog,
} = require("electron");
const path = require("path");
const { autoUpdater } = require("electron-updater");

// Where the web app lives. Override with RAMBOW_URL when packaging for prod
// (e.g. https://app.rambow.gg). Defaults to the current dev deployment.
const APP_URL = process.env.RAMBOW_URL || "http://178.105.220.21:3002";
const APP_ORIGIN = new URL(APP_URL).origin;
// The desktop client boots straight into the app, never the marketing landing
// page. `/app` redirects to `/login` when signed out, and login/register both
// land back on `/app` — so the whole flow stays inside the client.
const ENTRY = process.env.RAMBOW_ENTRY || "/app";
const ENTRY_URL = new URL(ENTRY, APP_URL).href;
const THEME_BG = "#060a1f";

// ── Treat the (insecure) http origin as secure, so WebRTC capture works ──
// This must run before `app.whenReady()`. Harmless for https origins.
if (APP_ORIGIN.startsWith("http://")) {
  app.commandLine.appendSwitch(
    "unsafely-treat-insecure-origin-as-secure",
    APP_ORIGIN,
  );
  // The allowlist above is only honoured alongside an isolated user-data dir.
  app.commandLine.appendSwitch("disable-features", "BlockInsecurePrivateNetworkRequests");
}

let mainWindow = null;
let splash = null;
let tray = null;
let isQuitting = false;

// Splash timing: keep it up at least this long so the logo animation is seen,
// even when the web app loads instantly.
const SPLASH_MIN_MS = 2200;
const UPDATE_DECISION_MS = 4000; // max wait for the update check before showing the app
let splashStart = 0;
let mainRevealed = false;
let contentReady = false;
let updateDecided = false;
let updating = false;

function createSplash() {
  splash = new BrowserWindow({
    width: 360,
    height: 380,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splash.loadFile(path.join(__dirname, "assets", "splash.html"));
  splash.once("ready-to-show", () => splash && splash.show());
  splashStart = Date.now();
}

// Drive the splash's update UI from the main process (no preload needed).
function splashSay(state, pct) {
  if (!splash || splash.isDestroyed()) return;
  splash.webContents
    .executeJavaScript(
      `window.setUpdate && window.setUpdate(${JSON.stringify(state)}, ${Number(pct) || 0})`,
    )
    .catch(() => {});
}

// Reveal the main window once BOTH the web content is ready AND the update
// check has resolved (no update / error / timeout) — and we're not mid-update.
// Holds the splash for its minimum on-screen time, then fades it out.
// Idempotent — safe to call from several events.
function maybeReveal() {
  if (mainRevealed || updating) return;
  if (!contentReady || !updateDecided) return;
  mainRevealed = true;
  const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashStart));
  setTimeout(fadeOutSplash, wait);
}

function fadeOutSplash() {
  if (!splash || splash.isDestroyed()) return showMainNow();
  splash.webContents
    .executeJavaScript("document.body.classList.add('leaving')")
    .catch(() => {});
  let opacity = 1;
  const timer = setInterval(() => {
    if (!splash || splash.isDestroyed()) {
      clearInterval(timer);
      return showMainNow();
    }
    opacity -= 0.12;
    if (opacity <= 0) {
      clearInterval(timer);
      splash.close();
      splash = null;
      showMainNow();
    } else {
      splash.setOpacity(opacity);
    }
  }, 28);
}

function showMainNow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ── Auto-update (GitHub Releases feed via electron-updater) ──
// Only runs in packaged builds. If an update is found AT LAUNCH (while the
// splash is still up), we hold the splash and show a live download bar on it,
// then restart into the new version. If one is found LATER (app already open),
// it downloads in the background and we ask politely to restart.
function setupAutoUpdate() {
  if (!app.isPackaged) {
    updateDecided = true; // nothing to check in dev → don't block the reveal
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", () => {
    // Only take over the splash if we're still on it (launch-time update).
    if (!mainRevealed) {
      updating = true;
      splashSay("downloading", 0);
    }
  });

  autoUpdater.on("download-progress", (p) => {
    if (updating) splashSay("downloading", p.percent);
  });

  autoUpdater.on("update-downloaded", (info) => {
    if (updating) {
      // Splash path: finish the bar, then auto-restart into the new build.
      // quitAndInstall(true, true) → silent install (no NSIS progress window) +
      // relaunch, so the whole update is just our splash bar then the new app.
      splashSay("ready", 100);
      setTimeout(() => {
        isQuitting = true;
        autoUpdater.quitAndInstall(true, true);
      }, 1100);
      return;
    }
    // Background path (update found while already running): ask first.
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update available",
      message: `Rambow ${info.version} is ready to install.`,
      detail: "Restart the app to apply the update.",
    });
    if (choice === 0) {
      isQuitting = true;
      autoUpdater.quitAndInstall(true, true);
    }
  });

  autoUpdater.on("update-not-available", () => {
    updateDecided = true;
    maybeReveal();
  });

  autoUpdater.on("error", (err) => {
    console.error("[auto-update]", err == null ? "unknown" : err.message || err);
    // Don't trap the user on the splash if the download/check fails.
    updating = false;
    updateDecided = true;
    maybeReveal();
  });

  // If the check is slow or GitHub is unreachable, stop waiting and show the app.
  setTimeout(() => {
    if (!updating) {
      updateDecided = true;
      maybeReveal();
    }
  }, UPDATE_DECISION_MS);

  autoUpdater.checkForUpdates().catch(() => {
    updateDecided = true;
    maybeReveal();
  });
  setInterval(
    () => autoUpdater.checkForUpdates().catch(() => {}),
    6 * 60 * 60 * 1000,
  );
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 560,
    backgroundColor: THEME_BG,
    autoHideMenuBar: true,
    show: false, // stays hidden behind the splash until the web app is ready
    title: "Rambow",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadURL(ENTRY_URL);

  // Swap splash → app once the web content is ready to paint. The fallback
  // guarantees the window appears even if the load stalls.
  mainWindow.once("ready-to-show", () => {
    contentReady = true;
    maybeReveal();
  });
  mainWindow.webContents.once("did-finish-load", () => {
    contentReady = true;
    maybeReveal();
  });
  // Hard fallback: never get stuck on the splash.
  setTimeout(() => {
    contentReady = true;
    updateDecided = true;
    maybeReveal();
  }, 20000);

  // Open external links (other origins, target=_blank) in the system browser
  // instead of inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (isExternal(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // If the dev server is down, show a small retry page instead of a blank crash.
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, validatedURL) => {
    if (code === -3) return; // aborted (e.g. redirect), ignore
    if (validatedURL && !validatedURL.startsWith(APP_ORIGIN)) return;
    mainWindow.loadURL(errorPage(desc));
  });

  // Minimise to tray on close (Discord-style); real quit via tray / Ctrl+Q.
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function isExternal(url) {
  try {
    return new URL(url).origin !== APP_ORIGIN;
  } catch {
    return false;
  }
}

function errorPage(desc) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{height:100%;margin:0;background:${THEME_BG};color:#eee;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
    .box{text-align:center;max-width:420px;padding:32px}
    h1{font-size:20px;margin:0 0 8px}p{color:#9aa;margin:0 0 20px;font-size:14px}
    button{background:#1838ff;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer}
    code{color:#7e99ff}
  </style></head><body><div class="box">
    <h1>Can't reach Rambow</h1>
    <p>${desc || "Connection failed"} — is the server at <code>${APP_ORIGIN}</code> running?</p>
    <button onclick="location.href='${ENTRY_URL}'">Retry</button>
  </div></body></html>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

// ── Media permissions + screen-share source picker ──
function wireMediaPermissions() {
  const ses = session.defaultSession;

  // Auto-grant mic / camera / notifications / screen-capture for our own app.
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allow = [
      "media",
      "audioCapture",
      "videoCapture",
      "display-capture",
      "notifications",
      "clipboard-sanitized-write",
    ];
    callback(allow.includes(permission));
  });
  ses.setPermissionCheckHandler(() => true);

  // getDisplayMedia → hand back a screen source. v1 picks the primary screen;
  // a richer in-app source picker can replace this later.
  ses.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen", "window"] })
        .then((sources) => {
          const primary =
            sources.find((s) => s.id.startsWith("screen")) || sources[0];
          if (primary) callback({ video: primary, audio: "loopback" });
          else callback(); // no source → cancels gracefully
        })
        .catch(() => callback());
    },
    { useSystemPicker: true },
  );
}

function createTray() {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, "build", "icon.png"),
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Rambow");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Rambow", click: () => showWindow() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => showWindow());
}

function showWindow() {
  if (!mainWindow) createWindow();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ── Single-instance: focus the running window instead of opening a 2nd one ──
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  app.whenReady().then(() => {
    wireMediaPermissions();
    createSplash();
    createWindow();
    createTray();
    setupAutoUpdate();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  // Keep running in the tray when all windows are closed (don't auto-quit).
  app.on("window-all-closed", () => {
    // no-op: tray keeps the app alive; quit explicitly from the tray menu
  });
}
