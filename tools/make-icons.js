#!/usr/bin/env node
/* =========================================================
   สร้างไอคอน PNG สำหรับ PWA โดยไม่ใช้ dependency ใด ๆ
   (เข้ารหัส PNG เองด้วย zlib ที่ติดมากับ Node)

   ใช้:  node tools/make-icons.js
   ========================================================= */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.resolve(__dirname, '..', 'icons');

/* ---------- ตัวเข้ารหัส PNG ---------- */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array ขนาด w*h*4 */
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;                                   // filter: none
    rgba.copy ? rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
              : Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- วาดไอคอน: พระจันทร์เสี้ยวบนพื้นไล่สีกลางคืน ---------- */
function draw(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const pad = maskable ? size * 0.1 : 0;          // maskable เผื่อขอบให้ระบบครอบ
  const r = size / 2 - pad;
  const cx = size / 2, cy = size / 2;
  const radius = size * (maskable ? 0.5 : 0.22);  // มุมโค้งของพื้นหลัง

  // พระจันทร์เสี้ยว = วงกลมใหญ่ลบวงกลมเล็กที่เยื้องไปทางขวาบน
  const mR = size * 0.30, mx = cx - size * 0.03, my = cy;
  const cR = size * 0.255, ccx = mx + size * 0.115, ccy = my - size * 0.085;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // พื้นหลังมุมโค้ง
      const dx = Math.max(Math.abs(x - cx) - (size / 2 - pad - radius), 0);
      const dy = Math.max(Math.abs(y - cy) - (size / 2 - pad - radius), 0);
      const inside = Math.hypot(dx, dy) <= radius &&
                     Math.abs(x - cx) <= size / 2 - pad && Math.abs(y - cy) <= size / 2 - pad;
      if (!inside) { px[i + 3] = 0; continue; }

      // ไล่สีทแยงจากน้ำเงินเข้มไปม่วง
      const t = (x / size * 0.45 + y / size * 0.55);
      px[i]     = Math.round(14 + t * 46);     // R  #0e1330 → #3c2a66
      px[i + 1] = Math.round(19 + t * 23);
      px[i + 2] = Math.round(48 + t * 54);
      px[i + 3] = 255;

      // พระจันทร์
      const inMoon = Math.hypot(x - mx, y - my) <= mR;
      const inCut  = Math.hypot(x - ccx, y - ccy) <= cR;
      if (inMoon && !inCut) {
        const g = (x - (mx - mR)) / (mR * 2);
        px[i]     = Math.round(235 + g * 20);
        px[i + 1] = Math.round(225 + g * 20);
        px[i + 2] = 255;
      }

      // ดาวเล็ก ๆ สองดวง
      for (const [sx, sy, ss] of [[0.72, 0.26, 0.022], [0.79, 0.40, 0.014]]) {
        if (Math.hypot(x - size * sx, y - size * sy) <= size * ss) {
          px[i] = 255; px[i + 1] = 255; px[i + 2] = 255;
        }
      }
    }
  }
  return encodePNG(size, size, px);
}

fs.mkdirSync(OUT, { recursive: true });
const files = [
  ['icon-192.png', draw(192, false)],
  ['icon-512.png', draw(512, false)],
  ['icon-maskable-512.png', draw(512, true)],
];
for (const [name, buf] of files) {
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`  ✓ icons/${name}  (${(buf.length / 1024).toFixed(1)} KB)`);
}
