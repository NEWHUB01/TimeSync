#!/usr/bin/env node
/* =========================================================
   เว็บเซิร์ฟเวอร์เล็ก ๆ สำหรับพัฒนา TimeSync — ไม่ใช้ dependency ใด ๆ
   จำเป็นเพราะ Service Worker / PWA ใช้กับ file:// ไม่ได้

   ใช้:  npm start           → http://localhost:8123
         npm start -- 3000   → เปลี่ยนพอร์ต
   ========================================================= */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8123;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400).end('Bad request'); return; }

  if (urlPath.endsWith('/')) urlPath += 'index.html';

  // กัน path traversal — ต้องอยู่ใต้ ROOT เท่านั้น
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ไม่พบไฟล์: ' + urlPath);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      // ปิด cache ระหว่างพัฒนา ไม่งั้นแก้ service worker แล้วเบราว์เซอร์ยังใช้ตัวเก่า
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  🌙 TimeSync — http://localhost:${PORT}\n     เสิร์ฟจาก ${ROOT}\n     กด Ctrl+C เพื่อหยุด\n`);
});
