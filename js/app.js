/* UI: hash router + views (dashboard, add, review, box browser, card detail). */
(function () {
  'use strict';

  const { BOX_COUNT, MASTERED_BOX, BOX_INTERVAL_DAYS, dayKey, addDays, daysBetween,
    createCard, evaluate, isDue, compareCards } = window.Leitner;

  const app = document.getElementById('app');

  const BOX_LABELS = { 1: 'Nové', 2: 'Po 1 dni', 3: 'Po 5 dnech', 4: 'Po 7 dnech', 5: 'Po 14 dnech', 6: 'Naučené' };

  const ICON_PATHS = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    camera: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.4-2h6.6l1.4 2h1.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
    zoom: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M11 8.5v5M8.5 11h5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4h6v3"/>',
  };

  function icon(name) {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
  }

  // Czech plural forms: 1 karta, 2–4 karty, 0/5+ karet.
  function plural(n, one, few, many) {
    if (n === 1) return one;
    if (n >= 2 && n <= 4) return few;
    return many;
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function formatDate(iso) {
    return iso ? new Date(iso).toLocaleDateString('cs-CZ') : '—';
  }

  function dueText(card) {
    if (card.box === MASTERED_BOX) return 'Naučeno';
    const diff = daysBetween(dayKey(), card.nextReviewDate);
    if (diff <= 0) return 'Dnes';
    if (diff === 1) return 'Zítra';
    return `Za ${diff} ${plural(diff, 'den', 'dny', 'dní')}`;
  }

  // ---- Object URLs, keyboard shortcuts, toast, lightbox ----

  let objectUrls = [];
  function blobUrl(blob) {
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    return url;
  }
  function releaseUrls() {
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls = [];
  }

  let keyHandler = null;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
    if (keyHandler && !e.target.closest('input, textarea, button')) keyHandler(e);
  });

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  const lightbox = document.getElementById('lightbox');
  function openLightbox(src) {
    lightbox.querySelector('img').src = src;
    lightbox.hidden = false;
  }
  function closeLightbox() {
    lightbox.hidden = true;
  }
  lightbox.addEventListener('click', closeLightbox);

  // ---- Shared card components ----

  function flipCardHtml(card) {
    const front = blobUrl(card.front);
    const back = blobUrl(card.back);
    return `
      <div class="flip" role="button" tabindex="0" aria-label="Otočit kartu">
        <div class="flip-inner">
          <div class="face face-front">
            <img src="${front}" alt="Přední strana">
            <span class="face-tag">Otázka</span>
            <button class="zoom" data-src="${front}" aria-label="Zvětšit">${icon('zoom')}</button>
          </div>
          <div class="face face-back">
            <img src="${back}" alt="Zadní strana">
            <span class="face-tag">Odpověď</span>
            <button class="zoom" data-src="${back}" aria-label="Zvětšit">${icon('zoom')}</button>
          </div>
        </div>
      </div>`;
  }

  // Wires up flipping; onReveal runs the first time the back is shown.
  function mountFlip(onReveal) {
    const el = app.querySelector('.flip');
    let revealed = false;
    const toggle = () => {
      el.classList.toggle('flipped');
      if (!revealed) {
        revealed = true;
        onReveal();
      }
    };
    el.addEventListener('click', (e) => {
      if (!e.target.closest('.zoom')) toggle();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); toggle(); }
    });
    app.querySelectorAll('.zoom').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(btn.dataset.src);
      });
    });
    return toggle;
  }

  function decisionButtons(box) {
    if (box === MASTERED_BOX) {
      return `<button class="btn btn-fail btn-lg btn-block" data-act="fail">${icon('x')}<span>Zapomněl/a jsem → Box 1</span></button>`;
    }
    return `
      <button class="btn btn-fail btn-lg" data-act="fail">${icon('x')}<span>Neumím</span></button>
      <button class="btn btn-pass btn-lg" data-act="pass">${icon('check')}<span>Umím</span></button>`;
  }

  function outcomeHint(box) {
    if (box === MASTERED_BOX) return 'Karta zůstane naučená, dokud ji nevrátíte.';
    const next = box + 1;
    const wait = BOX_INTERVAL_DAYS[next];
    const when = next === MASTERED_BOX ? 'mezi naučené'
      : `do Boxu ${next}, znovu za ${wait} ${plural(wait, 'den', 'dny', 'dní')}`;
    return `Umím → ${when} · Neumím → Box 1${box === 1 ? ' (ještě dnes)' : ''}`;
  }

  function bindDecision(container, decide) {
    container.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => decide(btn.dataset.act === 'pass'));
    });
  }

  // ---- Views ----

  async function renderDashboard() {
    const cards = await DB.all();
    const tomorrow = addDays(dayKey(), 1);
    const counts = Array(BOX_COUNT + 1).fill(0);
    let due = 0;
    let dueTomorrow = 0;
    for (const c of cards) {
      counts[c.box]++;
      if (isDue(c)) due++;
      else if (c.nextReviewDate === tomorrow) dueTomorrow++;
    }

    let heroBody;
    if (due) {
      heroBody = `<a class="btn btn-primary btn-lg" href="#/review">Začít opakování</a>`;
    } else if (cards.length) {
      heroBody = `<p class="muted">Pro dnešek hotovo.</p>`;
    } else {
      heroBody = `<p class="muted">Zatím nemáte žádné karty. Vyfoťte otázku a odpověď a začněte.</p>
        <a class="btn btn-primary btn-lg" href="#/add">${icon('camera')}<span>Vytvořit první kartu</span></a>`;
    }

    app.innerHTML = `
      <section class="hero">
        <div class="hero-count">${due}</div>
        <div class="hero-label">${plural(due, 'karta', 'karty', 'karet')} k opakování dnes</div>
        ${heroBody}
        ${dueTomorrow ? `<p class="muted small">Zítra: ${dueTomorrow} ${plural(dueTomorrow, 'karta', 'karty', 'karet')}</p>` : ''}
      </section>

      <div class="section-head">
        <h2>Boxy</h2>
        <span class="muted small">Celkem ${cards.length}</span>
      </div>
      <div class="box-grid">
        ${[1, 2, 3, 4, 5, 6].map((b) => `
          <a class="box-tile box-${b}" href="#/box/${b}">
            <span class="box-name">${b === MASTERED_BOX ? 'Naučené' : `Box ${b}`}</span>
            <span class="box-count">${counts[b]}</span>
            <span class="box-label">${b === MASTERED_BOX ? 'Box 6' : BOX_LABELS[b]}</span>
          </a>`).join('')}
      </div>

      <section class="settings-section" id="reminders"></section>

      <section class="settings-section">
        <h2>Záloha</h2>
        <p class="muted small">Karty jsou uložené jen v tomto prohlížeči. Občas si stáhněte zálohu.</p>
        <div class="backup-actions">
          <button class="btn btn-ghost" id="export" ${cards.length ? '' : 'disabled'}>Stáhnout zálohu</button>
          <label class="btn btn-ghost">Obnovit ze zálohy<input type="file" id="import" accept=".json,application/json" hidden></label>
        </div>
      </section>`;

    Reminders.updateBadge(due);
    renderReminders(document.getElementById('reminders'));

    document.getElementById('export').addEventListener('click', exportBackup);
    document.getElementById('import').addEventListener('change', (e) => {
      if (e.target.files[0]) importBackup(e.target.files[0]);
    });
  }

  function renderReminders(section) {
    const state = Reminders.support();
    const s = Reminders.settings();
    let body;

    if (Reminders.isIOS && !Reminders.isStandalone) {
      body = `<p class="muted small">Na iPhonu fungují připomínky jen v aplikaci přidané na plochu:
        v Safari klepněte na <strong>Sdílet</strong> → <strong>Přidat na plochu</strong>
        a pak Kartičky otevírejte z ikony na ploše.</p>`;
    } else if (state === 'no-server') {
      body = '<p class="muted small">Připomínky zatím nejsou nastavené (chybí adresa serveru v js/config.js).</p>';
    } else if (state === 'unsupported') {
      body = '<p class="muted small">Tento prohlížeč notifikace nepodporuje.</p>';
    } else if (state === 'denied') {
      body = `<p class="muted small">Notifikace jsou zakázané. Povolte je v Nastavení telefonu →
        Notifikace → Kartičky a pak tuto stránku otevřete znovu.</p>`;
    } else {
      body = `
        <p class="muted small">${s.enabled
          ? `Zapnuto. Každý den v ${s.time} přijde upozornění, pokud budete mít karty k opakování.`
          : 'Každý den ve zvolený čas vám přijde upozornění, pokud budete mít karty k opakování.'}</p>
        <div class="reminder-row">
          <label class="time-field">Čas <input type="time" id="rem-time" value="${s.time}" required></label>
          ${s.enabled
            ? '<button class="btn btn-ghost" id="rem-off">Vypnout</button>'
            : '<button class="btn btn-primary" id="rem-on">Zapnout připomínky</button>'}
        </div>
        ${s.enabled ? '<button class="btn btn-ghost btn-sm" id="rem-test">Poslat zkušební notifikaci</button>' : ''}`;
    }

    section.innerHTML = `<h2>Připomínky</h2>${body}`;

    const timeInput = section.querySelector('#rem-time');
    const busy = (btn, fn) => async () => {
      btn.disabled = true;
      try {
        await fn();
      } finally {
        btn.disabled = false;
      }
    };

    const onBtn = section.querySelector('#rem-on');
    if (onBtn) {
      onBtn.addEventListener('click', busy(onBtn, async () => {
        try {
          await Reminders.enable(timeInput.value || '18:00');
          toast('Připomínky zapnuty');
        } catch (err) {
          console.error(err);
          toast(err.message === 'permission'
            ? 'Bez povolení notifikací připomínky nefungují.'
            : 'Připomínky se nepodařilo zapnout. Zkuste to znovu.');
        }
        renderReminders(section);
      }));
    }

    const offBtn = section.querySelector('#rem-off');
    if (offBtn) {
      offBtn.addEventListener('click', busy(offBtn, async () => {
        await Reminders.disable().catch(console.error);
        toast('Připomínky vypnuty');
        renderReminders(section);
      }));
    }

    if (timeInput && s.enabled) {
      timeInput.addEventListener('change', async () => {
        if (!timeInput.value) return;
        try {
          await Reminders.setTime(timeInput.value);
          toast(`Připomínka nastavena na ${timeInput.value}`);
        } catch (err) {
          console.error(err);
          toast('Čas se nepodařilo uložit na server.');
        }
        renderReminders(section);
      });
    }

    const testBtn = section.querySelector('#rem-test');
    if (testBtn) {
      testBtn.addEventListener('click', busy(testBtn, async () => {
        try {
          await Reminders.sendTest();
          toast('Odesláno, notifikace by měla dorazit za pár sekund');
        } catch (err) {
          console.error(err);
          toast(`Odeslání selhalo: ${err.message}`);
        }
      }));
    }
  }

  function renderAdd() {
    const picked = { front: null, back: null };

    const picker = (side, title, sub) => `
      <label class="picker" data-side="${side}">
        <input type="file" accept="image/*" hidden>
        <div class="picker-preview">
          <span class="picker-empty">${icon('camera')}<strong>${title}</strong><small>${sub}</small></span>
        </div>
        <span class="picker-caption">${title}</span>
      </label>`;

    app.innerHTML = `
      <div class="page-head">
        <a href="#/" class="link-back">${icon('back')}Zpět</a>
        <h1>Nová karta</h1>
      </div>
      <div class="add-grid">
        ${picker('front', 'Přední strana', 'Otázka')}
        ${picker('back', 'Zadní strana', 'Odpověď')}
      </div>
      <button id="save" class="btn btn-primary btn-lg btn-block" disabled>Uložit do Boxu 1</button>`;

    const saveBtn = document.getElementById('save');

    app.querySelectorAll('.picker').forEach((label) => {
      const side = label.dataset.side;
      label.querySelector('input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          picked[side] = await Img.compress(file);
        } catch {
          toast('Tento formát obrázku prohlížeč neumí otevřít.');
          return;
        }
        label.querySelector('.picker-preview').innerHTML = `<img src="${blobUrl(picked[side])}" alt="">`;
        label.classList.add('has-image');
        saveBtn.disabled = !(picked.front && picked.back);
      });
    });

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      await DB.put(createCard(newId(), picked.front, picked.back));
      // Ask the browser not to evict our data under storage pressure.
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      toast('Karta přidána do Boxu 1');
      releaseUrls();
      renderAdd();
    });
  }

  async function renderReview() {
    const queue = (await DB.all()).filter((c) => isDue(c)).sort(compareCards);
    let done = 0;
    let passed = 0;
    let failed = 0;

    if (!queue.length) {
      app.innerHTML = `
        <section class="hero">
          <div class="hero-count">0</div>
          <div class="hero-label">karet k opakování</div>
          <p class="muted">Dnes už nic nečeká.</p>
          <a class="btn btn-primary" href="#/">Na přehled</a>
        </section>`;
      return;
    }

    function finish() {
      keyHandler = null;
      app.innerHTML = `
        <section class="hero">
          <div class="hero-label">Opakování dokončeno</div>
          <div class="summary">
            <div class="summary-item pass">${icon('check')}<strong>${passed}</strong><span>Umím</span></div>
            <div class="summary-item fail">${icon('x')}<strong>${failed}</strong><span>Neumím</span></div>
          </div>
          <a class="btn btn-primary btn-lg" href="#/">Na přehled</a>
        </section>`;
    }

    function show() {
      releaseUrls();
      if (!queue.length) return finish();
      const card = queue[0];
      const pct = Math.round((done / (done + queue.length)) * 100);

      app.innerHTML = `
        <div class="review-head">
          <a href="#/" class="link-back">${icon('back')}Konec</a>
          <span class="pill box-${card.box}">Box ${card.box}</span>
          <span class="muted small">Zbývá ${queue.length}</span>
        </div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        ${flipCardHtml(card)}
        <div class="decision">
          <p class="flip-hint muted">Klepnutím na kartu zobrazíte odpověď</p>
        </div>`;

      const decision = app.querySelector('.decision');
      let revealed = false;

      async function decide(pass) {
        const updated = evaluate(queue.shift(), pass);
        await DB.put(updated);
        done++;
        if (pass) passed++; else failed++;
        // Failed box-1 cards are due again today, so they come back at the end.
        if (isDue(updated)) queue.push(updated);
        show();
      }

      const toggle = mountFlip(() => {
        revealed = true;
        decision.innerHTML = `
          <div class="decision-buttons">${decisionButtons(card.box)}</div>
          <p class="muted small center">${outcomeHint(card.box)}</p>`;
        bindDecision(decision, decide);
      });

      keyHandler = (e) => {
        if (e.key === ' ') { e.preventDefault(); toggle(); return; }
        if (!revealed) return;
        if (e.key === 'ArrowLeft' || e.key === '1') decide(false);
        if ((e.key === 'ArrowRight' || e.key === '2') && card.box !== MASTERED_BOX) decide(true);
      };
    }

    show();
  }

  function sortedBox(cards) {
    return cards.sort((a, b) => (a.box === MASTERED_BOX
      ? (b.lastReviewedAt || '').localeCompare(a.lastReviewedAt || '')
      : compareCards(a, b)));
  }

  async function renderBox(box) {
    const cards = sortedBox(await DB.byBox(box));
    const title = box === MASTERED_BOX ? 'Naučené' : `Box ${box}`;
    const rule = box === MASTERED_BOX
      ? 'Otevřete kartu a otočte ji. Pokud ji už neumíte, vraťte ji tlačítkem ✗ do Boxu 1.'
      : box === 1
        ? 'Nové a zapomenuté karty. Opakují se hned, dokud je nezvládnete.'
        : `Karty se opakují ${BOX_INTERVAL_DAYS[box]} ${plural(BOX_INTERVAL_DAYS[box], 'den', 'dny', 'dní')} po přesunu sem.`;

    app.innerHTML = `
      <div class="page-head">
        <a href="#/" class="link-back">${icon('back')}Přehled</a>
        <h1><span class="dot box-${box}"></span>${title} <span class="muted">(${cards.length})</span></h1>
        <p class="muted small">${rule}</p>
      </div>
      ${cards.length ? `
        <div class="thumb-grid">
          ${cards.map((c) => `
            <a class="thumb" href="#/card/${c.id}">
              <img src="${blobUrl(c.front)}" alt="" loading="lazy">
              <span class="thumb-meta ${isDue(c) ? 'due' : ''}">${dueText(c)}</span>
            </a>`).join('')}
        </div>` : '<p class="empty muted">V tomto boxu nejsou žádné karty.</p>'}`;
  }

  async function renderCard(id) {
    const card = await DB.get(id);
    if (!card) {
      app.innerHTML = `<p class="empty muted">Karta nenalezena. <a href="#/">Zpět na přehled</a></p>`;
      return;
    }
    const siblings = sortedBox(await DB.byBox(card.box));
    const idx = siblings.findIndex((c) => c.id === id);
    const next = siblings[idx + 1];
    const canDecide = card.box === MASTERED_BOX || isDue(card);

    app.innerHTML = `
      <div class="review-head">
        <a href="#/box/${card.box}" class="link-back">${icon('back')}${card.box === MASTERED_BOX ? 'Naučené' : `Box ${card.box}`}</a>
        <span class="muted small">${idx + 1} / ${siblings.length}</span>
        ${next ? `<a href="#/card/${next.id}" class="link-next">Další →</a>` : '<span></span>'}
      </div>
      ${flipCardHtml(card)}
      <div class="decision">
        <p class="flip-hint muted">Klepnutím na kartu ji otočíte</p>
      </div>
      <dl class="meta">
        <div><dt>Box</dt><dd>${card.box}</dd></div>
        <div><dt>Další opakování</dt><dd>${dueText(card)}</dd></div>
        <div><dt>Naposledy</dt><dd>${formatDate(card.lastReviewedAt)}</dd></div>
        <div><dt>Vytvořeno</dt><dd>${formatDate(card.createdAt)}</dd></div>
        <div><dt>Opakování / chyby</dt><dd>${card.reviews || 0} / ${card.lapses || 0}</dd></div>
      </dl>
      <button class="btn btn-ghost btn-danger btn-sm" id="delete">${icon('trash')}<span>Smazat kartu</span></button>`;

    const decision = app.querySelector('.decision');

    async function decide(pass) {
      await DB.put(evaluate(card, pass));
      toast(pass ? `Přesunuto do Boxu ${card.box + 1}` : 'Karta vrácena do Boxu 1');
      location.hash = next ? `#/card/${next.id}` : `#/box/${card.box}`;
    }

    const toggle = mountFlip(() => {
      if (!canDecide) return;
      decision.innerHTML = `<div class="decision-buttons">${decisionButtons(card.box)}</div>`;
      bindDecision(decision, decide);
    });
    keyHandler = (e) => {
      if (e.key === ' ') { e.preventDefault(); toggle(); }
    };

    document.getElementById('delete').addEventListener('click', async () => {
      if (!confirm('Opravdu smazat tuto kartu? Tuto akci nelze vrátit.')) return;
      await DB.remove(id);
      toast('Karta smazána');
      location.hash = `#/box/${card.box}`;
    });
  }

  // ---- Backup ----

  async function exportBackup() {
    const cards = await DB.all();
    const serialized = await Promise.all(cards.map(async (c) => ({
      ...c,
      front: await Img.toDataURL(c.front),
      back: await Img.toDataURL(c.back),
    })));
    const json = JSON.stringify({ app: 'karticky', version: 1, exportedAt: new Date().toISOString(), cards: serialized });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `karticky-zaloha-${dayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importBackup(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      data = null;
    }
    if (!data || data.app !== 'karticky' || !Array.isArray(data.cards)) {
      toast('Soubor není platná záloha Kartiček.');
      return;
    }
    const n = data.cards.length;
    if (!confirm(`Obnovit ${n} ${plural(n, 'kartu', 'karty', 'karet')}? Karty se stejným ID budou přepsány.`)) return;
    await DB.putMany(data.cards.map((c) => ({
      ...c,
      front: Img.fromDataURL(c.front),
      back: Img.fromDataURL(c.back),
    })));
    toast(`Obnoveno ${n} ${plural(n, 'karta', 'karty', 'karet')}`);
    router();
  }

  // ---- Router ----

  const routes = [
    [/^#?\/?$/, () => renderDashboard()],
    [/^#\/add$/, () => renderAdd()],
    [/^#\/review$/, () => renderReview()],
    [/^#\/box\/([1-6])$/, (m) => renderBox(Number(m[1]))],
    [/^#\/card\/([\w-]+)$/, (m) => renderCard(m[1])],
  ];

  async function router() {
    releaseUrls();
    keyHandler = null;
    closeLightbox();
    const hash = location.hash || '#/';
    const route = routes.find(([re]) => re.test(hash));
    try {
      if (route) await route[1](hash.match(route[0]));
      else await renderDashboard();
    } catch (err) {
      console.error(err);
      app.innerHTML = `<p class="empty muted">Něco se pokazilo: ${String(err.message || err)}</p>`;
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', router);
  router();
  Reminders.registerServiceWorker();
  // Due dates shift as days pass, so refresh the server copy whenever the app opens.
  Reminders.scheduleSync();
})();
