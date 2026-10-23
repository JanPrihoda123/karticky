/*
 * Daily review reminders via Web Push.
 *
 * The push server only ever receives the subscription, the reminder time, the
 * time zone and the list of due dates (no images). It sends an empty push at the
 * chosen time when something is due; the service worker builds the message.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'karticky-reminders';
  const DEFAULT_TIME = '18:00';
  const SYNC_DELAY_MS = 4000;

  const server = () => (global.KartickyConfig.PUSH_SERVER_URL || '').replace(/\/$/, '');

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  function settings() {
    try {
      return { enabled: false, time: DEFAULT_TIME, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
    } catch {
      return { enabled: false, time: DEFAULT_TIME };
    }
  }

  function saveSettings(patch) {
    const next = { ...settings(), ...patch };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  }

  // 'ok' | 'no-server' | 'install-first' | 'unsupported' | 'denied'
  function support() {
    if (!server()) return 'no-server';
    if (!('serviceWorker' in navigator)) return 'unsupported';
    if (!('PushManager' in global) || !('Notification' in global)) {
      return isIOS && !isStandalone ? 'install-first' : 'unsupported';
    }
    if (Notification.permission === 'denied') return 'denied';
    return 'ok';
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
  }

  function base64UrlToBytes(b64url) {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }

  async function post(path, body) {
    const res = await fetch(server() + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function currentSubscription() {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function dueDates() {
    const cards = await global.DB.all();
    return cards
      .filter((c) => c.box !== global.Leitner.MASTERED_BOX && c.nextReviewDate)
      .map((c) => c.nextReviewDate);
  }

  async function sync(subscription) {
    const s = settings();
    if (!s.enabled || support() !== 'ok') return;
    const sub = subscription || await currentSubscription();
    if (!sub) return;
    await post('/subscribe', {
      subscription: sub.toJSON(),
      time: s.time,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dueDates: await dueDates(),
    });
  }

  let syncTimer;
  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => sync().catch((err) => console.warn('Reminder sync failed', err)), SYNC_DELAY_MS);
  }

  // Must be called from a tap: iOS only shows the permission prompt for user gestures.
  async function enable(time) {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('permission');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const res = await fetch(server() + '/vapid-public-key');
      const { publicKey } = await res.json();
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey),
      });
    }
    saveSettings({ enabled: true, time });
    await sync(sub);
  }

  async function disable() {
    saveSettings({ enabled: false });
    const sub = await currentSubscription();
    if (sub) {
      await post('/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
  }

  async function setTime(time) {
    saveSettings({ time });
    await sync();
  }

  async function sendTest() {
    const sub = await currentSubscription();
    if (!sub) throw new Error('not subscribed');
    await sync(sub);
    return post('/test', { endpoint: sub.endpoint });
  }

  async function updateBadge(due) {
    if (!navigator.setAppBadge) return;
    try {
      if (due) await navigator.setAppBadge(due);
      else await navigator.clearAppBadge();
    } catch { /* not permitted before notifications are allowed */ }
  }

  global.addEventListener('karticky:changed', scheduleSync);

  global.Reminders = {
    isIOS,
    isStandalone,
    settings,
    support,
    registerServiceWorker,
    enable,
    disable,
    setTime,
    sendTest,
    scheduleSync,
    updateBadge,
  };
})(self);
