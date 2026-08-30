#!/usr/bin/env node
/* =========================================================
   ตรวจว่า id ทุกตัวที่ JS เรียกใช้ มีอยู่จริงใน index.html

   ทำไมต้องมี: app.js หยิบ element ด้วย $('#id') เกือบทั้งหมด ถ้าจัดหน้าใหม่
   แล้วลบหรือเปลี่ยนชื่อ id ไปโดยไม่ได้แก้โค้ด จะไม่มีอะไรเตือนเลย —
   หน้าเว็บจะตายตอน runtime เพราะ null.something ซึ่งเคยเกิดมาแล้วจริง

   ใช้:  node tools/check-ids.js
   ========================================================= */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = ['app.js', 'alarm.js', 'auth.js'];

/** id ที่มีอยู่จริงใน markup */
const declared = new Set(
  [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])
);

/**
 * id ที่โค้ดเรียกหา — รับเฉพาะรูปแบบที่เป็น literal ตรง ๆ เท่านั้น
 * ตัวที่ประกอบสตริงเอง (`#${x}`) ตรวจแบบนี้ไม่ได้ จึงข้ามไป
 */
const PATTERNS = [
  /\$\('#([A-Za-z0-9_-]+)'\)/g,          // $('#foo')
  /getElementById\('([A-Za-z0-9_-]+)'\)/g,
  /querySelector\('#([A-Za-z0-9_-]+)'\)/g,
];

const used = new Map();                   // id -> ไฟล์ที่เรียก
for (const file of scripts) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  for (const re of PATTERNS) {
    for (const m of src.matchAll(re)) {
      if (!used.has(m[1])) used.set(m[1], file);
    }
  }
}

const missing = [...used.entries()].filter(([id]) => !declared.has(id));

if (missing.length) {
  console.error('\n❌ พบ id ที่โค้ดเรียกใช้ แต่ไม่มีใน index.html:\n');
  for (const [id, file] of missing) console.error(`   #${id}  ← ${file}`);
  console.error(`\n   รวม ${missing.length} รายการ — หน้าเว็บจะพังตอน runtime\n`);
  process.exit(1);
}

console.log(`✅ id ครบทุกตัว (${used.size} ตัวที่โค้ดเรียก / ${declared.size} ตัวใน markup)`);
