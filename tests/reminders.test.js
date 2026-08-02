/* =========================================================
   TimeSync — unit tests สำหรับระบบเตือน (Phase 1)
   ========================================================= */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

/** state พื้นฐานสำหรับเทสต์ — usualWake 07:00 → เวลานอนปกติ 23:15
    reminders ถูก merge ทีละหมวด เพื่อให้เทสต์ที่ override หมวดเดียวไม่ลบหมวดอื่นทิ้ง */
function baseState(over) {
  const s = Object.assign(C.defaults(), {
    usualWake: '07:00', latency: 15, cycleLen: 90,
    lastBed: '23:30', lastWake: '07:00',
  }, over);
  s.reminders = Object.assign({}, C.defaults().reminders);
  for (const [k, v] of Object.entries((over && over.reminders) || {})) {
    s.reminders[k] = Object.assign({}, s.reminders[k], v);
  }
  // ตารางโหมดง่ายต้องสอดคล้องกับ usualWake ที่เทสต์ตั้ง (ปกติ migrate เป็นคนทำให้)
  s.schedule = { mode: 'simple', simple: { bed: '', wake: s.usualWake }, weekly: {}, overrides: {} };
  return s;
}

/* ---------------------------------------------------------
   usualBedtimeMin
   --------------------------------------------------------- */
describe('usualBedtimeMin', () => {
  test('ถอยหลังจากเวลาตื่น 5 รอบ + เวลาที่ใช้กว่าจะหลับ', () => {
    // 07:00 − (5×90) − 15 = 23:15
    assert.equal(C.minToHM(C.usualBedtimeMin({ usualWake: '07:00', cycleLen: 90, latency: 15 })), '23:15');
  });

  test('ข้ามเที่ยงคืนได้ถูกต้อง', () => {
    // 04:00 − 450 − 15 = 20:15 ของวันก่อนหน้า
    assert.equal(C.minToHM(C.usualBedtimeMin({ usualWake: '04:00', cycleLen: 90, latency: 15 })), '20:15');
    // 12:00 − 450 − 15 = 04:15 ของวันเดียวกัน
    assert.equal(C.minToHM(C.usualBedtimeMin({ usualWake: '12:00', cycleLen: 90, latency: 15 })), '04:15');
  });

  test('เปลี่ยนตาม cycleLen / latency ที่ผู้ใช้ตั้ง', () => {
    // 07:00 − (5×100) − 30 = 22:10
    assert.equal(C.minToHM(C.usualBedtimeMin({ usualWake: '07:00', cycleLen: 100, latency: 30 })), '22:10');
  });
});

/* ---------------------------------------------------------
   nextOccurrence / lastOccurrence
   --------------------------------------------------------- */
describe('nextOccurrence / lastOccurrence', () => {
  const now = at(2026, 8, 2, 14, 0);

  test('เวลาที่ยังไม่ถึง → วันนี้', () => {
    assert.equal(C.dateKey(C.nextOccurrence(C.parseHM('22:00'), now)), '2026-08-02');
  });

  test('เวลาที่ผ่านไปแล้ว → พรุ่งนี้', () => {
    const d = C.nextOccurrence(C.parseHM('09:00'), now);
    assert.equal(C.dateKey(d), '2026-08-03');
    assert.equal(d.getHours(), 9);
  });

  test('lastOccurrence คืนครั้งล่าสุดที่ผ่านมา', () => {
    assert.equal(C.dateKey(C.lastOccurrence(C.parseHM('09:00'), now)), '2026-08-02');
    assert.equal(C.dateKey(C.lastOccurrence(C.parseHM('22:00'), now)), '2026-08-01');
  });

  test('เวลาตรงกับตอนนี้พอดี นับเป็น "ผ่านมาแล้ว"', () => {
    assert.equal(C.dateKey(C.lastOccurrence(C.parseHM('14:00'), now)), '2026-08-02');
    assert.equal(C.dateKey(C.nextOccurrence(C.parseHM('14:00'), now)), '2026-08-03');
  });

  test('ข้ามสิ้นเดือนได้', () => {
    const eom = at(2026, 8, 31, 23, 0);
    assert.equal(C.dateKey(C.nextOccurrence(C.parseHM('06:00'), eom)), '2026-09-01');
  });
});

/* ---------------------------------------------------------
   shouldAskToLog — การ์ดยืนยันคลิกเดียว
   --------------------------------------------------------- */
describe('shouldAskToLog', () => {
  test('ตอนเช้าและยังไม่ได้บันทึก → ถาม พร้อมค่า default จากครั้งล่าสุด', () => {
    const r = C.shouldAskToLog(baseState(), at(2026, 8, 2, 9, 0));
    assert.equal(r.ask, true);
    assert.equal(r.date, '2026-08-02');
    assert.equal(r.bed, '23:30');
    assert.equal(r.wake, '07:00');
    assert.equal(r.hours, 7.5);
  });

  test('บันทึกของวันนี้แล้ว → ไม่ถามซ้ำ', () => {
    const s = baseState({ sleepLogs: { '2026-08-02': { bed: '23:00', wake: '07:00', hours: 8 } } });
    assert.equal(C.shouldAskToLog(s, at(2026, 8, 2, 9, 0)).ask, false);
  });

  test('ผู้ใช้ปิดการ์ดไปแล้ววันนี้ → ไม่ถามอีก', () => {
    const s = baseState({ askDismissed: '2026-08-02' });
    assert.equal(C.shouldAskToLog(s, at(2026, 8, 2, 9, 0)).ask, false);
  });

  test('ปิดการ์ดเมื่อวาน ไม่มีผลกับวันนี้', () => {
    const s = baseState({ askDismissed: '2026-08-01' });
    assert.equal(C.shouldAskToLog(s, at(2026, 8, 2, 9, 0)).ask, true);
  });

  test('ผู้ใช้ใหม่ที่ยังไม่เคยบันทึก → ไม่ถาม (ไม่มีค่า default ให้ยืนยัน)', () => {
    const s = baseState({ lastBed: '', lastWake: '' });
    assert.equal(C.shouldAskToLog(s, at(2026, 8, 2, 9, 0)).ask, false);
  });

  test('กลางดึกไม่ถาม เพราะยังไม่ได้นอน', () => {
    assert.equal(C.shouldAskToLog(baseState(), at(2026, 8, 2, 2, 0)).ask, false);
    assert.equal(C.shouldAskToLog(baseState(), at(2026, 8, 2, 22, 0)).ask, false);
  });

  test('ขอบของช่วงเวลาถาม (05:00–19:59)', () => {
    assert.equal(C.shouldAskToLog(baseState(), at(2026, 8, 2, 4, 59)).ask, false);
    assert.equal(C.shouldAskToLog(baseState(), at(2026, 8, 2, 5, 0)).ask, true);
    assert.equal(C.shouldAskToLog(baseState(), at(2026, 8, 2, 19, 59)).ask, true);
    assert.equal(C.shouldAskToLog(baseState(), at(2026, 8, 2, 20, 0)).ask, false);
  });

  test('ค่า default ที่ข้ามเที่ยงคืนคำนวณชั่วโมงถูก', () => {
    const s = baseState({ lastBed: '01:30', lastWake: '08:00' });
    assert.equal(C.shouldAskToLog(s, at(2026, 8, 2, 10, 0)).hours, 6.5);
  });
});

/* ---------------------------------------------------------
   dueReminders
   --------------------------------------------------------- */
describe('dueReminders', () => {
  const ids = list => list.map(r => r.id).sort();

  test('ยังไม่ถึงเวลาใด ๆ → ไม่มีการเตือน', () => {
    // 17:00 — เลย grace ของ log (10:00 + 6 ชม.) และยังไม่ถึง bedtime 22:45 / alarmMissing 23:15
    assert.deepEqual(ids(C.dueReminders(baseState(), at(2026, 8, 2, 17, 0))), []);
  });

  test('ถึงเวลาเตือนบันทึกการนอน', () => {
    const r = C.dueReminders(baseState(), at(2026, 8, 2, 10, 0));
    assert.deepEqual(ids(r), ['log']);
    assert.equal(r[0].key, 'log:2026-08-02');
    assert.match(r[0].body, /23:30–07:00/);
    assert.equal(r[0].tab, 'debt');
  });

  test('บันทึกวันนี้แล้ว → ไม่เตือนให้บันทึก', () => {
    const s = baseState({ sleepLogs: { '2026-08-02': { bed: '23:00', wake: '07:00', hours: 8 } } });
    assert.deepEqual(ids(C.dueReminders(s, at(2026, 8, 2, 10, 0))), []);
  });

  test('ตามเก็บได้ถ้าเปิดแอปช้า แต่ไม่เกิน grace', () => {
    const s = baseState();
    // grace ของ log = 360 นาที → 15:00 ยังทัน, 16:30 เลยแล้ว
    assert.deepEqual(ids(C.dueReminders(s, at(2026, 8, 2, 15, 59))), ['log']);
    assert.deepEqual(ids(C.dueReminders(s, at(2026, 8, 2, 16, 1))), []);
  });

  test('บอกได้ว่าเลยเวลามากี่นาที', () => {
    const r = C.dueReminders(baseState(), at(2026, 8, 2, 10, 45));
    assert.equal(r[0].lateMin, 45);
  });

  test('ยิงแล้วต้องไม่ยิงซ้ำในวันเดียวกัน', () => {
    const s = baseState();
    const now = at(2026, 8, 2, 10, 0);
    const first = C.dueReminders(s, now);
    assert.equal(first.length, 1);
    C.markFired(s, first[0].key);
    assert.deepEqual(C.dueReminders(s, now), []);
    // แต่วันถัดไปต้องยิงใหม่ได้
    assert.deepEqual(ids(C.dueReminders(s, at(2026, 8, 3, 10, 0))), ['log']);
  });

  test('เตือนก่อนถึงเวลานอนตาม leadMin', () => {
    // เวลานอนปกติ 23:15, lead 30 → เตือน 22:45
    const s = baseState({ sleepLogs: { '2026-08-02': { bed: '1', wake: '2', hours: 8 } } });
    assert.deepEqual(ids(C.dueReminders(s, at(2026, 8, 2, 22, 44))), []);
    const r = C.dueReminders(s, at(2026, 8, 2, 22, 45));
    assert.deepEqual(ids(r), ['bedtime']);
    assert.match(r[0].body, /อีก 30 นาที ถึงเวลาเข้านอน \(23:15\)/);
  });

  test('leadMin = 0 → เตือนตรงเวลานอนพอดี ข้อความเปลี่ยนไป', () => {
    const s = baseState({
      sleepLogs: { '2026-08-02': { bed: '1', wake: '2', hours: 8 } },
      reminders: { log: { on: false }, bedtime: { on: true, leadMin: 0 }, alarmMissing: { on: false } },
    });
    const r = C.dueReminders(s, at(2026, 8, 2, 23, 15));
    assert.deepEqual(ids(r), ['bedtime']);
    assert.match(r[0].body, /ถึงเวลาเข้านอน \(23:15\) แล้ว/);
  });

  test('ถึงเวลานอนแล้วยังไม่ได้ตั้งปลุก → เตือน', () => {
    const s = baseState({ sleepLogs: { '2026-08-02': { bed: '1', wake: '2', hours: 8 } } });
    const r = C.dueReminders(s, at(2026, 8, 2, 23, 15));
    assert.ok(ids(r).includes('alarmMissing'));
    assert.equal(r.find(x => x.id === 'alarmMissing').tab, 'calc');
  });

  test('ตั้งปลุกไว้แล้ว → ไม่เตือนเรื่องปลุก', () => {
    const s = baseState({
      sleepLogs: { '2026-08-02': { bed: '1', wake: '2', hours: 8 } },
      alarm: { on: true, time: '07:00' },
    });
    assert.ok(!ids(C.dueReminders(s, at(2026, 8, 2, 23, 15))).includes('alarmMissing'));
  });

  test('ปิดตัวเตือนรายตัวได้', () => {
    const s = baseState({
      reminders: { log: { on: false }, bedtime: { on: false }, alarmMissing: { on: false } },
    });
    assert.deepEqual(ids(C.dueReminders(s, at(2026, 8, 2, 10, 0))), []);
    assert.deepEqual(ids(C.dueReminders(s, at(2026, 8, 2, 23, 15))), []);
  });

  test('เตือนงานตอนเช้า พร้อมสรุปงานที่ยังไม่เสร็จ', () => {
    const s = baseState({
      remindOn: true, remindTime: '07:00',
      sleepLogs: { '2026-08-02': { bed: '1', wake: '2', hours: 8 } },
      tasks: [
        { id: 1, text: 'ส่งรายงาน', pri: 'high', done: false },
        { id: 2, text: 'ซื้อนม', pri: 'normal', done: true },
      ],
    });
    const r = C.dueReminders(s, at(2026, 8, 2, 7, 0));
    const m = r.find(x => x.id === 'morning');
    assert.ok(m);
    assert.match(m.body, /• ส่งรายงาน/);
    assert.ok(!m.body.includes('ซื้อนม'));
    assert.equal(m.pending.length, 1);
  });

  test('งานเกิน 3 รายการ ย่อเหลือ 3 + จำนวนที่เหลือ', () => {
    const tasks = [1, 2, 3, 4, 5].map(i => ({ id: i, text: 'งาน ' + i, pri: 'normal', done: false }));
    const s = baseState({
      remindOn: true, remindTime: '07:00', tasks,
      sleepLogs: { '2026-08-02': { bed: '1', wake: '2', hours: 8 } },
    });
    const m = C.dueReminders(s, at(2026, 8, 2, 7, 0)).find(x => x.id === 'morning');
    assert.match(m.body, /…และอีก 2 รายการ/);
  });

  test('เตือนหลายอย่างพร้อมกันได้', () => {
    // 23:15 = เวลานอนพอดี → alarmMissing ตรงเวลา, bedtime เลยมา 30 นาที (ยังอยู่ใน grace 45),
    // และตั้ง log ไว้ที่เวลาเดียวกัน
    const s = baseState({ reminders: { log: { time: '23:15' } } });
    assert.deepEqual(ids(C.dueReminders(s, at(2026, 8, 2, 23, 15))), ['alarmMissing', 'bedtime', 'log']);
  });

  test('เวลานอนหลังเที่ยงคืนก็ยังเตือนถูกวัน', () => {
    // ตื่น 09:00 → เวลานอนปกติ = 09:00 − 450 − 15 = 01:15
    const s = baseState({
      usualWake: '09:00',
      sleepLogs: { '2026-08-02': { bed: '1', wake: '2', hours: 8 } },
      reminders: { log: { on: false }, bedtime: { on: true, leadMin: 0 }, alarmMissing: { on: false } },
    });
    const r = C.dueReminders(s, at(2026, 8, 2, 1, 20));
    assert.deepEqual(ids(r), ['bedtime']);
    assert.equal(r[0].key, 'bedtime:2026-08-02');
  });
});

/* ---------------------------------------------------------
   markFired
   --------------------------------------------------------- */
describe('markFired', () => {
  test('บันทึกคีย์ที่ยิงแล้ว', () => {
    const s = C.defaults();
    C.markFired(s, 'log:2026-08-02');
    assert.ok(s.fired['log:2026-08-02']);
  });

  test('ตัดประวัติเก่าทิ้งเมื่อเกินเพดาน ไม่ให้ state บวม', () => {
    const s = C.defaults();
    for (let i = 0; i < 100; i++) {
      s.fired['old:' + i] = i;          // timestamp เรียงจากเก่าไปใหม่
    }
    C.markFired(s, 'new:key', 10);
    const keys = Object.keys(s.fired);
    assert.equal(keys.length, 10);
    assert.ok(keys.includes('new:key'));
    assert.ok(!keys.includes('old:0'));  // เก่าสุดถูกตัดทิ้ง
    assert.ok(keys.includes('old:99'));  // ใหม่สุดยังอยู่
  });
});

/* ---------------------------------------------------------
   migrate v2 → v3
   --------------------------------------------------------- */
describe('migrate v2 → v3', () => {
  test('เพิ่มโครงสร้างใหม่โดยไม่ทำข้อมูลเดิมหาย', () => {
    const v2 = {
      version: 2, ageGroup: 'adult', usualWake: '06:00',
      sleepLogs: { '2026-08-01': { bed: '23:00', wake: '07:00', hours: 8 } },
      tasks: [{ id: 1, text: 'งานเดิม', pri: 'high', done: false }],
    };
    const s = C.migrate(v2);
    assert.equal(s.version, C.STATE_VERSION);
    assert.deepEqual(s.sleepLogs, v2.sleepLogs);
    assert.deepEqual(s.tasks, v2.tasks);
    assert.equal(s.reminders.log.on, true);
    assert.equal(s.alarm.on, false);
    assert.deepEqual(s.fired, {});
  });

  test('ผู้ใช้เดิมได้ค่า default การนอนจากบันทึกล่าสุดทันที', () => {
    const s = C.migrate({
      version: 2,
      sleepLogs: {
        '2026-07-28': { bed: '22:00', wake: '06:00', hours: 8 },
        '2026-08-01': { bed: '23:45', wake: '07:15', hours: 7.5 },   // ล่าสุด
        '2026-07-30': { bed: '01:00', wake: '08:00', hours: 7 },
      },
    });
    assert.equal(s.lastBed, '23:45');
    assert.equal(s.lastWake, '07:15');
  });

  test('เวลาปลุกเริ่มต้นตามเวลาตื่นประจำที่ผู้ใช้ตั้งไว้', () => {
    assert.equal(C.migrate({ version: 2, usualWake: '05:30' }).alarm.time, '05:30');
  });

  test('ผู้ใช้ใหม่ไม่มีบันทึก → lastBed/lastWake ว่าง', () => {
    const s = C.migrate({ version: 2 });
    assert.equal(s.lastBed, '');
    assert.equal(s.lastWake, '');
  });

  test('อัปเกรดข้ามจาก v1 ตรงถึงเวอร์ชันล่าสุดได้', () => {
    const s = C.migrate({ ageGroup: 'teen', usualWake: '06:00', volume: 80 });   // ไม่มี version = v1
    assert.equal(s.version, C.STATE_VERSION);
    assert.equal(s.ageGroup, 'teen');
    assert.equal(s.volume, 80);
    assert.equal(s.alarm.time, '06:00');
    assert.ok(s.reminders.bedtime);
  });

  test('ซ่อม reminders ที่ไม่ครบ โดยคงค่าที่ผู้ใช้ตั้งไว้', () => {
    const s = C.migrate({ version: 3, reminders: { log: { time: '11:30' } } });
    assert.equal(s.reminders.log.time, '11:30');
    assert.equal(s.reminders.log.on, true);          // เติมจากค่าเริ่มต้น
    assert.equal(s.reminders.bedtime.leadMin, 30);   // หมวดที่หายไปทั้งก้อน
  });

  test('ซ่อมชนิดข้อมูลที่ผิด', () => {
    const s = C.migrate({ version: 3, alarm: 'พัง', reminders: 42, fired: null });
    assert.equal(s.alarm.on, false);
    assert.equal(s.reminders.log.on, true);
    assert.deepEqual(s.fired, {});
  });
});
