// Minimal, safe bridge. Exposes a tiny read-only API plus window controls for
// the custom title bar the web app draws when it detects it's in the desktop
// shell. Keep this surface small — no Node access leaks to the page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rambowDesktop", {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  // Screen-share source picker. getScreenSources() lists screens + windows
  // (with thumbnails) for the in-app picker; pickScreenSource() records the
  // user's choice so the next getDisplayMedia hands back exactly that source.
  getScreenSources: () => ipcRenderer.invoke("desktop:get-sources"),
  pickScreenSource: (id, audio) =>
    ipcRenderer.invoke("desktop:pick-source", { id, audio }),
  // Window controls for the custom (frameless) title bar.
  window: {
    minimize: () => ipcRenderer.send("win:minimize"),
    toggleMaximize: () => ipcRenderer.send("win:toggle-maximize"),
    close: () => ipcRenderer.send("win:close"),
    isMaximized: () => ipcRenderer.invoke("win:is-maximized"),
    // Subscribe to maximize/unmaximize; returns an unsubscribe fn.
    onMaximizeChange: (cb) => {
      const handler = (_e, value) => cb(!!value);
      ipcRenderer.on("win:maximized", handler);
      return () => ipcRenderer.removeListener("win:maximized", handler);
    },
  },
});
