#!/usr/bin/env node
/* =========================================================
   ตัวรันเทสต์ — หาไฟล์ใน tests/ เองแล้วส่งให้ node --test

   ทำไมไม่ใช้ glob ตรง ๆ ใน package.json:
   - node --test รองรับ glob ตั้งแต่ Node 21 เท่านั้น (CI ที่ใช้ Node 20 จะพัง)
   - เชลล์แต่ละตัวขยาย glob ไม่เหมือนกัน (cmd.exe ไม่ขยายเลย, bash ต้องเปิด globstar)
   - node --test <โฟลเดอร์> ก็ยังพฤติกรรมไม่นิ่งข้ามเวอร์ชัน
   วิธีนี้ทำงานเหมือนกันทุกเชลล์ ทุกแพลตฟอร์ม ตั้งแต่ Node 18
   และเพิ่มไฟล์เทสต์ใหม่ได้โดยไม่ต้องแก้ package.json

   ใช้:  node tools/run-tests.js [--watch ...]
   ========================================================= */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const testDir = path.join(root, 'tests');

let files;
try {
  files = fs.readdirSync(testDir)
    .filter(f => f.endsWith('.test.js'))
    .sort()
    .map(f => path.posix.join('tests', f));
} catch {
  console.error(`ไม่พบโฟลเดอร์ ${testDir}`);
  process.exit(1);
}

if (!files.length) {
  console.error('ไม่พบไฟล์ *.test.js ใน tests/');
  process.exit(1);
}

const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
  cwd: root,
  stdio: 'inherit',
});

if (r.error) {
  console.error(r.error.message);
  process.exit(1);
}
process.exit(r.status === null ? 1 : r.status);
