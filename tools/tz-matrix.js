#!/usr/bin/env node
/* =========================================================
   รันชุดเทสต์ซ้ำในหลาย timezone เพื่อยืนยันว่า logic เรื่องวัน/เวลา
   ไม่ผูกกับโซนใดโซนหนึ่ง (ผู้ใช้จริงอยู่คนละโซนกับเครื่องที่พัฒนา)

   ชื่อไฟล์ตั้งใจไม่ขึ้นต้นด้วย test- เพราะจะโดน node --test
   หยิบไปรันเป็นไฟล์เทสต์เอง แล้วเกิดการรันซ้อนกัน

   ใช้:  npm run test:tz
   ========================================================= */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ZONES = [
  'Asia/Bangkok',        // UTC+7 — โซนหลักของผู้ใช้
  'Pacific/Kiritimati',  // UTC+14 — โซนตะวันออกสุดของโลก
  'Pacific/Midway',      // UTC-11 — โซนตะวันตกสุด
  'America/New_York',    // มี DST (ซีกโลกเหนือ)
  'Australia/Sydney',    // มี DST (ซีกโลกใต้ สลับทิศกับซีกเหนือ)
  'Asia/Kathmandu',      // UTC+5:45 — offset ที่ไม่ลงตัวเป็นชั่วโมง
  'UTC',
];

const root = path.resolve(__dirname, '..');
const runner = path.join(__dirname, 'run-tests.js');
let failed = 0;

for (const tz of ZONES) {
  const r = spawnSync(process.execPath, [runner], {
    cwd: root,
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const grab = re => (out.match(re) || [])[1] || '?';
  const pass = grab(/^(?:#|ℹ) pass (\d+)$/m);
  const fail = grab(/^(?:#|ℹ) fail (\d+)$/m);
  const ok = r.status === 0;
  if (!ok) failed++;

  console.log(`${ok ? '✓' : '✗'}  ${tz.padEnd(22)} ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
  if (!ok) {
    out.split('\n')
      .filter(l => /^(✖|not ok)|AssertionError|actual:|expected:|Error:/.test(l))
      .slice(0, 12)
      .forEach(l => console.log('     ' + l.trim()));
  }
}

console.log(failed
  ? `\n✗ มี ${failed} โซนที่เทสต์ไม่ผ่าน`
  : `\n✓ ผ่านครบทั้ง ${ZONES.length} โซน`);
process.exit(failed ? 1 : 0);
