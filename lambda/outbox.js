'use strict';
// Copia di sicurezza: ntfy tiene i messaggi 12 ore. La skill conserva ogni pensiero (cifrato) per 7 giorni e, a ogni
// uso, rimanda quelli inviati più di 11 ore fa. L'app scarta i doppioni (stesso id), quindi rimandare non crea copie.
const KEEP_MS = 7 * 24 * 3600 * 1000;
const REPOST_MS = 11 * 3600 * 1000;
const MAX_ENTRIES = 200;
const MAX_POSTS_PER_USE = 20;

function prune(list, now) {
  return (Array.isArray(list) ? list : []).filter((e) => e && e.id && e.sealed && now - e.at < KEEP_MS).slice(-MAX_ENTRIES);
}

/** Da inviare adesso: mai inviati o inviati più di 11 ore fa; i più recenti per primi. */
function due(list, now) {
  return list
    .filter((e) => now - (e.postedAt || 0) >= REPOST_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_POSTS_PER_USE);
}

module.exports = { prune, due, KEEP_MS, REPOST_MS };
