// Build the app icons from the web logo. Pure-JS (jimp + png-to-ico), so it
// needs no native image tooling. Produces:
//   build/icon.png  (512×512, used for the window/tray and Linux)
//   build/icon.ico  (multi-size, used by electron-builder for Windows)
//
// Run:  npm run make:icon
const fs = require("fs");
const path = require("path");
const Jimp = require("jimp");
const pngToIco = require("png-to-ico");

const SRC = process.env.LOGO_SRC || "/home/eyeside0/rambow-front/public/logo.png";
const OUT = path.join(__dirname, "..", "build");
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function squarePng(src, size) {
  const img = await Jimp.read(src);
  // Transparent square canvas; the logo is contained at ~82% with padding.
  const canvas = new Jimp(size, size, 0x00000000);
  const target = Math.round(size * 0.82);
  img.contain(target, target);
  const x = Math.round((size - img.bitmap.width) / 2);
  const y = Math.round((size - img.bitmap.height) / 2);
  canvas.composite(img, x, y);
  return canvas.getBufferAsync(Jimp.MIME_PNG);
}

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error("Logo source not found:", SRC);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  // 512 png for window/tray/linux.
  fs.writeFileSync(path.join(OUT, "icon.png"), await squarePng(SRC, 512));
  console.log("wrote build/icon.png (512×512)");

  // Multi-size ico for Windows.
  const buffers = await Promise.all(ICO_SIZES.map((s) => squarePng(SRC, s)));
  const ico = await pngToIco(buffers);
  fs.writeFileSync(path.join(OUT, "icon.ico"), ico);
  console.log("wrote build/icon.ico (" + ICO_SIZES.join(", ") + ")");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
