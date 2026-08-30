/* =========================================================
   TimeSync — service worker
   - แสดง notification ให้ค้างใน tray และคลิกแล้วโฟกัสกลับมาที่แอป
   - แคชไฟล์แอปไว้ใช้ออฟไลน์ (Phase 4)

   ข้อจำกัดที่ต้องรู้: เว็บแอปไม่สามารถ "ปลุก" ตัวเองตอนที่ผู้ใช้ปิดหน้าไปแล้ว
   ได้อย่างแม่นยำ — ไม่มีเบราว์เซอร์ไหนรองรับ (Notification Triggers API
   ถูกทดลองแล้วไม่ปล่อยจริง, Periodic Background Sync ขั้นต่ำ ~12 ชม.)
   การปลุกจึงต้องเปิดหน้า TimeSync ค้างไว้ หรือติดตั้งเป็นแอปแล้วย่อหน้าต่างทิ้งไว้
   ========================================================= */

const CACHE = 'timesync-v2';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './core.js',
  './alarm.js',
  './auth.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .catch(() => { /* ไฟล์ใดโหลดไม่ได้ก็ยังติดตั้งต่อได้ */ })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/**
 * network-first สำหรับไฟล์แอป — ได้ของใหม่เสมอเมื่อออนไลน์
 * และยังเปิดใช้ได้เมื่อออฟไลน์
 */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      return new Response('ออฟไลน์และไม่มีไฟล์ในแคช', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});

/* ---------- การแจ้งเตือน ---------- */

/** หน้าแอปส่งคำสั่งมาให้ SW แสดง notification */
self.addEventListener('message', event => {
  const msg = event.data || {};
  if (msg.type === 'skipWaiting') { self.skipWaiting(); return; }
  if (msg.type !== 'notify') return;

  event.waitUntil(
    self.registration.showNotification(msg.title || 'TimeSync', {
      body: msg.body || '',
      tag: msg.tag || 'timesync',
      renotify: true,
      requireInteraction: !!msg.sticky,
      silent: false,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { tab: msg.tab || null },
    })
  );
});

/** คลิกที่ notification → โฟกัสแท็บเดิมถ้ามี ไม่งั้นเปิดใหม่ */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const tab = event.notification.data && event.notification.data.tab;

  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      if (client.url.includes(self.registration.scope)) {
        await client.focus();
        if (tab) client.postMessage({ type: 'openTab', tab });
        return;
      }
    }
    await self.clients.openWindow(tab ? `./?tab=${encodeURIComponent(tab)}` : './');
  })());
});
