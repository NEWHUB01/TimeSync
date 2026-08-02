/* =========================================================
   TimeSync — app.js
   ข้อมูลทั้งหมดเก็บใน localStorage ของเครื่องผู้ใช้เท่านั้น
   ========================================================= */

/* ---------- ตรรกะการคำนวณทั้งหมดอยู่ใน core.js (เขียน unit test แยก) ---------- */
const C = window.TimeSyncCore;
const {
  pad, clamp, parseHM, minToHM, dateKey, keyToDate, addDays,
  durText, hoursText, hoursBetween,
  TH_DAY, TH_MON, AGE_GROUPS, FATIGUE, ageGroupOf,
  planBedtime, cycleOptions, computeDebt,
  usualBedtimeMin, nextOccurrence, shouldAskToLog, dueReminders, markFired,
  ALARM_SOUNDS, RAMP_OPTIONS, SNOOZE_OPTIONS, alarmSoundOf, alarmStatus, snoozeUntil,
} = C;
const { Alarm, Uploads } = window.TimeSyncAlarm;

/* ---------- helpers ของชั้น UI ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- state ----------
   sleepLogs   { 'YYYY-MM-DD': {bed:'23:30', wake:'07:00', hours:7.5} }
   fatigueLogs { 'YYYY-MM-DD': {lvl:3, at:'21:40'} }
   tasks       [{id, text, pri, done}]
   โครงสร้าง + ค่าเริ่มต้น + การอัปเกรดเวอร์ชัน อยู่ใน core.js */
const KEY = 'timesync.state';
const LEGACY_KEYS = ['timesync.v1'];

let S = load();

function load() {
  for (const k of [KEY, ...LEGACY_KEYS]) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) return C.migrate(JSON.parse(raw));
    } catch { /* ข้อมูลเสีย → ลองคีย์ถัดไป */ }
  }
  return C.defaults();
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch { toast('บันทึกข้อมูลไม่สำเร็จ (พื้นที่เก็บข้อมูลเต็ม)'); }
}

/* =========================================================
   ฉากหลัง + นาฬิกา + แท็บ
   ========================================================= */
function makeStars() {
  const box = $('#stars');
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 70; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    const size = Math.random() * 2 + 1;
    s.style.cssText = `width:${size}px;height:${size}px;left:${Math.random() * 100}%;` +
      `top:${Math.random() * 100}%;animation-duration:${2 + Math.random() * 5}s;` +
      `animation-delay:${Math.random() * 5}s`;
    frag.appendChild(s);
  }
  box.appendChild(frag);
}

function tickClock() {
  const d = new Date();
  $('#clockTime').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  $('#clockDate').textContent = `วัน${TH_DAY[d.getDay()]} ${d.getDate()} ${TH_MON[d.getMonth()]} ${d.getFullYear() + 543}`;
  $('#clockAlarm').classList.toggle('hidden', !S.alarm.on);
  $('#clockAlarmTime').textContent = S.alarm.time;
}

function goTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab');
  if (b) goTab(b.dataset.tab);
});

/* =========================================================
   1) ฟังก์ชันระบุความเหนื่อยล้า
   ========================================================= */
function renderEmojiRow() {
  const row = $('#emojiRow');
  row.innerHTML = FATIGUE.map(f =>
    `<button class="emoji-btn" data-lvl="${f.lvl}">
       <span class="e">${f.emoji}</span><span class="n">${f.short}</span>
     </button>`).join('');
  row.addEventListener('click', e => {
    const b = e.target.closest('.emoji-btn');
    if (!b) return;
    selectFatigue(Number(b.dataset.lvl));
  });
}

function selectFatigue(lvl, silent) {
  $$('.emoji-btn').forEach(b => b.classList.toggle('sel', Number(b.dataset.lvl) === lvl));
  const f = FATIGUE.find(x => x.lvl === lvl);
  const plan = planBedtime(f, S, new Date());

  $('#fatigueResult').classList.remove('hidden');
  $('#rEmoji').textContent = f.emoji;
  $('#rLabel').textContent = f.label;
  $('#rDesc').textContent = f.desc;
  const meter = $('#rMeter');
  meter.style.width = (lvl / 5 * 100) + '%';
  meter.style.background = `linear-gradient(90deg, ${f.color}88, ${f.color})`;

  $('#rBedtime').textContent = plan.bedLabel;
  $('#rBedNote').textContent = plan.bedNote;
  $('#rWake').textContent = minToHM(plan.wakeMin);
  $('#rWakeNote').textContent = `นอน ${durText(f.cycles * S.cycleLen)} (${f.cycles} รอบการนอน)`;

  $('#rTips').innerHTML = [...plan.extraTips, ...f.tips].map(t => `<li>${t}</li>`).join('');

  if (!silent) {
    const now = new Date();
    S.fatigueLogs[dateKey(now)] = { lvl, at: `${pad(now.getHours())}:${pad(now.getMinutes())}` };
    save();
    renderFatigueHistory();
  }
}

function renderFatigueHistory() {
  const box = $('#fatigueHistory');
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(new Date(), -i);
    const rec = S.fatigueLogs[dateKey(d)];
    const f = rec ? FATIGUE.find(x => x.lvl === rec.lvl) : null;
    out.push(`<div class="fh-item">
      <div class="fh-e">${f ? f.emoji : '·'}</div>
      <div class="fh-d">${d.getDate()} ${TH_MON[d.getMonth()]}</div>
    </div>`);
  }
  box.innerHTML = Object.keys(S.fatigueLogs).length ? out.join('') : '<p class="empty">ยังไม่มีบันทึก</p>';
}

$('#fatigueToCalc').addEventListener('click', () => goTab('calc'));
$('#fatigueToRelax').addEventListener('click', () => goTab('relax'));

/* =========================================================
   2) ฟังก์ชันคำนวณเวลานอนที่เหมาะสม
   ========================================================= */
let calcMode = 'now';
const QUICK_BED  = ['21:00', '21:30', '22:00', '22:30', '23:00', '23:30', '00:00', '01:00'];
const QUICK_WAKE = ['05:00', '05:30', '06:00', '06:30', '07:00', '07:30', '08:00', '09:00'];

$('#calcMode').addEventListener('click', e => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  calcMode = b.dataset.mode;
  $$('#calcMode .seg-btn').forEach(x => x.classList.toggle('active', x === b));
  syncCalcInput();
  renderCycles();
});
$('#calcTime').addEventListener('input', renderCycles);
$('#quickTimes').addEventListener('click', e => {
  const c = e.target.closest('.chip');
  if (!c) return;
  $('#calcTime').value = c.dataset.t;
  renderCycles();
});

function syncCalcInput() {
  const wrap = $('#calcInputWrap');
  if (calcMode === 'now') { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  const isBed = calcMode === 'bed';
  $('#calcInputLabel').textContent = isBed ? 'เวลาที่คุณจะเข้านอน' : 'เวลาที่คุณต้องตื่น';
  $('#calcTime').value = isBed ? '23:00' : S.usualWake;
  $('#quickTimes').innerHTML = (isBed ? QUICK_BED : QUICK_WAKE)
    .map(t => `<button class="chip" data-t="${t}">${t}</button>`).join('');
}

function renderCycles() {
  const note = $('#calcNote');
  let timeMin, verb;

  if (calcMode === 'wake') {
    timeMin = parseHM($('#calcTime').value);
    verb = 'เข้านอน';
    note.innerHTML = `ถ้าต้องตื่นเวลา <b>${minToHM(timeMin)}</b> คุณควรเข้านอนตามเวลาใดเวลาหนึ่งด้านล่างนี้ ` +
      `(เผื่อเวลาหลับ ${S.latency} นาที)`;
  } else {
    verb = 'ตื่น';
    let head;
    if (calcMode === 'now') {
      const now = new Date();
      timeMin = now.getHours() * 60 + now.getMinutes();
      head = `ถ้าคุณเข้านอน <b>ตอนนี้ (${minToHM(timeMin)})</b>`;
    } else {
      timeMin = parseHM($('#calcTime').value);
      head = `ถ้าคุณเข้านอนเวลา <b>${minToHM(timeMin)}</b>`;
    }
    note.innerHTML = `${head} และใช้เวลาราว ${S.latency} นาทีกว่าจะหลับ ควรตั้งนาฬิกาปลุกไว้ที่:`;
  }

  const wakeRow = calcMode !== 'wake';    // โหมดนี้เท่านั้นที่แถวคือ "เวลาตื่น" → ตั้งปลุกได้
  $('#cycleList').innerHTML = cycleOptions(calcMode, timeMin, S)
    .map(o => cycleRow(o, verb, wakeRow)).join('');
}

// ตั้งปลุกจากเวลาตื่นที่แนะนำ — คลิกเดียวจากหน้าที่ผู้ใช้ดูอยู่แล้ว ไม่ต้องเปิดหน้าใหม่
$('#cycleList').addEventListener('click', e => {
  const b = e.target.closest('.cycle-alarm');
  if (!b) return;
  setAlarm(b.dataset.time, true);
  toast(`ตั้งปลุกไว้ที่ ${b.dataset.time} ⏰`);
});

const RANK_TAG = {
  best: '<span class="cycle-tag tag-best">แนะนำ</span>',
  ok:   '<span class="cycle-tag tag-ok">พอได้</span>',
  min:  '<span class="cycle-tag tag-min">ขั้นต่ำ</span>',
};

function cycleRow(o, verb, canSetAlarm) {
  const isSet = S.alarm.on && S.alarm.time === o.time;
  const alarmBtn = canSetAlarm
    ? `<button class="cycle-alarm ${isSet ? 'set' : ''}" data-time="${o.time}"
         title="${isSet ? 'ตั้งปลุกเวลานี้ไว้แล้ว' : 'ตั้งปลุกเวลานี้'}">⏰</button>`
    : '';
  return `<div class="cycle-row ${o.rank === 'best' ? 'best' : ''}">
    <div class="cycle-time">${o.time}</div>
    <div class="cycle-meta">
      <div class="cycle-main">${verb} หลังนอน ${o.cycles} รอบ · ${o.totalText}</div>
      <div class="cycle-sub">${o.desc}</div>
    </div>${RANK_TAG[o.rank]}${alarmBtn}
  </div>`;
}

/* =========================================================
   3) ฟังก์ชันจัดการหนี้การนอนสะสม
   ========================================================= */
$('#logSave').addEventListener('click', () => {
  const date = $('#logDate').value;
  if (!date) { toast('กรุณาเลือกวันที่'); return; }
  logSleep(date, $('#logBed').value, $('#logWake').value);
});

// อัปเดตตัวอย่างจำนวนชั่วโมงทันทีที่ผู้ใช้เปลี่ยนเวลา
['#logBed', '#logWake'].forEach(sel => $(sel).addEventListener('input', () => {
  const h = hoursBetween($('#logBed').value, $('#logWake').value);
  $('#logHint').textContent = h <= 16
    ? `= นอน ${hoursText(h)}`
    : 'ระยะเวลานอนดูจะยาวผิดปกติ ลองตรวจสอบเวลาอีกครั้ง';
}));

$('#logList').addEventListener('click', e => {
  const b = e.target.closest('.log-del');
  if (!b) return;
  delete S.sleepLogs[b.dataset.k];
  save();
  renderDebt();
});

function renderDebt() {
  const r = computeDebt(S.sleepLogs, S, new Date());
  $('#debtWindowLabel').textContent = S.debtWindow;
  $('#debtNum').textContent = r.debt.toFixed(1);
  $('#debtBadge').classList.toggle('ok', r.debt < 1);

  $('#ageLabel').textContent = r.group.label.replace(/\s*\(.*\)/, '');
  $('#recLabel').textContent = `${r.group.min}–${r.group.max} ชม.`;
  $('#avgLabel').textContent = r.logged ? `${r.avg.toFixed(1)} ชม.` : '—';

  let status, plan;
  if (!r.logged) {
    status = 'ยังไม่มีข้อมูล';
    plan = 'เริ่มบันทึกการนอนของคุณด้านล่าง เพียง 3–4 วัน TimeSync ก็จะประเมินหนี้การนอนสะสมของคุณได้แล้ว';
  } else if (r.debt < 1) {
    status = 'สมดุลดี ✅';
    plan = `เยี่ยมมาก คุณนอนเฉลี่ย ${r.avg.toFixed(1)} ชม./คืน ซึ่งอยู่ในเกณฑ์ที่ร่างกายต้องการ รักษาเวลาเข้านอนเดิมไว้ต่อไป`;
  } else if (r.debt < 5) {
    status = 'หนี้เล็กน้อย ⚠️';
    plan = `คุณค้างการนอนอยู่ <b>${hoursText(r.debt)}</b> — ชดเชยได้ด้วยการเข้านอนเร็วขึ้นคืนละ 30–45 นาที ` +
      `ประมาณ ${Math.ceil(r.debt / 0.75)} คืน ก็กลับมาสมดุล`;
  } else if (r.debt < 12) {
    status = 'หนี้สะสมสูง 🚨';
    plan = `คุณค้างการนอนอยู่ <b>${hoursText(r.debt)}</b> ซึ่งส่งผลต่อสมาธิและอารมณ์แล้ว ` +
      `แนะนำให้เข้านอนเร็วขึ้นคืนละ 1 ชั่วโมง ติดต่อกัน ${Math.ceil(r.debt)} คืน และห้ามชดเชยด้วยการนอนยาวรวดเดียววันหยุด`;
  } else {
    status = 'หนี้หนักมาก 🚨';
    plan = `หนี้การนอนสะสม <b>${hoursText(r.debt)}</b> ถือว่าอยู่ในระดับที่กระทบสุขภาพ ` +
      `ควรทยอยคืนคืนละ 1–1.5 ชม. เป็นเวลาอย่างน้อย ${Math.ceil(r.debt / 1.5)} คืน ` +
      `หากยังตื่นมาไม่สดชื่นแม้จะนอนครบ ควรปรึกษาแพทย์เรื่องคุณภาพการนอน`;
  }
  $('#statusLabel').textContent = status;
  $('#debtPlan').innerHTML = plan;

  // กราฟ
  $('#debtChart').innerHTML = r.days.map(d => {
    const h = d.rec ? d.rec.hours : 0;
    const pct = clamp(h / (r.target + 2) * 100, 0, 100);
    let cls = 'none';
    if (d.rec) cls = h >= r.target ? 'full' : (h >= r.target - 1.5 ? 'part' : 'low');
    const tip = d.rec ? `${d.date.getDate()} ${TH_MON[d.date.getMonth()]} · ${d.rec.hours} ชม.` : 'ไม่มีข้อมูล';
    return `<div class="bar-wrap">
      <div class="bar-tip">${tip}</div>
      <div class="bar ${cls}" style="height:${d.rec ? pct : 4}%"></div>
      <div class="bar-lab">${d.date.getDate()}</div>
    </div>`;
  }).join('');

  // รายการบันทึก
  const items = Object.keys(S.sleepLogs).sort().reverse().slice(0, 30).map(k => {
    const rec = S.sleepLogs[k];
    const d = keyToDate(k);
    const diff = rec.hours - r.target;
    const dc = diff < 0 ? 'diff-neg' : 'diff-pos';
    const dt = diff < 0 ? `ขาด ${hoursText(-diff)}` : (diff === 0 ? 'พอดี' : `เกิน ${hoursText(diff)}`);
    return `<div class="log-item">
      <span class="log-date">${d.getDate()} ${TH_MON[d.getMonth()]} ${String(d.getFullYear() + 543).slice(-2)}</span>
      <span class="log-hours">${rec.hours} ชม.</span>
      <span class="log-diff ${dc}">${rec.bed}–${rec.wake} · ${dt}</span>
      <button class="log-del" data-k="${k}" title="ลบ">×</button>
    </div>`;
  });
  $('#logList').innerHTML = items.length ? items.join('') : '<p class="empty">ยังไม่มีบันทึกการนอน</p>';
}

function renderSleepChartTable() {
  $('#sleepChartTable').innerHTML = AGE_GROUPS.map(g =>
    `<tr class="${g.id === S.ageGroup ? 'me' : ''}"><td>${g.label}</td><td>${g.min}–${g.max} ชม.</td></tr>`
  ).join('');
}

/* =========================================================
   4) ฟังก์ชันเสียงผ่อนคลาย (สังเคราะห์เสียงด้วย Web Audio API)
   ========================================================= */
const SOUNDS = [
  { id: 'rain',  icon: '🌧️', name: 'เสียงฝน',       desc: 'ฝนโปรยบนหลังคา' },
  { id: 'ocean', icon: '🌊', name: 'คลื่นทะเล',      desc: 'คลื่นซัดฝั่งช้า ๆ' },
  { id: 'wind',  icon: '🌬️', name: 'สายลม',          desc: 'ลมพัดผ่านต้นไม้' },
  { id: 'fire',  icon: '🔥', name: 'กองไฟ',          desc: 'ฟืนแตกเบา ๆ' },
  { id: 'piano', icon: '🎹', name: 'เปียโนกล่อมนอน', desc: 'โน้ตเนิบช้าไร้ทำนองซ้ำ' },
  { id: 'brown', icon: '🌀', name: 'Brown Noise',    desc: 'กลบเสียงรบกวนรอบตัว' },
];

const Sound = {
  ctx: null, master: null, bus: null, current: null, stopFns: [],
  timerId: null, timerEnd: null, tickId: null,

  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = S.volume / 100;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  noiseBuffer(type) {
    const ctx = this.ctx, len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else d[i] = w;
    }
    return buf;
  },

  noiseSource(type) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(type);
    src.loop = true;
    return src;
  },

  lfo(freq, min, max, param) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.value = freq;
    g.gain.value = (max - min) / 2;
    param.value = (max + min) / 2;
    osc.connect(g).connect(param);
    osc.start();
    return osc;
  },

  play(id) {
    this.init();
    if (this.current === id) { this.stop(); return; }
    if (this.current) this.fadeOut(0.4);      // ครอสเฟดจากเสียงเดิม
    this.current = id;

    const ctx = this.ctx;
    this.bus = ctx.createGain();
    this.bus.gain.setValueAtTime(0, ctx.currentTime);
    this.bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);   // fade in
    this.bus.connect(this.master);

    ({
      rain:  () => this.buildRain(),
      ocean: () => this.buildOcean(),
      wind:  () => this.buildWind(),
      fire:  () => this.buildFire(),
      brown: () => this.buildBrown(),
      piano: () => this.buildPiano(),
    })[id]();

    this.renderUI();
  },

  buildRain() {
    const ctx = this.ctx;
    const src = this.noiseSource('white');
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 420;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';  lp.Q.value = 0.6;
    const g  = ctx.createGain(); g.gain.value = 0.34;
    src.connect(hp).connect(lp).connect(g).connect(this.bus);
    const l = this.lfo(0.07, 1100, 2400, lp.frequency);
    src.start();
    this.stopFns.push(() => { src.stop(); l.stop(); });
  },

  buildOcean() {
    const ctx = this.ctx;
    const src = this.noiseSource('brown');
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 620;
    const g  = ctx.createGain();
    src.connect(lp).connect(g).connect(this.bus);
    const l = this.lfo(0.075, 0.06, 0.75, g.gain);       // จังหวะคลื่นเข้า-ออก
    const l2 = this.lfo(0.05, 380, 950, lp.frequency);
    src.start();
    this.stopFns.push(() => { src.stop(); l.stop(); l2.stop(); });
  },

  buildWind() {
    const ctx = this.ctx;
    const src = this.noiseSource('brown');
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    const g  = ctx.createGain(); g.gain.value = 0.9;
    src.connect(bp).connect(g).connect(this.bus);
    const l = this.lfo(0.06, 280, 1100, bp.frequency);
    const l2 = this.lfo(0.11, 0.45, 1.1, g.gain);
    src.start();
    this.stopFns.push(() => { src.stop(); l.stop(); l2.stop(); });
  },

  buildBrown() {
    const ctx = this.ctx;
    const src = this.noiseSource('brown');
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 850;
    const g  = ctx.createGain(); g.gain.value = 0.55;
    src.connect(lp).connect(g).connect(this.bus);
    src.start();
    this.stopFns.push(() => src.stop());
  },

  buildFire() {
    const ctx = this.ctx;
    // ฐาน: เสียงลมไฟทุ้ม
    const src = this.noiseSource('brown');
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const g  = ctx.createGain(); g.gain.value = 0.45;
    src.connect(lp).connect(g).connect(this.bus);
    src.start();

    // เสียงฟืนแตก
    const crackle = () => {
      const t = ctx.currentTime;
      const n = ctx.createBufferSource(); n.buffer = this.noiseBuffer('white');
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 900 + Math.random() * 2600; bp.Q.value = 6;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0, t);
      cg.gain.linearRampToValueAtTime(0.25 + Math.random() * 0.35, t + 0.004);
      cg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      n.connect(bp).connect(cg).connect(this.bus);
      n.start(t); n.stop(t + 0.12);
    };
    const iv = setInterval(() => { for (let i = Math.random() * 3 | 0; i >= 0; i--) crackle(); }, 260);
    this.stopFns.push(() => { src.stop(); clearInterval(iv); });
  },

  buildPiano() {
    const ctx = this.ctx;
    // A minor pentatonic กระจายหลายอ็อกเทฟ — ฟังนุ่ม ไม่มีคอร์ดขัดหู
    const notes = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 784];
    const delay = ctx.createDelay(3);
    delay.delayTime.value = 0.62;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const wet = ctx.createGain(); wet.gain.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(lp).connect(this.bus);

    const pluck = () => {
      const t = ctx.currentTime;
      const f = notes[Math.random() * notes.length | 0];
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
      const g = ctx.createGain();
      const g2 = ctx.createGain(); g2.gain.value = 0.18;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 3.4);
      o.connect(g); o2.connect(g2).connect(g);
      g.connect(this.bus); g.connect(delay);
      o.start(t); o2.start(t); o.stop(t + 3.6); o2.stop(t + 3.6);
    };
    pluck();
    const iv = setInterval(() => { if (Math.random() < 0.78) pluck(); }, 1900);
    this.stopFns.push(() => clearInterval(iv));
  },

  /** ค่อย ๆ ลดเสียงชุดปัจจุบันแล้วปลดโหนดทิ้ง (ไม่แตะสถานะ current) */
  fadeOut(fadeSec) {
    const bus = this.bus, fns = this.stopFns;
    this.stopFns = []; this.bus = null;
    if (!bus) { fns.forEach(f => { try { f(); } catch {} }); return; }
    const t = this.ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(0.0001, t + fadeSec);
    setTimeout(() => {
      fns.forEach(f => { try { f(); } catch {} });
      try { bus.disconnect(); } catch {}
    }, fadeSec * 1000 + 80);
  },

  stop(fadeSec = 0.8) {
    if (!this.current) return;
    this.current = null;
    this.fadeOut(fadeSec);
    this.clearTimer();
    this.renderUI();
  },

  setVolume(v) {
    S.volume = v; save();
    $('#volLabel').textContent = v + '%';
    if (this.master) this.master.gain.setTargetAtTime(v / 100, this.ctx.currentTime, 0.05);
  },

  setTimer(min) {
    this.clearTimer();
    if (!min) { $('#timerStatus').textContent = ''; return; }
    this.timerEnd = Date.now() + min * 60000;
    this.timerId = setTimeout(() => {
      this.stop(20);                    // ค่อย ๆ เบาลง 20 วินาที
      toast('ถึงเวลาปิดเสียงแล้ว ราตรีสวัสดิ์ 🌙');
    }, min * 60000);
    this.tickId = setInterval(() => this.renderTimer(), 1000);
    this.renderTimer();
  },

  clearTimer() {
    clearTimeout(this.timerId); clearInterval(this.tickId);
    this.timerId = this.tickId = null; this.timerEnd = null;
    $$('#timerRow .chip').forEach(c => c.classList.toggle('on', c.dataset.m === '0'));
    $('#timerStatus').textContent = '';
  },

  renderTimer() {
    if (!this.timerEnd) return;
    const left = Math.max(0, this.timerEnd - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor(left % 60000 / 1000);
    $('#timerStatus').textContent = `⏳ เสียงจะค่อย ๆ เบาลงและปิดเองในอีก ${m}:${pad(s)}`;
  },

  renderUI() {
    $$('.sound-btn').forEach(b => b.classList.toggle('playing', b.dataset.id === this.current));
    const s = SOUNDS.find(x => x.id === this.current);
    $('#nowPlaying').textContent = s ? `กำลังเล่น: ${s.name}` : 'ยังไม่ได้เล่นเสียง';
    $('#playerSub').textContent = s ? s.desc : 'เลือกเสียงด้านบนเพื่อเริ่ม';
    $('#stopSound').disabled = !s;
  },
};

function renderSounds() {
  $('#soundGrid').innerHTML = SOUNDS.map(s =>
    `<button class="sound-btn" data-id="${s.id}">
       <span class="si">${s.icon}</span><span class="sn">${s.name}</span><span class="sd">${s.desc}</span>
     </button>`).join('');
  $('#soundGrid').addEventListener('click', e => {
    const b = e.target.closest('.sound-btn');
    if (b) Sound.play(b.dataset.id);
  });

  $('#timerRow').innerHTML = [
    { m: 0, l: 'ปิด' }, { m: 5, l: '5 นาที' }, { m: 10, l: '10 นาที' },
    { m: 15, l: '15 นาที' }, { m: 30, l: '30 นาที' }, { m: 45, l: '45 นาที' }, { m: 60, l: '60 นาที' },
  ].map(t => `<button class="chip ${t.m === 0 ? 'on' : ''}" data-m="${t.m}">${t.l}</button>`).join('');

  $('#timerRow').addEventListener('click', e => {
    const c = e.target.closest('.chip');
    if (!c) return;
    $$('#timerRow .chip').forEach(x => x.classList.toggle('on', x === c));
    Sound.setTimer(Number(c.dataset.m));
  });

  $('#stopSound').addEventListener('click', () => Sound.stop());
  $('#volume').value = S.volume;
  $('#volLabel').textContent = S.volume + '%';
  $('#volume').addEventListener('input', e => Sound.setVolume(Number(e.target.value)));
}

/* ---------- ฝึกหายใจ 4-7-8 ---------- */
const Breathe = {
  running: false, timer: null, round: 0,
  steps: [
    { t: 'หายใจเข้าทางจมูก', s: 4, scale: 1.55 },
    { t: 'กลั้นไว้',           s: 7, scale: 1.55 },
    { t: 'ผ่อนออกทางปาก',    s: 8, scale: 1 },
  ],
  start() {
    if (this.running) return this.stop();
    this.running = true; this.round = 0;
    $('#breatheBtn').textContent = 'หยุด';
    this.step(0);
  },
  step(i) {
    if (!this.running) return;
    if (i === 0) {
      this.round++;
      if (this.round > 4) { this.finish(); return; }
    }
    const st = this.steps[i];
    const c = $('#breatheCircle');
    c.style.transitionDuration = st.s + 's';
    c.style.transform = `scale(${st.scale})`;
    $('#breatheText').textContent = st.t;

    let left = st.s;
    $('#breatheCount').textContent = `${left} · รอบที่ ${this.round}/4`;
    clearInterval(this._c);
    this._c = setInterval(() => {
      left--;
      if (left >= 0) $('#breatheCount').textContent = `${left} · รอบที่ ${this.round}/4`;
    }, 1000);
    this.timer = setTimeout(() => { clearInterval(this._c); this.step((i + 1) % 3); }, st.s * 1000);
  },
  finish() {
    this.reset();
    $('#breatheText').textContent = 'ครบแล้ว 🌙';
    $('#breatheCount').textContent = 'หลับฝันดีนะ';
  },
  stop() { this.reset(); $('#breatheText').textContent = 'พร้อม'; $('#breatheCount').textContent = ''; },
  reset() {
    this.running = false;
    clearTimeout(this.timer); clearInterval(this._c);
    const c = $('#breatheCircle');
    c.style.transitionDuration = '1s';
    c.style.transform = 'scale(1)';
    $('#breatheBtn').textContent = 'เริ่มฝึกหายใจ';
  },
};
$('#breatheBtn').addEventListener('click', () => Breathe.start());

/* =========================================================
   5) ฟังก์ชันเสริม: งานสำคัญของวันพรุ่งนี้ + เตือนตอนเช้า
   ========================================================= */
const PRI_LABEL = { high: 'สำคัญมาก', normal: 'ปกติ', low: 'ถ้ามีเวลา' };

function addTask() {
  const inp = $('#taskInput');
  const text = inp.value.trim();
  if (!text) { inp.focus(); return; }
  S.tasks.push({ id: Date.now(), text, pri: $('#taskPriority').value, done: false });
  save();
  inp.value = '';
  renderTasks();
  toast('เพิ่มลงรายการพรุ่งนี้แล้ว');
}
$('#taskAdd').addEventListener('click', addTask);
$('#taskInput').addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });

$('#taskList').addEventListener('click', e => {
  const del = e.target.closest('.task-del');
  if (del) {
    S.tasks = S.tasks.filter(t => t.id !== Number(del.dataset.id));
    save(); renderTasks(); return;
  }
});
$('#taskList').addEventListener('change', e => {
  if (e.target.type !== 'checkbox') return;
  const t = S.tasks.find(x => x.id === Number(e.target.dataset.id));
  if (t) { t.done = e.target.checked; save(); renderTasks(); }
});

function taskHTML(t, readonly) {
  return `<li class="task-item ${t.done ? 'done' : ''}">
    <input type="checkbox" data-id="${t.id}" ${t.done ? 'checked' : ''} ${readonly ? 'disabled' : ''}>
    <span class="task-text">${escapeHTML(t.text)}</span>
    <span class="pri pri-${t.pri}">${PRI_LABEL[t.pri]}</span>
    ${readonly ? '' : `<button class="task-del" data-id="${t.id}" title="ลบ">×</button>`}
  </li>`;
}
const escapeHTML = s => s.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderTasks() {
  const order = { high: 0, normal: 1, low: 2 };
  const sorted = [...S.tasks].sort((a, b) => (a.done - b.done) || (order[a.pri] - order[b.pri]));
  $('#taskList').innerHTML = sorted.length
    ? sorted.map(t => taskHTML(t)).join('')
    : '<p class="empty">ยังไม่มีรายการ — จดสิ่งที่ต้องทำพรุ่งนี้ไว้ก่อนนอน แล้วปล่อยให้สมองได้พัก</p>';
}

/* ---------- การแจ้งเตือน ---------- */
function refreshNotifStatus() {
  const el = $('#notifStatus'), btn = $('#notifEnable');
  if (!('Notification' in window)) {
    el.textContent = 'เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน (จะแสดงป๊อปอัปในหน้าแทน)';
    el.className = 'notif-status no'; btn.disabled = true; return;
  }
  const p = Notification.permission;
  if (p === 'granted') { el.textContent = '✅ เปิดใช้งานแล้ว'; el.className = 'notif-status ok'; btn.disabled = true; }
  else if (p === 'denied') { el.textContent = '🚫 ถูกปิดกั้นไว้ (จะแสดงป๊อปอัปในหน้าแทน)'; el.className = 'notif-status no'; btn.disabled = true; }
  else { el.textContent = 'ยังไม่ได้อนุญาต'; el.className = 'notif-status no'; btn.disabled = false; }
}
$('#notifEnable').addEventListener('click', async () => {
  try { await Notification.requestPermission(); } catch {}
  refreshNotifStatus();
});

$('#remindTime').addEventListener('change', e => { S.remindTime = e.target.value; save(); });
$('#remindOn').addEventListener('change', e => {
  S.remindOn = e.target.checked; save();
  toast(e.target.checked ? `จะเตือนคุณเวลา ${S.remindTime} ✅` : 'ปิดการเตือนตอนเช้าแล้ว');
});

/* ---------- ตัวเตือนอัตโนมัติรายวัน (Phase 1) ---------- */
$('#remLogOn').addEventListener('change', e => { S.reminders.log.on = e.target.checked; save(); });
$('#remLogTime').addEventListener('change', e => { S.reminders.log.time = e.target.value; save(); });
$('#remBedOn').addEventListener('change', e => { S.reminders.bedtime.on = e.target.checked; save(); });
$('#remBedLead').addEventListener('change', e => { S.reminders.bedtime.leadMin = Number(e.target.value); save(); });
$('#remAlarmOn').addEventListener('change', e => { S.reminders.alarmMissing.on = e.target.checked; save(); });

/**
 * ตรวจว่ามีอะไรถึงกำหนดเตือนบ้าง แล้วยิงออกไป
 * เรียกทุก 20 วินาที และทุกครั้งที่ผู้ใช้กลับมาโฟกัสหน้าจอ (เผื่อ timer ถูก throttle)
 */
function checkReminders() {
  const due = dueReminders(S, new Date());
  if (!due.length) return;

  for (const r of due) {
    markFired(S, r.key);
    Notify.send(r);
    if (r.id === 'morning') showMorningModal(r.pending);
  }
  save();
  renderConfirmBar();
}

/* ---------- ชั้นส่งการแจ้งเตือน ----------
   ใช้ service worker ถ้ามี (แจ้งเตือนจะค้างใน tray และคลิกแล้วโฟกัสกลับมาได้)
   ถ้าไม่มีให้ถอยไปใช้ Notification ตรง ๆ และถ้าถูกบล็อกก็แสดง toast ในหน้าแทน */
const Notify = {
  swReg: null,

  async register() {
    if (!('serviceWorker' in navigator)) return;           // file:// จะไม่มี
    try {
      this.swReg = await navigator.serviceWorker.register('sw.js');
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data && e.data.type === 'openTab') goTab(e.data.tab);
      });
    } catch { /* ใช้ fallback แทน */ }
  },

  get allowed() {
    return 'Notification' in window && Notification.permission === 'granted';
  },

  send({ title, body, tag, tab, sticky }) {
    if (this.allowed) {
      if (this.swReg && this.swReg.active) {
        this.swReg.active.postMessage({ type: 'notify', title, body, tag: tag || 'timesync', tab, sticky });
        return true;
      }
      try { new Notification(title, { body, tag: tag || 'timesync' }); return true; } catch { /* ตกไป fallback */ }
    }
    toast(title.replace(/^TimeSync — /, ''));   // สำรอง: แสดงในหน้าแทน
    return false;
  },
};

function showMorningModal(pending) {
  $('#morningSub').textContent = pending.length
    ? `วันนี้คุณมี ${pending.length} สิ่งสำคัญที่ตั้งใจไว้เมื่อคืน`
    : 'เมื่อคืนคุณไม่ได้ฝากอะไรไว้ — วันนี้เริ่มต้นแบบสบาย ๆ ได้เลย';
  $('#morningList').innerHTML = pending.map(t => taskHTML(t, true)).join('');
  $('#morningModal').classList.remove('hidden');
}
$('#morningClose').addEventListener('click', () => $('#morningModal').classList.add('hidden'));

/* =========================================================
   Phase 1: การ์ดยืนยันการนอนแบบคลิกเดียว
   "ควรป้อนข้อมูลเพียงครั้งเดียว นอกจากมีการแก้ไข"
   ========================================================= */
function renderConfirmBar() {
  const r = shouldAskToLog(S, new Date());
  const bar = $('#confirmBar');
  bar.classList.toggle('hidden', !r.ask);
  if (!r.ask) return;
  bar.dataset.date = r.date;
  bar.dataset.bed = r.bed;
  bar.dataset.wake = r.wake;
  $('#cbTitle').textContent = `เมื่อคืนนอน ${r.bed} – ${r.wake} ใช่ไหม?`;
  $('#cbSub').textContent = `รวม ${hoursText(r.hours)} · กดยืนยันครั้งเดียวจบ ไม่ต้องกรอกใหม่`;
}

$('#cbConfirm').addEventListener('click', () => {
  const b = $('#confirmBar').dataset;
  logSleep(b.date, b.bed, b.wake);
  $('#confirmBar').classList.add('hidden');
});

$('#cbEdit').addEventListener('click', () => {
  const b = $('#confirmBar').dataset;
  $('#logDate').value = b.date;
  $('#logBed').value = b.bed;
  $('#logWake').value = b.wake;
  $('#confirmBar').classList.add('hidden');
  goTab('debt');
  $('#logBed').focus();
});

$('#cbDismiss').addEventListener('click', () => {
  S.askDismissed = dateKey(new Date());
  save();
  $('#confirmBar').classList.add('hidden');
});

/** บันทึกการนอน 1 คืน + จำค่าไว้เป็น default ของครั้งถัดไป */
function logSleep(date, bed, wake) {
  const hours = hoursBetween(bed, wake);
  if (hours > 16) { toast('ระยะเวลานอนดูจะยาวผิดปกติ ลองตรวจสอบเวลาอีกครั้ง'); return false; }
  S.sleepLogs[date] = { bed, wake, hours };
  S.lastBed = bed;
  S.lastWake = wake;
  save();
  renderDebt();
  renderConfirmBar();
  toast(`บันทึกแล้ว: นอน ${hoursText(hours)}`);
  return true;
}

/* =========================================================
   Phase 2: นาฬิกาปลุก
   ========================================================= */
function setAlarm(time, on) {
  S.alarm.time = time;
  S.alarm.on = on !== undefined ? on : true;
  S.alarm.snoozedUntil = null;
  S.alarm.snoozeCount = 0;
  S.alarm.lastRung = '';           // ตั้งใหม่ = ปลุกได้อีกแม้เพิ่งดังไป
  save();
  syncAlarmEngine();
  renderAlarm();
  tickClock();
  renderCycles();                  // อัปเดตปุ่ม ⏰ บนแถวรอบการนอน
}

function renderAlarm() {
  const on = S.alarm.on;
  const st = alarmStatus(S.alarm, new Date());
  $('#alarmCard').classList.toggle('on', on);
  $('#alarmOn').checked = on;
  $('#alarmTime').value = S.alarm.time;
  $('#audioWarn').classList.toggle('hidden', !on || Alarm.ready);

  if (!on) {
    $('#alarmSub').textContent = 'ยังไม่ได้ตั้งปลุก';
    $('#alarmCount').textContent = '';
  } else if (st.snoozed) {
    $('#alarmSub').textContent = `เลื่อนปลุกอยู่ — จะดังอีกครั้งเวลา ${minToHM(st.nextAt.getHours() * 60 + st.nextAt.getMinutes())}`;
    $('#alarmCount').textContent = `อีก ${durText(st.leftMin)} จากนี้`;
  } else {
    const tomorrow = st.nextAt.getDate() !== new Date().getDate();
    $('#alarmSub').textContent = `ตั้งปลุกไว้แล้ว — จะปลุก${tomorrow ? 'พรุ่งนี้' : 'วันนี้'} เวลา ${S.alarm.time}`;
    $('#alarmCount').textContent = `อีก ${durText(st.leftMin)} จากนี้`;
  }

  // เสียงที่เลือกอยู่
  $$('#alarmSoundGrid .sound-btn').forEach(b => {
    b.classList.toggle('playing', b.dataset.id === S.alarm.sound);
  });
  $$('#rampRow .chip').forEach(c => c.classList.toggle('on', Number(c.dataset.v) === S.alarm.rampSec));
  $$('#snoozeRow .chip').forEach(c => c.classList.toggle('on', Number(c.dataset.v) === S.alarm.snoozeMin));
  $('#alarmVolume').value = S.alarm.volume;
  $('#alarmVolLabel').textContent = S.alarm.volume + '%';
  $('#alarmVibrate').checked = S.alarm.vibrate;
  $('#ringSnooze').textContent = `เลื่อน ${S.alarm.snoozeMin} นาที`;
}

/** เปิด/ปิด keep-alive ของ AudioContext ตามสถานะการตั้งปลุก */
function syncAlarmEngine() {
  if (S.alarm.on && Alarm.ctx) Alarm.startKeepAlive();
  else Alarm.stopKeepAlive();
}

$('#alarmOn').addEventListener('change', e => {
  Alarm.unlock();                  // เป็น user gesture — ใช้ปลดล็อกเสียงไปด้วยเลย
  S.alarm.on = e.target.checked;
  if (!e.target.checked) { S.alarm.snoozedUntil = null; S.alarm.snoozeCount = 0; }
  save(); syncAlarmEngine(); renderAlarm(); tickClock(); renderCycles();
  toast(e.target.checked ? `ตั้งปลุกไว้ที่ ${S.alarm.time} ⏰` : 'ปิดนาฬิกาปลุกแล้ว');
});
$('#alarmTime').addEventListener('change', e => setAlarm(e.target.value, true));

/* ---------- เลือกเสียงปลุก ---------- */
function renderAlarmSounds() {
  $('#alarmSoundGrid').innerHTML = ALARM_SOUNDS.map(s =>
    `<button class="sound-btn" data-id="${s.id}">
       <span class="si">${s.icon}</span><span class="sn">${s.name}</span><span class="sd">${s.desc}</span>
     </button>`).join('');

  $('#rampRow').innerHTML = RAMP_OPTIONS.map(v =>
    `<button class="chip" data-v="${v}">${v === 0 ? 'ดังเต็มทันที' : v + ' วินาที'}</button>`).join('');

  $('#snoozeRow').innerHTML = SNOOZE_OPTIONS.map(v =>
    `<button class="chip" data-v="${v}">${v} นาที</button>`).join('');
}

$('#alarmSoundGrid').addEventListener('click', e => {
  const b = e.target.closest('.sound-btn');
  if (!b) return;
  Alarm.unlock();
  S.alarm.sound = b.dataset.id;
  save(); renderAlarm(); renderUploads();
  Alarm.start(S.alarm, true);        // ให้ฟังตัวอย่างทันทีที่เลือก
});

$('#rampRow').addEventListener('click', e => {
  const c = e.target.closest('.chip');
  if (!c) return;
  S.alarm.rampSec = Number(c.dataset.v); save(); renderAlarm();
});

$('#snoozeRow').addEventListener('click', e => {
  const c = e.target.closest('.chip');
  if (!c) return;
  S.alarm.snoozeMin = Number(c.dataset.v); save(); renderAlarm();
});

$('#alarmVolume').addEventListener('input', e => {
  S.alarm.volume = Number(e.target.value);
  $('#alarmVolLabel').textContent = S.alarm.volume + '%';
  save();
});

$('#alarmVibrate').addEventListener('change', e => { S.alarm.vibrate = e.target.checked; save(); });

$('#alarmPreview').addEventListener('click', () => {
  Alarm.unlock();
  if (!Alarm.ready) {
    $('#previewNote').textContent = 'เบราว์เซอร์ยังบล็อกเสียงอยู่ ลองคลิกที่หน้าเว็บก่อนแล้วกดใหม่';
    return;
  }
  Alarm.start(S.alarm, true);
  $('#previewNote').textContent = 'กำลังเล่นตัวอย่าง 4 วินาที (ไม่ใช้ ramp-up)';
  setTimeout(() => { $('#previewNote').textContent = ''; renderAlarm(); }, 4200);
  renderAlarm();
});

/* ---------- ไฟล์เสียงของผู้ใช้ (IndexedDB) ---------- */
$('#soundPick').addEventListener('click', () => $('#soundFile').click());

$('#soundFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  const err = Uploads.validate(file);
  if (err) { toast(err); return; }
  if (file.size > Uploads.WARN) toast('ไฟล์ค่อนข้างใหญ่ อาจใช้เวลาบันทึกสักครู่');

  try {
    const rec = await Uploads.save(file);
    S.alarm.sound = 'custom';
    S.alarm.customId = rec.id;
    save();
    await renderUploads();
    renderAlarm();
    toast(`เพิ่ม "${rec.name}" เป็นเสียงปลุกแล้ว`);
  } catch {
    toast('บันทึกไฟล์ไม่สำเร็จ — พื้นที่เก็บข้อมูลอาจเต็ม');
  }
});

async function renderUploads() {
  const box = $('#uploadList');
  let list = [];
  try { list = await Uploads.list(); } catch { box.innerHTML = '<p class="empty">เบราว์เซอร์นี้ไม่รองรับการเก็บไฟล์เสียง</p>'; return; }

  if (!list.length) {
    box.innerHTML = '<p class="empty">ยังไม่มีเสียงที่อัปโหลด</p>';
    return;
  }
  box.innerHTML = list.sort((a, b) => b.addedAt - a.addedAt).map(r => {
    const sel = S.alarm.sound === 'custom' && S.alarm.customId === r.id;
    return `<div class="upload-item ${sel ? 'sel' : ''}">
      <span class="up-name">${sel ? '✓ ' : ''}${escapeHTML(r.name)}</span>
      <span class="up-size">${(r.size / 1048576).toFixed(1)} MB</span>
      <button class="up-btn use" data-id="${r.id}">${sel ? 'ใช้อยู่' : 'ใช้เสียงนี้'}</button>
      <button class="up-btn del" data-id="${r.id}">ลบ</button>
    </div>`;
  }).join('');
}

$('#uploadList').addEventListener('click', async e => {
  const use = e.target.closest('.up-btn.use');
  const del = e.target.closest('.up-btn.del');

  if (use) {
    Alarm.unlock();
    S.alarm.sound = 'custom';
    S.alarm.customId = use.dataset.id;
    save(); await renderUploads(); renderAlarm();
    Alarm.start(S.alarm, true);
    return;
  }
  if (del) {
    if (!confirm('ลบไฟล์เสียงนี้ออกจากเครื่องใช่หรือไม่?')) return;
    await Uploads.remove(del.dataset.id);
    if (S.alarm.customId === del.dataset.id) {
      S.alarm.sound = 'classic';
      S.alarm.customId = null;
      save();
    }
    await renderUploads(); renderAlarm();
    toast('ลบไฟล์เสียงแล้ว');
  }
});

/* ---------- ปลุกจริง ---------- */
function checkAlarm() {
  const st = alarmStatus(S.alarm, new Date());
  if (!st.due || Alarm.ringing) return;
  ringAlarm(st);
}

function ringAlarm(st) {
  // จำไว้ว่าปลุกรอบนี้แล้ว เพื่อไม่ให้ดังซ้ำถ้ารีโหลดหน้า
  if (st.rungKey) S.alarm.lastRung = st.rungKey;
  S.alarm.snoozedUntil = null;
  save();

  Sound.stop(0.3);   // ถ้าเสียงผ่อนคลายยังเล่นค้างจากเมื่อคืน ให้หยุดก่อน เสียงปลุกจะได้ไม่ถูกกลบ

  const played = Alarm.start(S.alarm, false);
  if (S.alarm.vibrate && navigator.vibrate) {
    try { navigator.vibrate([600, 300, 600, 300, 600]); } catch {}
  }

  // แจ้งเตือนคู่กันเสมอ — ถ้าเสียงถูกบล็อก อย่างน้อยยังมีการแจ้งเตือน
  Notify.send({
    title: `TimeSync — ⏰ ${S.alarm.time}`,
    body: Alarm.ready ? 'ได้เวลาตื่นแล้ว!' : 'ได้เวลาตื่นแล้ว! (เบราว์เซอร์บล็อกเสียง เปิดหน้า TimeSync เพื่อปิดปลุก)',
    tag: 'timesync-alarm',
    tab: 'alarm',
    sticky: true,
  });

  showRingModal();
  Promise.resolve(played).then(ok => {
    $('#ringNote').textContent = (ok && Alarm.ready)
      ? ''
      : '🔇 เบราว์เซอร์บล็อกการเล่นเสียงไว้ — คราวหน้ากด "ทดสอบเสียง" ในแท็บปลุกก่อนเข้านอนหนึ่งครั้ง';
  });
}

function showRingModal() {
  $('#ringTime').textContent = S.alarm.time;
  $('#ringLabel').textContent = S.alarm.snoozeCount
    ? `ได้เวลาตื่นแล้ว! (เลื่อนมา ${S.alarm.snoozeCount} ครั้ง)`
    : 'ได้เวลาตื่นแล้ว!';

  const pending = S.tasks.filter(t => !t.done);
  $('#ringTasks').innerHTML = pending.length
    ? pending.slice(0, 4).map(t => taskHTML(t, true)).join('')
    : '';

  const maxed = S.alarm.snoozeCount >= S.alarm.maxSnooze;
  $('#ringSnooze').disabled = maxed;
  $('#ringSnooze').textContent = maxed ? 'เลื่อนครบแล้ว' : `เลื่อน ${S.alarm.snoozeMin} นาที`;
  $('#ringModal').classList.remove('hidden');
}

$('#ringSnooze').addEventListener('click', () => {
  Alarm.stop();
  S.alarm.snoozeCount++;
  S.alarm.snoozedUntil = snoozeUntil(new Date(), S.alarm.snoozeMin).getTime();
  save();
  $('#ringModal').classList.add('hidden');
  renderAlarm();
  toast(`เลื่อนปลุกไป ${S.alarm.snoozeMin} นาที`);
});

$('#ringStop').addEventListener('click', () => {
  Alarm.stop();
  S.alarm.snoozedUntil = null;
  S.alarm.snoozeCount = 0;
  save();
  $('#ringModal').classList.add('hidden');
  renderAlarm();

  // ต่อยอดไปยังงานที่ต้องทำวันนี้ทันที (ฟีเจอร์เสริมเดิม)
  const pending = S.tasks.filter(t => !t.done);
  if (pending.length) showMorningModal(pending);
});

/* =========================================================
   ตั้งค่า
   ========================================================= */
function renderSettings() {
  $('#ageGroup').innerHTML = AGE_GROUPS.map(g =>
    `<option value="${g.id}" ${g.id === S.ageGroup ? 'selected' : ''}>${g.label} · ${g.min}–${g.max} ชม.</option>`).join('');
  $('#usualWake').value = S.usualWake;
  $('#latency').value = S.latency;   $('#latencyLabel').textContent = S.latency;
  $('#cycleLen').value = S.cycleLen; $('#cycleLabel').textContent = S.cycleLen;
  $('#debtWindow').value = S.debtWindow; $('#windowLabel').textContent = S.debtWindow;

  // ตัวเตือนอัตโนมัติ
  $('#remLogOn').checked = S.reminders.log.on;
  $('#remLogTime').value = S.reminders.log.time;
  $('#remBedOn').checked = S.reminders.bedtime.on;
  $('#remBedLead').value = String(S.reminders.bedtime.leadMin);
  $('#remAlarmOn').checked = S.reminders.alarmMissing.on;
  $('#remBedAt').textContent = `เวลานอนของคุณคือ ${minToHM(usualBedtimeMin(S))}`;
}

$('#ageGroup').addEventListener('change', e => {
  S.ageGroup = e.target.value; save(); renderDebt(); renderSleepChartTable();
});
$('#usualWake').addEventListener('change', e => {
  S.usualWake = e.target.value; save(); refreshFatigueIfShown();
  $('#remBedAt').textContent = `เวลานอนของคุณคือ ${minToHM(usualBedtimeMin(S))}`;
});
$('#latency').addEventListener('input', e => {
  S.latency = Number(e.target.value); $('#latencyLabel').textContent = S.latency;
  save(); renderCycles(); refreshFatigueIfShown();
});
$('#cycleLen').addEventListener('input', e => {
  S.cycleLen = Number(e.target.value); $('#cycleLabel').textContent = S.cycleLen;
  save(); renderCycles(); refreshFatigueIfShown();
});
$('#debtWindow').addEventListener('input', e => {
  S.debtWindow = Number(e.target.value); $('#windowLabel').textContent = S.debtWindow;
  save(); renderDebt();
});

function refreshFatigueIfShown() {
  const sel = $('.emoji-btn.sel');
  if (sel) selectFatigue(Number(sel.dataset.lvl), true);
}

$('#exportData').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `timesync-${dateKey(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
});

$('#resetData').addEventListener('click', () => {
  if (!confirm('ล้างข้อมูล TimeSync ทั้งหมด (บันทึกการนอน ความล้า และรายการงาน) ใช่หรือไม่?\nการกระทำนี้ย้อนกลับไม่ได้')) return;
  [KEY, ...LEGACY_KEYS].forEach(k => localStorage.removeItem(k));
  S = C.defaults();
  boot(true);
  toast('ล้างข้อมูลเรียบร้อย');
});

/* =========================================================
   เริ่มทำงาน
   ========================================================= */
function boot(isReset) {
  renderSettings();
  renderFatigueHistory();
  syncCalcInput();
  renderCycles();
  renderAlarm();
  // ค่า default ของฟอร์มบันทึก = ครั้งล่าสุดที่ผู้ใช้กรอก (ตั้งครั้งเดียว ใช้ตลอด)
  $('#logDate').value = dateKey(new Date());
  if (S.lastBed) $('#logBed').value = S.lastBed;
  if (S.lastWake) $('#logWake').value = S.lastWake;
  renderDebt();
  renderSleepChartTable();
  renderTasks();
  renderConfirmBar();
  $('#remindTime').value = S.remindTime;
  $('#remindOn').checked = S.remindOn;
  refreshNotifStatus();

  if (isReset) {
    $$('.emoji-btn').forEach(b => b.classList.remove('sel'));
    $('#fatigueResult').classList.add('hidden');
    $('#volume').value = S.volume;
    $('#volLabel').textContent = S.volume + '%';
    Sound.stop();
  }
}

/* Autoplay policy: เบราว์เซอร์ห้ามเล่นเสียงจนกว่าผู้ใช้จะมี interaction
   จึงปลดล็อก AudioContext ที่การคลิก/กดปุ่มครั้งแรกของหน้านี้ */
function installAudioUnlock() {
  const once = () => {
    Alarm.unlock();
    syncAlarmEngine();
    renderAlarm();
    if (Alarm.ready) {
      ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
        document.removeEventListener(ev, once, true));
    }
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, once, true));
}

makeStars();
tickClock();
setInterval(() => { tickClock(); renderAlarm(); }, 1000 * 20);
renderEmojiRow();
renderSounds();
renderAlarmSounds();
boot(false);
renderUploads();
installAudioUnlock();
Notify.register();
Alarm.onStateChange = () => renderAlarm();

// แสดงผลความล้าของวันนี้ถ้าเคยกดไว้แล้ว
const todayFatigue = S.fatigueLogs[dateKey(new Date())];
if (todayFatigue) selectFatigue(todayFatigue.lvl, true);

// เปิดแท็บตามที่ระบุมาจากการคลิก notification
const wantTab = new URLSearchParams(location.search).get('tab');
if (wantTab && $(`#panel-${wantTab}`)) goTab(wantTab);

/* ตรวจการเตือนทุก 20 วินาที และทุกครั้งที่กลับมาโฟกัสหน้าจอ
   (เบราว์เซอร์หน่วง timer ของแท็บเบื้องหลัง การเช็คตอนกลับมาจึงจำเป็นเพื่อ "ตามเก็บ") */
function tick() {
  checkAlarm();          // ปลุกก่อน — สำคัญที่สุดและต้องไวที่สุด
  checkReminders();
}
tick();
setInterval(tick, 10000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  tick();
  renderConfirmBar();
  renderAlarm();
});
