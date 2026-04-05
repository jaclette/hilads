/**
 * Generates apps/mobile/assets/notification-icon.png
 *
 * Android requires a notification icon that is:
 *   - monochrome (white foreground only)
 *   - transparent background
 *   - simple, readable at small sizes
 *
 * This script renders the Hilads "Hi¡" mark (from Logo.jsx, viewBox 0 0 64 64)
 * scaled to 96×96 in pure Node.js — no external dependencies.
 *
 * Run: node scripts/gen-notification-icon.js
 * Output: assets/notification-icon.png
 */

'use strict';

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── Canvas ──────────────────────────────────────────────────────────────────

const SIZE   = 96;
const pixels = new Uint8Array(SIZE * SIZE * 4); // RGBA, all transparent

function setPixel(x, y) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  pixels[i] = 255; pixels[i+1] = 255; pixels[i+2] = 255; pixels[i+3] = 255;
}

function fillRoundedRect(x, y, w, h, rx) {
  rx = Math.min(rx, w / 2, h / 2);
  const x2 = x + w, y2 = y + h;
  for (let py = Math.floor(y); py < Math.ceil(y2); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x2); px++) {
      // Reject pixels in rounded corners
      let skip = false;
      if      (px < x + rx  && py < y + rx)  { const dx = px - (x  + rx), dy = py - (y  + rx); skip = dx*dx + dy*dy > rx*rx; }
      else if (px >= x2 - rx && py < y + rx)  { const dx = px - (x2 - rx), dy = py - (y  + rx); skip = dx*dx + dy*dy > rx*rx; }
      else if (px < x + rx  && py >= y2 - rx) { const dx = px - (x  + rx), dy = py - (y2 - rx); skip = dx*dx + dy*dy > rx*rx; }
      else if (px >= x2 - rx && py >= y2 - rx){ const dx = px - (x2 - rx), dy = py - (y2 - rx); skip = dx*dx + dy*dy > rx*rx; }
      if (!skip) setPixel(px, py);
    }
  }
}

function fillCircle(cx, cy, r) {
  const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
  const y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px - cx, dy = py - cy;
      if (dx*dx + dy*dy <= r*r) setPixel(px, py);
    }
  }
}

// ── Draw Hilads "Hi¡" mark (Logo.jsx shapes, scaled 64→96, factor=1.5) ────

// H — left bar  (orig: x=9,  y=13, w=8,  h=38, rx=2.5)
fillRoundedRect(14, 20, 12, 57, 4);

// H — right bar (orig: x=26, y=13, w=8,  h=38, rx=2.5)
fillRoundedRect(39, 20, 12, 57, 4);

// H — crossbar  (orig: x=17, y=28, w=9,  h=6,  rx=2)
fillRoundedRect(26, 42, 13,  9, 3);

// ¡ — body      (orig: x=43, y=25, w=8,  h=26, rx=2.5)
fillRoundedRect(65, 38, 12, 39, 4);

// ¡ — dot       (orig: cx=47, cy=15, r=5.5)
fillCircle(71, 23, 8);

// ── PNG writer (pure Node, no deps) ────────────────────────────────────────

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf    = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length);
  const crcInput  = Buffer.concat([typeBytes, data]);
  const crcBuf    = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

function writePNG(pixels, size, outPath) {
  // IHDR: width, height, bit depth=8, colour type=6 (RGBA)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;

  // Raw scanlines: 1 filter byte (0=None) + width×4 RGBA bytes per row
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter None
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = y * (1 + size * 4) + 1 + x * 4;
      raw[dst]   = pixels[src];
      raw[dst+1] = pixels[src+1];
      raw[dst+2] = pixels[src+2];
      raw[dst+3] = pixels[src+3];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  fs.writeFileSync(outPath, Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ── Output ──────────────────────────────────────────────────────────────────

const outPath = path.resolve(__dirname, '../assets/notification-icon.png');
writePNG(pixels, SIZE, outPath);
console.log(`✓ Generated ${outPath} (${SIZE}×${SIZE})`);
