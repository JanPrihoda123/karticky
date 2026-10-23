/* UI: hash router + views (decks, deck dashboard, add, review, box browser, card detail). */
(function () {
  'use strict';

  const { BOX_COUNT, MASTERED_BOX, BOX_INTERVAL_DAYS, dayKey, addDays, daysBetween,
    createCard, evaluate, isDue, compareCards } = window.Leitner;

  const app = document.getElementById('app');
  const addLink = document.getElementById('add-link');

  const BOX_LABELS = { 1: 'Nové', 2: 'Po 1 dni', 3: 'Po 5 dnech', 4: 'Po 7 dnech', 5: 'Po 14 dnech', 6: 'Naučené' };
  const DECK_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899'];
  const LAST_DECK_KEY = 'karticky-last-deck';
  const ADD_MODE_KEY = 'karticky-add-mode';

  const ICON_PATHS = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    chevron: '<path d="M9 18l6-6-6-6"/>',
    camera: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.4-2h6.6l1.4 2h1.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
    zoom: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M11 8.5v5M8.5 11h5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4h6v3"/>',
    text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
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

  const cardsWord = (n) => plural(n, 'karta', 'karty', 'karet');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

  function deckColor(deck) {
    return DECK_COLORS[(deck && deck.color) % DECK_COLORS.length] || DECK_COLORS[0];
  }

  async function sortedDecks() {
    return (await DB.decks()).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }

  function stats(cards) {
    const s = { total: 0, due: 0, mastered: 0, boxes: Array(BOX_COUNT + 1).fill(0) };
    for (const c of cards) {
      s.total++;
      s.boxes[c.box]++;
      if (isDue(c)) s.due++;
      if (c.box === MASTERED_BOX) s.mastered++;
    }
    return s;
  }

  function rememberDeck(id) {
    try { localStorage.setItem(LAST_DECK_KEY, id); } catch { /* private mode */ }
  }

  function lastDeck() {
    try { return localStorage.getItem(LAST_DECK_KEY); } catch { return null; }
  }

  // Photo or text per side, remembered so typing a batch of cards stays quick.
  function addModes() {
    try {
      return { front: 'photo', back: 'photo', ...JSON.parse(localStorage.getItem(ADD_MODE_KEY)) };
    } catch {
      return { front: 'photo', back: 'photo' };
    }
  }

  function saveAddModes(modes) {
    try { localStorage.setItem(ADD_MODE_KEY, JSON.stringify(modes)); } catch { /* private mode */ }
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
    if (keyHandler && !e.target.closest('input, textarea, select, button')) keyHandler(e);
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

  function textSize(text) {
    if (text.length <= 24) return 'text-lg';
    if (text.length <= 120) return 'text-md';
    return 'text-sm';
  }

  function faceHtml(card, side) {
    const label = side === 'front' ? 'Otázka' : 'Odpověď';
    const text = card[`${side}Text`];
    if (text) {
      return `
        <div class="face face-${side}">
          <p class="face-text ${textSize(text)}">${esc(text)}</p>
          <span class="face-tag">${label}</span>
        </div>`;
    }
    const src = blobUrl(card[side]);
    return `
      <div class="face face-${side}">
        <img src="${src}" alt="${label}">
        <span class="face-tag">${label}</span>
        <button class="zoom" data-src="${src}" aria-label="Zvětšit">${icon('zoom')}</button>
      </div>`;
  }

  function flipCardHtml(card) {
    return `
      <div class="flip" role="button" tabindex="0" aria-label="Otočit kartu">
        <div class="flip-inner">
          ${faceHtml(card, 'front')}
          ${faceHtml(card, 'back')}
        </div>
      </div>`;
  }

  function thumbHtml(card) {
    return card.frontText
      ? `<span class="thumb-text">${esc(card.frontText)}</span>`
      : `<img src="${blobUrl(card.front)}" alt="" loading="lazy">`;
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

  function boxGridHtml(deckId, boxes) {
    return `
      <div class="box-grid">
        ${[1, 2, 3, 4, 5, 6].map((b) => `
          <a class="box-tile box-${b}" href="#/deck/${deckId}/box/${b}">
            <span class="box-name">${b === MASTERED_BOX ? 'Naučené' : `Box ${b}`}</span>
            <span class="box-count">${boxes[b]}</span>
            <span class="box-label">${b === MASTERED_BOX ? 'Box 6' : BOX_LABELS[b]}</span>
          </a>`).join('')}
      </div>`;
  }

  // ---- Views ----

  async function renderHome() {
    const [decks, cards] = await Promise.all([sortedDecks(), DB.all()]);
    const total = stats(cards);
    const tomorrow = addDays(dayKey(), 1);
    const dueTomorrow = cards.filter((c) => !isDue(c) && c.nextReviewDate === tomorrow).length;

    let heroBody;
    if (total.due) {
      heroBody = `<a class="btn btn-primary btn-lg" href="#/review">Opakovat vše</a>`;
    } else if (cards.length) {
      heroBody = `<p class="muted">Pro dnešek hotovo.</p>`;
    } else if (decks.length) {
      heroBody = `<p class="muted">Otevřete sadu a přidejte do ní první kartu.</p>`;
    } else {
      heroBody = `<p class="muted">Začněte tím, že si vytvoříte sadu, třeba Angličtina nebo Matematika.</p>`;
    }

    app.innerHTML = `
      <section class="hero">
        <div class="hero-count">${total.due}</div>
        <div class="hero-label">${cardsWord(total.due)} k opakování dnes</div>
        ${heroBody}
        ${dueTomorrow ? `<p class="muted small">Zítra: ${dueTomorrow} ${cardsWord(dueTomorrow)}</p>` : ''}
      </section>

      <div class="section-head">
        <h2>Sady</h2>
        <span class="muted small">${decks.length} ${plural(decks.length, 'sada', 'sady', 'sad')} · ${cards.length} ${cardsWord(cards.length)}</span>
      </div>
      <div class="deck-list">
        ${decks.map((d) => {
          const s = stats(cards.filter((c) => c.deckId === d.id));
          const right = s.due
            ? `<span class="deck-due" title="K opakování dnes">${s.due}</span>`
            : `<span class="muted small">${s.total ? 'Hotovo' : 'Prázdná'}</span>`;
          return `
            <a class="deck-row" href="#/deck/${d.id}" style="--c:${deckColor(d)}">
              <span class="deck-dot"></span>
              <span class="deck-info">
                <strong>${esc(d.name)}</strong>
                <span class="muted small">${s.total} ${cardsWord(s.total)} · ${s.mastered} naučeno</span>
              </span>
              ${right}
              ${icon('chevron')}
            </a>`;
        }).join('')}
      </div>
      <form class="inline-form" id="new-deck">
        <input name="name" maxlength="40" placeholder="Nová sada, např. Angličtina" required autocomplete="off">
        <button class="btn btn-primary" type="submit">Vytvořit</button>
      </form>

      <section class="settings-section" id="reminders"></section>

      <section class="settings-section">
        <h2>Záloha</h2>
        <p class="muted small">Karty jsou uložené jen v tomto zařízení. Občas si stáhněte zálohu.</p>
        <div class="backup-actions">
          <button class="btn btn-ghost" id="export" ${cards.length ? '' : 'disabled'}>Stáhnout zálohu</button>
          <label class="btn btn-ghost">Obnovit ze zálohy<input type="file" id="import" accept=".json,application/json" hidden></label>
        </div>
      </section>`;

    Reminders.updateBadge(total.due);
    renderReminders(document.getElementById('reminders'));

    document.getElementById('new-deck').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = e.target.name.value.trim();
      if (!name) return;
      const deck = { id: newId(), name, color: decks.length % DECK_COLORS.length, createdAt: new Date().toISOString() };
      await DB.putDeck(deck);
      location.hash = `#/deck/${deck.id}`;
    });
    document.getElementById('export').addEventListener('click', exportBackup);
    document.getElementById('import').addEventListener('change', (e) => {
      if (e.target.files[0]) importBackup(e.target.files[0]);
    });
  }

  async function renderDeck(deckId) {
    const deck = await DB.getDeck(deckId);
    if (!deck) {
      location.hash = '#/';
      return;
    }
    const cards = await DB.byDeck(deckId);
    const s = stats(cards);
    rememberDeck(deckId);

    let heroBody;
    if (s.due) {
      heroBody = `<a class="btn btn-primary btn-lg" href="#/deck/${deckId}/review">Začít opakování</a>`;
    } else if (cards.length) {
      heroBody = `<p class="muted">Pro dnešek hotovo.</p>`;
    } else {
      heroBody = `<p class="muted">Sada je zatím prázdná. Vyfoťte otázku a odpověď.</p>`;
    }

    app.innerHTML = `
      <div class="page-head">
        <a href="#/" class="link-back">${icon('back')}Sady</a>
        <h1><span class="dot" style="--c:${deckColor(deck)}"></span>${esc(deck.name)}</h1>
      </div>

      <section class="hero">
        <div class="hero-count">${s.due}</div>
        <div class="hero-label">${cardsWord(s.due)} k opakování dnes</div>
        ${heroBody}
        <a class="btn ${cards.length ? 'btn-ghost' : 'btn-primary btn-lg'}" href="#/add/${deckId}">${icon('camera')}<span>Přidat kartu</span></a>
      </section>

      <div class="section-head">
        <h2>Boxy</h2>
        <span class="muted small">Celkem ${s.total}</span>
      </div>
      ${boxGridHtml(deckId, s.boxes)}

      <section class="settings-section">
        <h2>Upravit sadu</h2>
        <form class="inline-form" id="rename">
          <input name="name" maxlength="40" value="${esc(deck.name)}" required autocomplete="off" aria-label="Název sady">
          <button class="btn btn-ghost" type="submit">Přejmenovat</button>
        </form>
        <button class="btn btn-ghost btn-danger btn-sm" id="delete-deck">${icon('trash')}<span>Smazat sadu</span></button>
      </section>`;

    document.getElementById('rename').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = e.target.name.value.trim();
      if (!name || name === deck.name) return;
      await DB.putDeck({ ...deck, name });
      toast('Sada přejmenována');
      renderDeck(deckId);
    });

    document.getElementById('delete-deck').addEventListener('click', async () => {
      const msg = cards.length
        ? `Smazat sadu „${deck.name}“ včetně ${cards.length} ${plural(cards.length, 'karty', 'karet', 'karet')}? Tuto akci nelze vrátit.`
        : `Smazat prázdnou sadu „${deck.name}“?`;
      if (!confirm(msg)) return;
      await DB.removeDeck(deckId);
      toast('Sada smazána');
      location.hash = '#/';
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

  async function renderAdd(deckId) {
    const decks = await sortedDecks();
    if (!decks.length) {
      app.innerHTML = `
        <div class="page-head">
          <a href="#/" class="link-back">${icon('back')}Sady</a>
          <h1>Nová karta</h1>
        </div>
        <p class="empty muted">Nejdřív si vytvořte sadu, do které karty přidáte.<br><br>
          <a class="btn btn-primary" href="#/">Vytvořit sadu</a></p>`;
      return;
    }

    const preferred = [deckId, lastDeck()].find((id) => decks.some((d) => d.id === id)) || decks[0].id;
    const picked = { front: null, back: null };
    const modes = addModes();

    const sideEditor = (side, title, sub) => `
      <div class="side-editor" data-side="${side}" data-mode="${modes[side]}">
        <div class="side-head">
          <span class="side-title">${title}</span>
          <div class="segmented" role="group" aria-label="${title}: fotka nebo text">
            <button type="button" data-mode="photo">${icon('camera')}Fotka</button>
            <button type="button" data-mode="text">${icon('text')}Text</button>
          </div>
        </div>
        <label class="picker">
          <input type="file" accept="image/*" hidden>
          <div class="picker-preview">
            <span class="picker-empty">${icon('camera')}<strong>Vyfotit nebo vybrat</strong><small>${sub}</small></span>
          </div>
        </label>
        <textarea class="side-text" maxlength="500" placeholder="${sub}…" aria-label="${title}: ${sub}"></textarea>
      </div>`;

    app.innerHTML = `
      <div class="page-head">
        <a href="#/deck/${preferred}" class="link-back" id="add-back">${icon('back')}Zpět</a>
        <h1>Nová karta</h1>
      </div>
      <label class="field">
        <span>Sada</span>
        <select id="deck">
          ${decks.map((d) => `<option value="${d.id}" ${d.id === preferred ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
        </select>
      </label>
      <div class="add-grid">
        ${sideEditor('front', 'Přední strana', 'Otázka')}
        ${sideEditor('back', 'Zadní strana', 'Odpověď')}
      </div>
      <button id="save" class="btn btn-primary btn-lg btn-block" disabled>Uložit do Boxu 1</button>`;

    const saveBtn = document.getElementById('save');
    const deckSelect = document.getElementById('deck');
    const editor = (side) => app.querySelector(`.side-editor[data-side="${side}"]`);

    // { blob, text } for a side, using whichever mode is currently selected.
    function sideContent(side) {
      const ed = editor(side);
      return ed.dataset.mode === 'text'
        ? { blob: null, text: ed.querySelector('textarea').value.trim() || null }
        : { blob: picked[side], text: null };
    }

    function updateSave() {
      const filled = (s) => { const c = sideContent(s); return Boolean(c.blob || c.text); };
      saveBtn.disabled = !(filled('front') && filled('back'));
    }

    deckSelect.addEventListener('change', () => {
      rememberDeck(deckSelect.value);
      document.getElementById('add-back').href = `#/deck/${deckSelect.value}`;
      addLink.href = `#/add/${deckSelect.value}`;
    });

    app.querySelectorAll('.side-editor').forEach((ed) => {
      const side = ed.dataset.side;
      const label = ed.querySelector('.picker');
      const textarea = ed.querySelector('textarea');

      ed.querySelectorAll('.segmented button').forEach((btn) => {
        btn.addEventListener('click', () => {
          ed.dataset.mode = btn.dataset.mode;
          modes[side] = btn.dataset.mode;
          saveAddModes(modes);
          if (btn.dataset.mode === 'text') textarea.focus();
          updateSave();
        });
      });

      textarea.addEventListener('input', updateSave);

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
        updateSave();
      });
    });

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      const chosen = deckSelect.value;
      const front = sideContent('front');
      const back = sideContent('back');
      await DB.put({
        ...createCard(newId(), { front: front.blob, frontText: front.text, back: back.blob, backText: back.text }),
        deckId: chosen,
      });
      rememberDeck(chosen);
      // Ask the browser not to evict our data under storage pressure.
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      const deckName = decks.find((d) => d.id === chosen).name;
      toast(`Karta přidána do sady ${deckName}`);
      releaseUrls();
      await renderAdd(chosen);
      // Ready for the next typed card straight away.
      const firstText = app.querySelector('.side-editor[data-side="front"][data-mode="text"] textarea');
      if (firstText) firstText.focus();
    });
  }

  async function renderReview(deckId) {
    const [decks, all] = await Promise.all([sortedDecks(), deckId ? DB.byDeck(deckId) : DB.all()]);
    const deckById = Object.fromEntries(decks.map((d) => [d.id, d]));
    const queue = all.filter((c) => isDue(c)).sort(compareCards);
    const exit = deckId ? `#/deck/${deckId}` : '#/';
    let done = 0;
    let passed = 0;
    let failed = 0;

    if (!queue.length) {
      app.innerHTML = `
        <section class="hero">
          <div class="hero-count">0</div>
          <div class="hero-label">karet k opakování</div>
          <p class="muted">Dnes už nic nečeká.</p>
          <a class="btn btn-primary" href="${exit}">Zpět</a>
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
          <a class="btn btn-primary btn-lg" href="${exit}">${deckId ? 'Zpět na sadu' : 'Na přehled'}</a>
        </section>`;
    }

    function show() {
      releaseUrls();
      if (!queue.length) return finish();
      const card = queue[0];
      const deck = deckById[card.deckId];
      const pct = Math.round((done / (done + queue.length)) * 100);

      app.innerHTML = `
        <div class="review-head">
          <a href="${exit}" class="link-back">${icon('back')}Konec</a>
          <span class="pill box-${card.box}">Box ${card.box}</span>
          <span class="muted small">Zbývá ${queue.length}</span>
        </div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        ${!deckId && deck ? `<p class="review-deck" style="--c:${deckColor(deck)}"><span class="dot"></span>${esc(deck.name)}</p>` : ''}
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

  async function boxCards(deckId, box) {
    return sortedBox((await DB.byDeck(deckId)).filter((c) => c.box === box));
  }

  async function renderBox(deckId, box) {
    const deck = await DB.getDeck(deckId);
    if (!deck) {
      location.hash = '#/';
      return;
    }
    const cards = await boxCards(deckId, box);
    const title = box === MASTERED_BOX ? 'Naučené' : `Box ${box}`;
    const rule = box === MASTERED_BOX
      ? 'Otevřete kartu a otočte ji. Pokud ji už neumíte, vraťte ji tlačítkem ✗ do Boxu 1.'
      : box === 1
        ? 'Nové a zapomenuté karty. Opakují se hned, dokud je nezvládnete.'
        : `Karty se opakují ${BOX_INTERVAL_DAYS[box]} ${plural(BOX_INTERVAL_DAYS[box], 'den', 'dny', 'dní')} po přesunu sem.`;

    app.innerHTML = `
      <div class="page-head">
        <a href="#/deck/${deckId}" class="link-back">${icon('back')}${esc(deck.name)}</a>
        <h1><span class="dot box-${box}"></span>${title} <span class="muted">(${cards.length})</span></h1>
        <p class="muted small">${rule}</p>
      </div>
      ${cards.length ? `
        <div class="thumb-grid">
          ${cards.map((c) => `
            <a class="thumb" href="#/card/${c.id}">
              ${thumbHtml(c)}
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
    const [decks, siblings] = await Promise.all([sortedDecks(), boxCards(card.deckId, card.box)]);
    const idx = siblings.findIndex((c) => c.id === id);
    const next = siblings[idx + 1];
    const canDecide = card.box === MASTERED_BOX || isDue(card);
    const boxHash = `#/deck/${card.deckId}/box/${card.box}`;

    app.innerHTML = `
      <div class="review-head">
        <a href="${boxHash}" class="link-back">${icon('back')}${card.box === MASTERED_BOX ? 'Naučené' : `Box ${card.box}`}</a>
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
      <label class="field">
        <span>Sada</span>
        <select id="move-deck">
          ${decks.map((d) => `<option value="${d.id}" ${d.id === card.deckId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
        </select>
      </label>
      <button class="btn btn-ghost btn-danger btn-sm" id="delete">${icon('trash')}<span>Smazat kartu</span></button>`;

    const decision = app.querySelector('.decision');

    async function decide(pass) {
      await DB.put(evaluate(card, pass));
      toast(pass ? `Přesunuto do Boxu ${card.box + 1}` : 'Karta vrácena do Boxu 1');
      location.hash = next ? `#/card/${next.id}` : boxHash;
    }

    const toggle = mountFlip(() => {
      if (!canDecide) return;
      decision.innerHTML = `<div class="decision-buttons">${decisionButtons(card.box)}</div>`;
      bindDecision(decision, decide);
    });
    keyHandler = (e) => {
      if (e.key === ' ') { e.preventDefault(); toggle(); }
    };

    document.getElementById('move-deck').addEventListener('change', async (e) => {
      const target = decks.find((d) => d.id === e.target.value);
      await DB.put({ ...card, deckId: target.id });
      toast(`Karta přesunuta do sady ${target.name}`);
      router();
    });

    document.getElementById('delete').addEventListener('click', async () => {
      if (!confirm('Opravdu smazat tuto kartu? Tuto akci nelze vrátit.')) return;
      await DB.remove(id);
      toast('Karta smazána');
      location.hash = boxHash;
    });
  }

  // ---- Backup ----

  async function exportBackup() {
    const [decks, cards] = await Promise.all([DB.decks(), DB.all()]);
    const serialized = await Promise.all(cards.map(async (c) => ({
      ...c,
      front: c.front ? await Img.toDataURL(c.front) : null,
      back: c.back ? await Img.toDataURL(c.back) : null,
    })));
    const json = JSON.stringify({ app: 'karticky', version: 2, exportedAt: new Date().toISOString(), decks, cards: serialized });
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

    // Backups from before decks existed (or cards pointing at a missing deck) go to the default deck.
    const decks = Array.isArray(data.decks) ? data.decks : [];
    const known = new Set([...decks, ...(await DB.decks())].map((d) => d.id));
    let needsDefault = false;
    const cards = data.cards.map((c) => {
      let deckId = c.deckId;
      if (!deckId || !known.has(deckId)) {
        deckId = DB.DEFAULT_DECK.id;
        needsDefault = !known.has(deckId);
      }
      return {
        ...c,
        deckId,
        front: c.front ? Img.fromDataURL(c.front) : null,
        back: c.back ? Img.fromDataURL(c.back) : null,
      };
    });
    if (needsDefault) decks.push({ ...DB.DEFAULT_DECK, createdAt: new Date().toISOString() });

    await DB.importAll(decks, cards);
    toast(`Obnoveno ${n} ${cardsWord(n)}`);
    router();
  }

  // ---- Router ----

  const ID = '([\\w-]+)';
  const routes = [
    [/^#?\/?$/, () => renderHome()],
    [/^#\/review$/, () => renderReview(null)],
    [new RegExp(`^#/deck/${ID}$`), (m) => renderDeck(m[1])],
    [new RegExp(`^#/deck/${ID}/review$`), (m) => renderReview(m[1])],
    [new RegExp(`^#/deck/${ID}/box/([1-6])$`), (m) => renderBox(m[1], Number(m[2]))],
    [new RegExp(`^#/add(?:/${ID})?$`), (m) => renderAdd(m[1])],
    [new RegExp(`^#/card/${ID}$`), (m) => renderCard(m[1])],
  ];

  async function router() {
    releaseUrls();
    keyHandler = null;
    closeLightbox();
    const hash = location.hash || '#/';
    // The header's "new card" button adds to the deck currently on screen.
    const deckMatch = hash.match(/^#\/(?:deck|add)\/([\w-]+)/);
    addLink.href = deckMatch ? `#/add/${deckMatch[1]}` : '#/add';
    const route = routes.find(([re]) => re.test(hash));
    try {
      if (route) await route[1](hash.match(route[0]));
      else location.hash = '#/';
    } catch (err) {
      console.error(err);
      app.innerHTML = `<p class="empty muted">Něco se pokazilo: ${esc(err.message || err)}</p>`;
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', router);
  router();
  Reminders.registerServiceWorker();
  // Due dates shift as days pass, so refresh the server copy whenever the app opens.
  Reminders.scheduleSync();
})();
