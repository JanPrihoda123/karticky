# Kartičky

Flashcard review app using the Leitner box system. Cards are grouped into decks; each side of a card is either a photo or typed text.

## Architecture

A static web app with no build step and no server:

- **HTML + CSS + plain JavaScript**: opens in any modern browser on a phone or a computer.
- **IndexedDB** stores the cards, photos included (as Blobs), in the browser. Photos are shrunk to at most 1600 px when uploaded.
- **Backup**: the dashboard can export all cards to a single JSON file and restore them from it. Data lives in one browser only, so back up regularly.

| File | Role |
| --- | --- |
| `js/scheduler.js` | Pure Leitner logic: card shape, intervals, `evaluate`, `isDue` |
| `js/db.js` | IndexedDB wrapper (`DB.all/get/byBox/put/putMany/remove`) |
| `js/images.js` | Photo downscaling, data-URL conversion for backups |
| `js/app.js` | Hash router and views: dashboard, add, review, box, card detail |
| `css/styles.css` | Mobile-first styles, light/dark mode |

## Data schema

Two IndexedDB stores (schema version 2). Upgrading from version 1 moves existing cards into a default deck, "Moje kartičky".

```js
// decks
{ id: string, name: string, color: number, createdAt: ISO timestamp }

// cards
{
  id: string,
  deckId: string,
  front: Blob | null,        // question photo, or
  frontText: string | null,  // typed question
  back: Blob | null,         // answer photo, or
  backText: string | null,   // typed answer
  box: 1..6,
  createdAt: ISO timestamp,
  lastReviewedAt: ISO timestamp | null,
  nextReviewDate: "YYYY-MM-DD" | null,   // local calendar day; null in box 6
  reviews: number,
  lapses: number             // number of fails
}
```

## Scheduling

| Box | Due after entering | Pass | Fail |
| --- | --- | --- | --- |
| 1 | same day | → Box 2 | stays in Box 1 (due again today) |
| 2 | 1 day | → Box 3 | → Box 1 |
| 3 | 5 days | → Box 4 | → Box 1 |
| 4 | 7 days | → Box 5 | → Box 1 |
| 5 | 14 days | → Box 6 | → Box 1 |
| 6 (Naučené) | never scheduled | — | → Box 1 (only action) |

Due dates are local calendar days, so anything due "today" can be reviewed at any time that day. Cards failed during a session come back at the end of the same session.

Box 6 cards never show up in daily review. To check them, open **Naučené** on the dashboard, tap a card to flip it, and press ✗ if you've forgotten it.

## Running

Opening `index.html` directly works in most browsers. A local server is more reliable:

```bash
python -m http.server 8080
```

Then open http://localhost:8080.

To use it on a phone, host the folder on any static host (GitHub Pages, Netlify, Cloudflare Pages) and open the URL there. Each device keeps its own cards; move them between devices with backup/restore.

Desktop keyboard shortcuts during review: **Space** flips, **←** / **1** = fail, **→** / **2** = pass.
