# Rambow Desktop

An Electron shell that wraps the Rambow web app into a native Windows desktop
client — the same architecture Discord's desktop app uses.

**Why a desktop client (beyond a browser tab):** it forces the app origin to be
treated as a **secure context**, so the microphone / camera / screen-share
(`getUserMedia` / `getDisplayMedia`) work even when the site is served over
`http://<ip>` — a plain browser blocks WebRTC capture there. Plus a real window,
system tray, single-instance, and external links open in the system browser.

## Configure

The shell loads `RAMBOW_URL` (default `http://178.105.220.21:3002`). For prod,
point it at your domain:

```bash
RAMBOW_URL=https://app.rambow.gg npm start
```

For packaged builds the value is baked from the env at build time, or you can
set it in `main.js`.

## Develop

```bash
npm install
npm run make:icon   # generate build/icon.png + build/icon.ico from the web logo
npm start           # launch the shell against RAMBOW_URL
```

## Build the Windows installer

```bash
npm run dist:win    # → dist/Rambow-Setup-<version>.exe  (NSIS installer)
                    #   dist/Rambow-Portable-<version>.exe (no-install portable)
```

### Building on Linux
Producing a Windows installer from Linux requires **Wine** (electron-builder
uses it to run the NSIS toolchain). Install it first:

```bash
# Debian/Ubuntu
sudo dpkg --add-architecture i386 && sudo apt update
sudo apt install -y wine64 wine32 mono-complete
```

If Wine isn't available, run `npm run dist:win` on a Windows machine or in CI
(GitHub Actions `windows-latest`) instead. `npm run pack` produces an unpacked
`dist/win-unpacked/` app dir without needing Wine, useful for smoke-testing.

## Screen share

`getDisplayMedia` is wired through Electron's `setDisplayMediaRequestHandler`
with the native system picker (`useSystemPicker: true`); on platforms without
one it falls back to the primary screen. Replace with a custom in-app picker if
you want a Discord-style source chooser.
