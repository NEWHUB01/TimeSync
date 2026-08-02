/* =========================================================
   TimeSync — เทสต์ความถูกต้องข้าม timezone (Phase 4)

   ชุดนี้ตรวจว่า logic ทั้งหมดยึด "เวลาท้องถิ่นของผู้ใช้" อย่างสม่ำเสมอ
   ไม่หลุดไปใช้ UTC ที่ไหน ซึ่งจะทำให้วันคลาดกันในโซนที่ offset ไกลจาก UTC

   รันซ้ำทุกโซนได้ด้วย:  npm run test:tz
   ========================================================= */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);
const TZ = process.env.TZ || '(ค่าเริ่มต้นของเครื่อง)';
const offsetH = -new Date(2026, 7, 2).getTimezoneOffset() / 60;

describe(`timezone: ${TZ} (UTC${offsetH >= 0 ? '+' : ''}${offsetH})`, () => {
  test('dateKey ยึดวันตามปฏิทินท้องถิ่นเสมอ ไม่ว่าโซนไหน', () => {
    // สองจุดนี้คือกับดักคลาสสิกของการเผลอใช้ toISOString
    assert.equal(C.dateKey(at(2026, 8, 2, 0, 1)), '2026-08-02');
    assert.equal(C.dateKey(at(2026, 8, 2, 23, 59)), '2026-08-02');
  });

  test('dateKey ต่างจาก toISOString ในโซนที่ offset ไม่ใช่ 0 — พิสูจน์ว่าไม่ได้ใช้ UTC', () => {
    if (offsetH === 0) return;   // UTC ตรงกันอยู่แล้ว ไม่มีอะไรให้พิสูจน์

    // โซนตะวันออก (+) ตอนหลังเที่ยงคืน UTC ยังเป็นเมื่อวาน
    // โซนตะวันตก (−) ตอนใกล้เที่ยงคืน UTC เป็นพรุ่งนี้ไปแล้ว
    const d = offsetH > 0 ? at(2026, 8, 2, 0, 30) : at(2026, 8, 2, 23, 30);
    assert.equal(C.dateKey(d), '2026-08-02', 'dateKey ต้องยึดวันท้องถิ่น');
    assert.notEqual(
      C.dateKey(d), d.toISOString().slice(0, 10),
      `ที่ offset ${offsetH} ชม. วันแบบ UTC ต้องไม่ตรงกับวันท้องถิ่น ณ เวลานี้`
    );
  });

  test('การนอนข้ามเที่ยงคืนให้ผลเท่ากันทุกโซน', () => {
    assert.equal(C.hoursBetween('23:00', '07:00'), 8);
    assert.equal(C.hoursBetween('01:30', '08:00'), 6.5);
  });

  test('หนี้การนอนนับวันถูกต้อง ไม่ว่าจะบันทึกตอนก่อนหรือหลังเที่ยงคืน', () => {
    const cfg = { ageGroup: 'young', debtWindow: 7 };
    const logs = {};
    for (let i = 0; i < 7; i++) {
      logs[C.dateKey(C.addDays(at(2026, 8, 2), -i))] = { bed: '00:30', wake: '05:30', hours: 5 };
    }
    // ตรวจทั้งตอนดึกและตอนสาย ต้องได้ผลเท่ากัน
    const lateNight = C.computeDebt(logs, cfg, at(2026, 8, 2, 0, 5));
    const midday = C.computeDebt(logs, cfg, at(2026, 8, 2, 12, 0));
    const beforeMidnight = C.computeDebt(logs, cfg, at(2026, 8, 2, 23, 55));
    assert.equal(lateNight.debt, 14);
    assert.equal(midday.debt, 14);
    assert.equal(beforeMidnight.debt, 14);
    assert.equal(lateNight.logged, 7);
  });

  test('กรอบเวลาหนี้การนอนไม่เลื่อนตามโซน', () => {
    const r = C.computeDebt({}, { ageGroup: 'adult', debtWindow: 7 }, at(2026, 8, 2, 12, 0));
    assert.equal(r.days[0].key, '2026-07-27');
    assert.equal(r.days[6].key, '2026-08-02');
  });

  test('เวลาปลุกอ้างอิงนาฬิกาท้องถิ่น', () => {
    const alarm = Object.assign({}, C.defaults().alarm, { on: true, time: '07:00' });
    assert.equal(C.alarmStatus(alarm, at(2026, 8, 2, 7, 0)).due, true);
    assert.equal(C.alarmStatus(alarm, at(2026, 8, 2, 6, 59)).due, false);
    assert.equal(C.dateKey(C.alarmStatus(alarm, at(2026, 8, 2, 23, 0)).nextAt), '2026-08-03');
  });

  test('todayAt / nextOccurrence คืนเวลาท้องถิ่นตามที่ขอเป๊ะ', () => {
    const d = C.todayAt(C.parseHM('22:30'), at(2026, 8, 2, 3, 0));
    assert.equal(d.getHours(), 22);
    assert.equal(d.getMinutes(), 30);
    assert.equal(C.dateKey(d), '2026-08-02');
  });

  test('ตารางรายวันจับวันในสัปดาห์ตามปฏิทินท้องถิ่น', () => {
    const s = C.migrate({
      version: C.STATE_VERSION,
      schedule: { mode: 'weekly', simple: { wake: '07:00' }, weekly: { 1: { wake: '05:00' } } },
    });
    // 2026-08-03 เป็นวันจันทร์ในทุกโซน เพราะเราสร้าง Date จากเวลาท้องถิ่น
    assert.equal(at(2026, 8, 3, 12, 0).getDay(), 1);
    assert.equal(C.scheduleFor(s, at(2026, 8, 3, 12, 0)).wake, '05:00');
  });

  test('การเตือนคำนวณเวลาตรงกันทุกโซน', () => {
    const s = C.migrate({
      version: C.STATE_VERSION, usualWake: '07:00', latency: 15, cycleLen: 90,
      lastBed: '23:00', lastWake: '07:00',
      sleepLogs: { '2026-08-02': { bed: '23:00', wake: '07:00', hours: 8 } },
    });
    const due = C.dueReminders(s, at(2026, 8, 2, 22, 45));
    assert.ok(due.some(r => r.id === 'bedtime'), 'ต้องเตือนก่อนนอนตอน 22:45 ทุกโซน');
  });

  test('ปีอธิกสุรทินและสิ้นปีไม่เพี้ยน', () => {
    assert.equal(C.dateKey(C.addDays(at(2028, 2, 28, 23, 30), 1)), '2028-02-29');
    assert.equal(C.dateKey(C.addDays(at(2026, 12, 31, 23, 30), 1)), '2027-01-01');
  });
});
