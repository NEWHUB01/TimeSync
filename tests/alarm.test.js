/* =========================================================
   TimeSync — unit tests สำหรับนาฬิกาปลุก (Phase 2)
   ========================================================= */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const at = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s, 0);
const alarm = over => Object.assign({}, C.defaults().alarm, { on: true, time: '07:00' }, over);

/* ---------------------------------------------------------
   alarmStatus
   --------------------------------------------------------- */
describe('alarmStatus', () => {
  test('ปิดอยู่ → ไม่ armed ไม่ due', () => {
    const s = C.alarmStatus(alarm({ on: false }), at(2026, 8, 2, 7, 0));
    assert.equal(s.armed, false);
    assert.equal(s.due, false);
    assert.equal(s.nextAt, null);
  });

  test('ไม่มีข้อมูลปลุกเลย → ไม่พัง', () => {
    assert.equal(C.alarmStatus(null, new Date()).armed, false);
    assert.equal(C.alarmStatus(undefined, new Date()).due, false);
  });

  test('ยังไม่ถึงเวลา → armed แต่ยังไม่ due พร้อมนับถอยหลัง', () => {
    const s = C.alarmStatus(alarm(), at(2026, 8, 2, 23, 0));
    assert.equal(s.armed, true);
    assert.equal(s.due, false);
    assert.equal(C.dateKey(s.nextAt), '2026-08-03');
    assert.equal(Math.round(s.leftMin), 480);        // 8 ชม.
  });

  test('ถึงเวลาพอดี → due', () => {
    const s = C.alarmStatus(alarm(), at(2026, 8, 2, 7, 0));
    assert.equal(s.due, true);
    assert.equal(s.rungKey, '2026-08-02');
  });

  test('เปิดแอปช้าแต่ยังอยู่ในช่วง grace → ยังปลุก', () => {
    assert.equal(C.alarmStatus(alarm(), at(2026, 8, 2, 7, 29)).due, true);
  });

  test('เลย grace ไปแล้ว → ไม่ปลุกย้อนหลัง', () => {
    const s = C.alarmStatus(alarm(), at(2026, 8, 2, 7, 31));
    assert.equal(s.due, false);
    assert.equal(C.dateKey(s.nextAt), '2026-08-03');  // ไปรอบหน้าแทน
  });

  test('ปลุกไปแล้วในรอบนี้ → ไม่ปลุกซ้ำ', () => {
    const s = C.alarmStatus(alarm({ lastRung: '2026-08-02' }), at(2026, 8, 2, 7, 5));
    assert.equal(s.due, false);
    assert.equal(s.alreadyRung, true);
  });

  test('ปลุกไปแล้วเมื่อวาน ไม่กันการปลุกวันนี้', () => {
    assert.equal(C.alarmStatus(alarm({ lastRung: '2026-08-01' }), at(2026, 8, 2, 7, 0)).due, true);
  });

  test('เวลาปลุกหลังเที่ยงคืน คิดวันถูก', () => {
    // ปลุก 01:30 — ตอน 01:35 ของวันที่ 2 ต้อง due และ key เป็นวันที่ 2
    const s = C.alarmStatus(alarm({ time: '01:30' }), at(2026, 8, 2, 1, 35));
    assert.equal(s.due, true);
    assert.equal(s.rungKey, '2026-08-02');
  });

  test('เวลาปลุกหลังเที่ยงคืน ตอนก่อนเที่ยงคืนต้องรอวันถัดไป', () => {
    const s = C.alarmStatus(alarm({ time: '01:30' }), at(2026, 8, 2, 23, 0));
    assert.equal(s.due, false);
    assert.equal(C.dateKey(s.nextAt), '2026-08-03');
  });

  test('กำลังเลื่อนปลุกอยู่ → ใช้เวลาเลื่อนแทน', () => {
    const until = at(2026, 8, 2, 7, 9);
    const a = alarm({ snoozedUntil: until.getTime(), lastRung: '2026-08-02' });
    const before = C.alarmStatus(a, at(2026, 8, 2, 7, 5));
    assert.equal(before.snoozed, true);
    assert.equal(before.due, false);
    assert.equal(Math.round(before.leftMin), 4);

    const after = C.alarmStatus(a, at(2026, 8, 2, 7, 9));
    assert.equal(after.due, true);
  });

  test('การเลื่อนปลุกชนะ lastRung — ปลุกซ้ำได้แม้เคยดังแล้ววันนี้', () => {
    const a = alarm({ snoozedUntil: at(2026, 8, 2, 7, 9).getTime(), lastRung: '2026-08-02' });
    assert.equal(C.alarmStatus(a, at(2026, 8, 2, 7, 10)).due, true);
  });

  test('เลื่อนปลุกข้ามเที่ยงคืนได้', () => {
    const a = alarm({ time: '23:55', snoozedUntil: at(2026, 8, 3, 0, 4).getTime() });
    assert.equal(C.alarmStatus(a, at(2026, 8, 2, 23, 58)).due, false);
    assert.equal(C.alarmStatus(a, at(2026, 8, 3, 0, 5)).due, true);
  });
});

/* ---------------------------------------------------------
   alarmRampGain — เสียงค่อย ๆ ดังขึ้น
   --------------------------------------------------------- */
describe('alarmRampGain', () => {
  test('ปิด ramp → ดังเต็มตั้งแต่วินาทีแรก', () => {
    assert.equal(C.alarmRampGain(0, 0), 1);
    assert.equal(C.alarmRampGain(99, 0), 1);
  });

  test('เริ่มเบาแล้วดังเต็มเมื่อครบเวลา', () => {
    assert.equal(C.alarmRampGain(0, 30), 0.08);
    assert.equal(C.alarmRampGain(30, 30), 1);
  });

  test('ไม่เกิน 1 แม้เลยเวลา ramp ไปแล้ว', () => {
    assert.equal(C.alarmRampGain(300, 30), 1);
  });

  test('เพิ่มขึ้นเรื่อย ๆ ไม่มีย้อนกลับ', () => {
    let prev = -1;
    for (let t = 0; t <= 30; t++) {
      const g = C.alarmRampGain(t, 30);
      assert.ok(g >= prev, `วินาทีที่ ${t} ต้องไม่เบาลง`);
      assert.ok(g >= 0 && g <= 1);
      prev = g;
    }
  });

  test('ครึ่งทางยังไม่ถึงครึ่งความดัง (ease-in) แต่ต้องได้ยินแล้ว', () => {
    const half = C.alarmRampGain(15, 30);
    assert.ok(half > 0.08 && half < 0.5, `ได้ ${half}`);
  });

  test('ปรับ startGain ได้', () => {
    assert.equal(C.alarmRampGain(0, 30, 0.5), 0.5);
    assert.equal(C.alarmRampGain(0, 30, 0), 0);
  });
});

/* ---------------------------------------------------------
   snoozeUntil
   --------------------------------------------------------- */
describe('snoozeUntil', () => {
  test('บวกนาทีที่กำหนด', () => {
    const t = C.snoozeUntil(at(2026, 8, 2, 7, 0), 9);
    assert.equal(t.getHours(), 7);
    assert.equal(t.getMinutes(), 9);
  });

  test('ค่าเริ่มต้น 9 นาที', () => {
    assert.equal(C.snoozeUntil(at(2026, 8, 2, 7, 0)).getMinutes(), 9);
  });

  test('ข้ามเที่ยงคืนได้', () => {
    const t = C.snoozeUntil(at(2026, 8, 2, 23, 55), 10);
    assert.equal(C.dateKey(t), '2026-08-03');
    assert.equal(t.getHours(), 0);
    assert.equal(t.getMinutes(), 5);
  });
});

/* ---------------------------------------------------------
   ข้อมูลเสียงปลุก
   --------------------------------------------------------- */
describe('ALARM_SOUNDS', () => {
  test('มีอย่างน้อย 4 แบบ และแต่ละแบบมีข้อมูลครบ', () => {
    assert.ok(C.ALARM_SOUNDS.length >= 4);
    C.ALARM_SOUNDS.forEach(s => {
      assert.ok(s.id && s.name && s.desc && s.icon);
    });
  });

  test('id ไม่ซ้ำกัน และไม่ชนกับ custom', () => {
    const ids = C.ALARM_SOUNDS.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(!ids.includes('custom'));
  });

  test('alarmSoundOf ถอยกลับไปตัวแรกเมื่อไม่พบ', () => {
    assert.equal(C.alarmSoundOf('siren').id, 'siren');
    assert.equal(C.alarmSoundOf('ไม่มีจริง').id, C.ALARM_SOUNDS[0].id);
  });
});

/* ---------------------------------------------------------
   migrate v3 → v4
   --------------------------------------------------------- */
describe('migrate v3 → v4', () => {
  test('เก็บเวลาปลุกเดิมไว้ และเติมค่าเสียง/ความดังใหม่', () => {
    const s = C.migrate({ version: 3, alarm: { on: true, time: '05:45' } });
    assert.equal(s.version, 4);
    assert.equal(s.alarm.on, true);
    assert.equal(s.alarm.time, '05:45');
    assert.equal(s.alarm.sound, 'classic');
    assert.equal(s.alarm.volume, 100);
    assert.equal(s.alarm.rampSec, 30);
    assert.equal(s.alarm.snoozeMin, 9);
  });

  test('เสียงปลุกดังเต็ม 100 โดยค่าเริ่มต้น (ผลสำรวจบอกว่าเสียงเดิมเบาไป)', () => {
    assert.equal(C.defaults().alarm.volume, 100);
  });

  test('ซ่อมค่าที่อยู่นอกช่วง', () => {
    const s = C.migrate({ version: 4, alarm: { volume: 500, rampSec: 7, snoozeMin: 0, sound: 'ไม่มีจริง' } });
    assert.equal(s.alarm.volume, 100);
    assert.equal(s.alarm.rampSec, 30);     // 7 ไม่ใช่ตัวเลือกที่มี → ใช้ค่าเริ่มต้น
    assert.equal(s.alarm.snoozeMin, 9);
    assert.equal(s.alarm.sound, 'classic');
  });

  test('เลือกเสียงที่อัปโหลดไว้แต่ไฟล์หาย → ถอยไปใช้เสียงมาตรฐาน', () => {
    const s = C.migrate({ version: 4, alarm: { sound: 'custom', customId: null } });
    assert.equal(s.alarm.sound, 'classic');
  });

  test('เลือกเสียงที่อัปโหลดไว้และไฟล์ยังอยู่ → คงไว้', () => {
    const s = C.migrate({ version: 4, alarm: { sound: 'custom', customId: 'snd_123' } });
    assert.equal(s.alarm.sound, 'custom');
    assert.equal(s.alarm.customId, 'snd_123');
  });

  test('อัปเกรดข้ามจาก v1 ถึง v4 ได้ครบ', () => {
    const s = C.migrate({ ageGroup: 'teen', usualWake: '06:00' });
    assert.equal(s.version, 4);
    assert.equal(s.alarm.time, '06:00');    // v2→v3 ตั้งจากเวลาตื่นประจำ
    assert.equal(s.alarm.sound, 'classic'); // v3→v4 เติมค่าเสียง
    assert.equal(s.reminders.log.on, true);
  });

  test('rampSec = 0 (ดังเต็มทันที) เป็นค่าที่ยอมรับได้', () => {
    assert.equal(C.migrate({ version: 4, alarm: { rampSec: 0 } }).alarm.rampSec, 0);
  });
});
