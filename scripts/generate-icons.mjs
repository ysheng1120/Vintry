// Generates PNG/ICO icons in public/ from public/icon.svg.
// Run with `npm run icons`; the output is committed so builds need no image tooling.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const CREAM = "#f7f1e6";

const svg = await readFile(`${publicDir}icon.svg`, "utf8");

// Full-bleed variant: square cream background, same artwork (for iOS and maskable).
const fullBleed = svg.replace(
  /<rect width="512" height="512" rx="112"/,
  '<rect width="512" height="512"',
);

// Maskable: artwork scaled into the 80% safe zone on a full-bleed background.
const inner = fullBleed
  .replace(/^<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .replace(/<rect width="512" height="512" fill="#f7f1e6"\/>/, "");
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${CREAM}"/>
  <g transform="translate(256 256) scale(0.72) translate(-256 -256)">${inner}</g>
</svg>`;

const render = (source, size) =>
  sharp(Buffer.from(source), { density: 72 * Math.ceil(size / 512) * 2 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

const outputs = [
  ["pwa-192x192.png", svg, 192],
  ["pwa-512x512.png", svg, 512],
  ["maskable-512x512.png", maskable, 512],
  ["apple-touch-icon.png", fullBleed, 180],
];

for (const [name, source, size] of outputs) {
  await writeFile(`${publicDir}${name}`, await render(source, size));
  console.log(`wrote public/${name}`);
}

// favicon.ico containing 16, 32 and 48px PNG images (PNG-in-ICO is supported everywhere).
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => render(svg, s)));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((size, i) => {
  const png = pngs[i];
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0);
  entry.writeUInt8(size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});
await writeFile(`${publicDir}favicon.ico`, Buffer.concat([header, ...entries, ...pngs]));
console.log("wrote public/favicon.ico");
