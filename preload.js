// Minimal, safe bridge. Exposes a tiny read-only API the web app can use to
// detect it's running inside the desktop shell (e.g. to show native-only UI).
// Keep this surface small — no Node access leaks to the page.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("rambowDesktop", {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
