/*
 * Leitner scheduling — pure functions, no DOM or storage access.
 *
 * Card shape (each side is either a photo Blob or text; the other field is null):
 *   { id, deckId, front: Blob | null, frontText: string | null,
 *     back: Blob | null, backText: string | null, box: 1..6, createdAt: ISO,
 *     lastReviewedAt: ISO | null, nextReviewDate: "YYYY-MM-DD" | null,
 *     reviews: number, lapses: number }
 */
(function (global) {
  'use strict';

  const BOX_COUNT = 6;
  const MASTERED_BOX = 6;

  // Days a card waits after entering a box before it is due again.
  // Box 6 (mastered) is never scheduled; it only leaves via an explicit reset.
  const BOX_INTERVAL_DAYS = { 1: 0, 2: 1, 3: 5, 4: 7, 5: 14, 6: null };

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  // Due dates are local calendar days ("YYYY-MM-DD"), so a review late in the
  // evening still counts for that day and string comparison orders them.
  function dayKey(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseDay(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(key, days) {
    const date = parseDay(key);
    date.setDate(date.getDate() + days);
    return dayKey(date);
  }

  // Rounded because DST days are 23 or 25 hours long.
  function daysBetween(fromKey, toKey) {
    return Math.round((parseDay(toKey) - parseDay(fromKey)) / 86400000);
  }

  // content: { front, frontText, back, backText }
  function createCard(id, content, now = new Date()) {
    return {
      id,
      front: content.front || null,
      frontText: content.frontText || null,
      back: content.back || null,
      backText: content.backText || null,
      box: 1,
      createdAt: now.toISOString(),
      lastReviewedAt: null,
      nextReviewDate: dayKey(now),
      reviews: 0,
      lapses: 0,
    };
  }

  // Pass moves the card up one box; fail always sends it back to box 1,
  // where it is due again the same day.
  function evaluate(card, passed, now = new Date()) {
    if (passed && card.box === MASTERED_BOX) {
      throw new Error('Mastered cards can only be reset.');
    }
    const box = passed ? card.box + 1 : 1;
    const interval = BOX_INTERVAL_DAYS[box];
    return {
      ...card,
      box,
      lastReviewedAt: now.toISOString(),
      nextReviewDate: interval === null ? null : addDays(dayKey(now), interval),
      reviews: (card.reviews || 0) + 1,
      lapses: (card.lapses || 0) + (passed ? 0 : 1),
    };
  }

  function isDue(card, now = new Date()) {
    return card.box !== MASTERED_BOX
      && card.nextReviewDate != null
      && card.nextReviewDate <= dayKey(now);
  }

  // Earliest due first, then lower box, then oldest card.
  function compareCards(a, b) {
    const ad = a.nextReviewDate || '9999-12-31';
    const bd = b.nextReviewDate || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    if (a.box !== b.box) return a.box - b.box;
    return a.createdAt < b.createdAt ? -1 : 1;
  }

  global.Leitner = {
    BOX_COUNT,
    MASTERED_BOX,
    BOX_INTERVAL_DAYS,
    dayKey,
    addDays,
    daysBetween,
    createCard,
    evaluate,
    isDue,
    compareCards,
  };
})(self); // `self` so the service worker can importScripts() this file too
