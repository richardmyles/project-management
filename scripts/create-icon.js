// Generates build/icon.ico and electron/tray.png — blue folder icon with LP1 branding
const fs   = require("fs");
const path = require("path");
const zlib = require("zlib");

const buf256 = drawIcon(256, 40);
const buf48  = drawIcon(48,  8);
const buf32  = drawIcon(32,  6);
const buf16  = drawIcon(16,  3);

writeIco([
  { size: 256, buf: buf256 },
  { size: 48,  buf: buf48  },
  { size: 32,  buf: buf32  },
  { size: 16,  buf: buf16  },
]);

// Tray icon: 32x32 PNG (PNG works reliably with nativeImage for the system tray)
writeTrayPng(buf32, 32);

// ─── Icon drawing (BGRA, bottom-up rows — ICO format) ────────────────────────

function drawIcon(sz, radius) {
  const pixels = Buffer.alloc(sz * sz * 4);

  function px(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= sz || y < 0 || y >= sz) return;
    const i = ((sz - 1 - y) * sz + x) * 4;
    pixels[i] = b; pixels[i+1] = g; pixels[i+2] = r; pixels[i+3] = a;
  }

  function roundedRect(x, y, w, h, r, R, G, B) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const inL = dx < r, inR = dx >= w - r, inT = dy < r, inB = dy >= h - r;
        if (inL && inT) { const cx = r-dx-0.5, cy = r-dy-0.5; if (cx*cx+cy*cy > r*r) continue; }
        else if (inR && inT) { const cx = dx-(w-r)+0.5, cy = r-dy-0.5; if (cx*cx+cy*cy > r*r) continue; }
        else if (inL && inB) { const cx = r-dx-0.5, cy = dy-(h-r)+0.5; if (cx*cx+cy*cy > r*r) continue; }
        else if (inR && inB) { const cx = dx-(w-r)+0.5, cy = dy-(h-r)+0.5; if (cx*cx+cy*cy > r*r) continue; }
        px(x+dx, y+dy, R, G, B);
      }
    }
  }

  const s = sz / 256;

  roundedRect(0, 0, sz, sz, radius, 15, 58, 133);

  const fbX = Math.round(52*s), fbY = Math.round(94*s);
  const fbW = Math.round(152*s), fbH = Math.round(106*s);
  roundedRect(fbX, fbY, fbW, fbH, Math.max(2, Math.round(10*s)), 255, 255, 255);

  const ftX = fbX, ftY = Math.round(72*s);
  const ftW = Math.round(68*s), ftH = Math.round(26*s);
  roundedRect(ftX, ftY, ftW, ftH, Math.max(2, Math.round(8*s)), 255, 255, 255);
  roundedRect(ftX, ftY + ftH - 2, ftW, fbY - (ftY + ftH) + 4, 0, 255, 255, 255);

  const lX = Math.round(72*s), lW = Math.round(108*s), lH = Math.max(2, Math.round(7*s));
  const lR = Math.max(1, Math.round(3*s));
  const lY1 = Math.round(116*s), lY2 = Math.round(140*s), lY3 = Math.round(164*s);
  roundedRect(lX, lY1, lW,               lH, lR, 15, 58, 133);
  roundedRect(lX, lY2, lW,               lH, lR, 15, 58, 133);
  roundedRect(lX, lY3, Math.round(80*s), lH, lR, 15, 58, 133);

  return pixels;
}

// ─── PNG writer ──────────────────────────────────────────────────────────────

function writeTrayPng(bgraBottomUp, sz) {
  // Convert BGRA bottom-up (ICO) → RGBA top-down (PNG)
  const rgba = Buffer.alloc(sz * sz * 4);
  for (let y = 0; y < sz; y++) {
    for (let x = 0; x < sz; x++) {
      const src = ((sz - 1 - y) * sz + x) * 4;
      const dst = (y * sz + x) * 4;
      rgba[dst+0] = bgraBottomUp[src+2]; // R
      rgba[dst+1] = bgraBottomUp[src+1]; // G
      rgba[dst+2] = bgraBottomUp[src+0]; // B
      rgba[dst+3] = bgraBottomUp[src+3]; // A
    }
  }

  // Raw scanlines: filter byte (0=None) + RGBA row
  const raw = Buffer.alloc((1 + sz * 4) * sz);
  for (let y = 0; y < sz; y++) {
    raw[y * (1 + sz * 4)] = 0;
    rgba.copy(raw, y * (1 + sz * 4) + 1, y * sz * 4, (y + 1) * sz * 4);
  }

  const compressed = zlib.deflateSync(raw);

  function crc32(buf) {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    let crc = 0xFFFFFFFF;
    for (const b of buf) crc = t[(crc ^ b) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, "ascii");
    data.copy(b, 8);
    b.writeUInt32BE(crc32(b.slice(4, 8 + data.length)), 8 + data.length);
    return b;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(sz, 0); ihdr.writeUInt32BE(sz, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit depth, RGBA color type

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), // PNG signature
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  const electronDir = path.join(__dirname, "..", "electron");
  if (!fs.existsSync(electronDir)) fs.mkdirSync(electronDir, { recursive: true });
  const outPath = path.join(electronDir, "tray.png");
  fs.writeFileSync(outPath, png);
  console.log(`Created ${outPath} (${(png.length / 1024).toFixed(1)} KB, tray icon)`);
}

// ─── ICO writer ──────────────────────────────────────────────────────────────

function writeIco(images) {
  const BMP_HEADER = 40;

  const entries = images.map(({ size, buf }) => {
    const pixelBytes = size * size * 4;
    const maskBytes  = Math.ceil(size / 32) * 4 * size;
    return { size, buf, pixelBytes, maskBytes, dataSize: BMP_HEADER + pixelBytes + maskBytes };
  });

  const headerSize = 6 + 16 * entries.length;
  const ico = Buffer.alloc(headerSize + entries.reduce((s, e) => s + e.dataSize, 0));
  let off = 0;

  ico.writeUInt16LE(0, off); off += 2;
  ico.writeUInt16LE(1, off); off += 2;
  ico.writeUInt16LE(entries.length, off); off += 2;

  let imageOff = headerSize;
  entries.forEach(e => { e.offset = imageOff; imageOff += e.dataSize; });

  entries.forEach(({ size, dataSize, offset }) => {
    ico.writeUInt8(size === 256 ? 0 : size, off); off += 1;
    ico.writeUInt8(size === 256 ? 0 : size, off); off += 1;
    ico.writeUInt8(0, off); off += 1;
    ico.writeUInt8(0, off); off += 1;
    ico.writeUInt16LE(1,  off); off += 2;
    ico.writeUInt16LE(32, off); off += 2;
    ico.writeUInt32LE(dataSize, off); off += 4;
    ico.writeUInt32LE(offset,   off); off += 4;
  });

  entries.forEach(({ size, buf, pixelBytes, maskBytes }) => {
    ico.writeUInt32LE(40,       off); off += 4;
    ico.writeInt32LE(size,      off); off += 4;
    ico.writeInt32LE(size * 2,  off); off += 4;
    ico.writeUInt16LE(1,        off); off += 2;
    ico.writeUInt16LE(32,       off); off += 2;
    ico.writeUInt32LE(0,        off); off += 4;
    ico.writeUInt32LE(0,        off); off += 4;
    ico.writeInt32LE(0,         off); off += 4;
    ico.writeInt32LE(0,         off); off += 4;
    ico.writeUInt32LE(0,        off); off += 4;
    ico.writeUInt32LE(0,        off); off += 4;
    buf.copy(ico, off); off += pixelBytes;
    off += maskBytes;
  });

  const buildDir = path.join(__dirname, "..", "build");
  if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(path.join(buildDir, "icon.ico"), ico);
  console.log(`Created build/icon.ico (${(ico.length / 1024).toFixed(1)} KB, ${entries.length} sizes)`);
}
