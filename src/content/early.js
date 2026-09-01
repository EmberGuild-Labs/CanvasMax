/**
 * CanvasMax — first paint.
 *
 * This runs at document_start, before Canvas renders anything. Reading the
 * user's settings from chrome.storage is asynchronous, and awaiting it would
 * mean a white flash on every page load for anyone using a dark theme.
 *
 * So the main content script mirrors just enough of the settings into the
 * page origin's localStorage, which a content script can read *synchronously*.
 * This file reads that mirror, resolves light vs. dark itself (so "system" and
 * scheduled modes stay correct without the cache going stale), and writes the
 * variables into the document before the first paint.
 *
 * The very first page load after installing has no mirror yet and will flash
 * once; every load after that is clean.
 */
(function () {
  'use strict';

  const BOOT_KEY = 'cmx:boot';

  function readBootCache() {
    try {
      const raw = window.localStorage.getItem(BOOT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      // Storage can be unavailable (third-party cookie blocking, privacy mode).
      // Falling through just means the async path handles theming instead.
      return null;
    }
  }

  /** Mirror of themes.isWithinSchedule, kept local so this file has no deps. */
  function isWithinSchedule(now, start, end) {
    const toMinutes = (hhmm) => {
      const parts = String(hhmm || '').split(':');
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      if (!Number.isFinite(h)) return null;
      return h * 60 + (Number.isFinite(m) ? m : 0);
    };
    const startMin = toMinutes(start);
    const endMin = toMinutes(end);
    if (startMin === null || endMin === null || startMin === endMin) return false;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return startMin < endMin
      ? nowMin >= startMin && nowMin < endMin
      : nowMin >= startMin || nowMin < endMin;
  }

  function prefersDark() {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  }

  function resolveDark(cache) {
    switch (cache.mode) {
      case 'dark': return true;
      case 'light': return false;
      case 'schedule': return isWithinSchedule(new Date(), cache.scheduleStart, cache.scheduleEnd);
      case 'system':
      default: return prefersDark();
    }
  }

  const cache = readBootCache();
  if (!cache || cache.enabled === false) return;

  const root = document.documentElement;
  const dark = resolveDark(cache);
  const vars = dark ? cache.darkVars : cache.lightVars;
  if (!vars) return;

  root.classList.add('cmx-themed');
  root.classList.toggle('cmx-dark', dark);
  root.classList.toggle('cmx-light', !dark);

  // Toggle classes are precomputed by the main script (card style, tweaks).
  for (const name of cache.classes || []) root.classList.add(name);

  // Setting properties directly on the root element beats injecting a <style>
  // here: no parser round-trip, and it cannot be clobbered by Canvas's own
  // stylesheets arriving afterwards.
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }

  if (cache.extraCss) {
    const style = document.createElement('style');
    style.id = 'cmx-early-css';
    style.textContent = cache.extraCss;
    root.appendChild(style);
  }
})();
