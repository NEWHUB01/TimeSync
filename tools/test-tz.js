#!/usr/bin/env node
/* =========================================================
   รันชุดเทสต์ซ้ำในหลาย timezone เพื่อยืนยันว่า logic เรื่องวัน/เวลา
   ไม่ผูกกับโซนใดโซนหนึ่ง (ผู้ใช้จริงอยู่คนละโซนกับเครื่องที่พัฒนา)

   ใช้:  npm run test:tz
   ========================================================= */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

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
let failed = 0;

for (const tz of ZONES) {
  const r = spawnSync(process.execPath, ['--test', 'tests/**/*.test.js'], {
    cwd: root,
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
  const out = r.stdout || '';
  const pass = (out.match(/^# pass (\d+)$/m) || out.match(/^ℹ pass (\d+)$/m) || [])[1] || '?';
  const fail = (out.match(/^# fail (\d+)$/m) || out.match(/^ℹ fail (\d+)$/m) || [])[1] || '?';
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'}  ${tz.padEnd(22)} ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
  if (!ok) {
    const lines = out.split('\n').filter(l => /^✖|AssertionError|actual:|expected:/.test(l));
    lines.slice(0, 12).forEach(l => console.log('     ' + l.trim()));
  }
}

console.log(failed
  ? `\n✗ มี ${failed} โซนที่เทสต์ไม่ผ่าน`
  : `\n✓ ผ่านครบทั้ง ${ZONES.length} โซน`);
process.exit(failed ? 1 : 0);
