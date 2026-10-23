/*
 * Kartičky push server — a single Cloudflare Worker.
 *
 * Bindings (set in the Cloudflare dashboard):
 *   SUBS            KV namespace (required)
 *   ALLOWED_ORIGIN  e.g. "https://name.github.io" (optional, recommended)
 * Cron trigger: every 15 minutes
 *
 * Pushes carry no payload, so no message encryption is needed; the app's
 * service worker counts the due cards itself and shows the notification.
 * The VAPID key pair is generated on first use and kept in KV.
 */

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400',
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, 'content-type': 'application/json' },
    });

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) {
      return json({ error: 'origin not allowed' }, 403);
    }

    const { pathname } = new URL(request.url);
    try {
      if (request.method === 'GET' && pathname === '/vapid-public-key') {
        const keys = await vapidKeys(env);
        return json({ publicKey: keys.publicKey });
      }
      if (request.method === 'POST' && pathname === '/subscribe') {
        return json(await subscribe(env, await request.json(), origin));
      }
      if (request.method === 'POST' && pathname === '/unsubscribe') {
        const { endpoint } = await request.json();
        await env.SUBS.delete(await subKey(endpoint));
        return json({ ok: true });
      }
      if (request.method === 'POST' && pathname === '/test') {
        const { endpoint } = await request.json();
        const record = await env.SUBS.get(await subKey(endpoint), 'json');
        if (!record) return json({ error: 'subscription not found' }, 404);
        const status = await sendPush(env, record);
        return json({ ok: status < 300, status }, status < 300 ? 200 : 502);
      }
      if (request.method === 'GET' && pathname === '/') {
        return new Response('Kartičky push server OK', { headers: cors });
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: String(err.message || err) }, 400);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDailyReminders(env));
  },
};

// ---- Subscriptions ----

async function subscribe(env, body, origin) {
  const { subscription, time, timeZone, dueDates } = body || {};
  if (!subscription || typeof subscription.endpoint !== 'string' || !subscription.endpoint.startsWith('https://')) {
    throw new Error('invalid subscription');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) throw new Error('invalid time');
  localNow(timeZone); // throws on an unknown time zone
  if (!Array.isArray(dueDates) || dueDates.length > 20000
    || !dueDates.every((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    throw new Error('invalid dueDates');
  }

  const key = await subKey(subscription.endpoint);
  const existing = await env.SUBS.get(key, 'json');
  const now = localNow(timeZone);
  let lastSentDay = existing ? existing.lastSentDay : null;
  // Turning reminders on after today's time has passed shouldn't fire immediately.
  if (!existing && now.minutes >= toMinutes(time)) lastSentDay = now.day;
  // Moving the time later today re-arms today's reminder.
  if (existing && existing.time !== time && lastSentDay === now.day && now.minutes < toMinutes(time)) {
    lastSentDay = null;
  }

  // Only whether a day has something due matters, so duplicates are dropped.
  const record = {
    subscription: { endpoint: subscription.endpoint },
    time,
    timeZone,
    dueDates: [...new Set(dueDates)].sort(),
    origin: origin || (existing && existing.origin) || null,
    lastSentDay,
    updatedAt: new Date().toISOString(),
  };
  await env.SUBS.put(key, JSON.stringify(record));
  return { ok: true };
}

async function subKey(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return 'sub:' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- Daily cron ----

async function sendDailyReminders(env) {
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix: 'sub:', cursor });
    for (const { name } of page.keys) {
      const record = await env.SUBS.get(name, 'json');
      if (!record) continue;
      const now = localNow(record.timeZone);
      if (record.lastSentDay === now.day || now.minutes < toMinutes(record.time)) continue;
      if (!dueToday(record, now.day)) continue;

      const status = await sendPush(env, record);
      if (status === 404 || status === 410) {
        await env.SUBS.delete(name); // the phone dropped this subscription
      } else if (status < 300) {
        record.lastSentDay = now.day;
        await env.SUBS.put(name, JSON.stringify(record));
      }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}

function dueToday(record, day) {
  return record.dueDates.some((d) => d <= day);
}

function localNow(timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ---- Web Push (VAPID, empty payload) ----

async function vapidKeys(env) {
  const stored = await env.SUBS.get('vapid', 'json');
  if (stored) return stored;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const keys = {
    publicKey: base64Url(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  };
  await env.SUBS.put('vapid', JSON.stringify(keys));
  return keys;
}

async function vapidAuthorization(env, endpoint, subject) {
  const keys = await vapidKeys(env);
  const header = base64Url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = base64Url(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  }));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${base64Url(signature)}, k=${keys.publicKey}`;
}

async function sendPush(env, record) {
  const subject = env.VAPID_SUBJECT || record.origin || env.ALLOWED_ORIGIN || 'https://karticky.invalid';
  const res = await fetch(record.subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(env, record.subscription.endpoint, subject),
      TTL: '43200',
      Urgency: 'normal',
    },
    body: new Uint8Array(0),
  });
  return res.status;
}

function base64Url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
