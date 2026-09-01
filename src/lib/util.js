/**
 * CanvasMax — shared utilities.
 *
 * Every file in this project is a classic (non-module) script that hangs its
 * exports off a single `CanvasMax` global. That is deliberate: MV3 does not
 * support `type: "module"` for declarative content scripts, and this keeps the
 * extension buildless — what you read in the repo is exactly what ships.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});

  // ---------------------------------------------------------------- DOM ----

  const qs = (sel, ctx = document) => ctx.querySelector(sel);
  const qsa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  /**
   * Create an element. `attrs` understands `class`, `text`, `html`, `style`
   * (object), `dataset` (object), `on` (event map) and any plain attribute.
   */
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'on') for (const [ev, fn] of Object.entries(value)) node.addEventListener(ev, fn);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of [].concat(children)) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  /** Resolve once the DOM is parsed (immediately if it already is). */
  function ready() {
    if (document.readyState === 'loading') {
      return new Promise((resolve) =>
        document.addEventListener('DOMContentLoaded', () => resolve(), { once: true })
      );
    }
    return Promise.resolve();
  }

  /**
   * Wait for a selector to appear, giving up after `timeout` ms.
   * Canvas renders much of its UI client-side, so most features need this
   * rather than a bare querySelector at document_idle.
   */
  function waitFor(selector, { timeout = 10000, ctx = document } = {}) {
    const existing = qs(selector, ctx);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      let timer = null;
      const observer = new MutationObserver(() => {
        const found = qs(selector, ctx);
        if (found) {
          observer.disconnect();
          if (timer) clearTimeout(timer);
          resolve(found);
        }
      });
      observer.observe(ctx === document ? document.documentElement : ctx, {
        childList: true,
        subtree: true,
      });
      timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  /** Run `fn` now and again whenever the subtree changes, coalesced per frame. */
  function observe(target, fn, options = { childList: true, subtree: true }) {
    let scheduled = false;
    const run = () => {
      scheduled = false;
      try {
        fn();
      } catch (err) {
        console.error('[CanvasMax] observer callback failed', err);
      }
    };
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(run);
    });
    observer.observe(target, options);
    run();
    return observer;
  }

  function debounce(fn, ms = 150) {
    let timer = null;
    return function debounced(...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // -------------------------------------------------------------- text ----

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch]);
  }

  /** Strip tags from Canvas-supplied HTML and collapse whitespace. */
  function stripHtml(html, maxLength = 0) {
    const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
    let text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    if (maxLength && text.length > maxLength) text = `${text.slice(0, maxLength - 1).trimEnd()}…`;
    return text;
  }

  // ------------------------------------------------------------- colors ----

  /** Accepts #rgb, #rrggbb, or #rrggbbaa. Returns {r,g,b,a} or null. */
  function parseHex(hex) {
    const match = /^#?([0-9a-f]{3,8})$/i.exec(String(hex ?? '').trim());
    if (!match) return null;
    let body = match[1];
    if (body.length === 3) body = body.split('').map((c) => c + c).join('');
    if (body.length === 6) body += 'ff';
    if (body.length !== 8) return null;
    return {
      r: parseInt(body.slice(0, 2), 16),
      g: parseInt(body.slice(2, 4), 16),
      b: parseInt(body.slice(4, 6), 16),
      a: parseInt(body.slice(6, 8), 16) / 255,
    };
  }

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function toHex({ r, g, b }) {
    const part = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
    return `#${part(r)}${part(g)}${part(b)}`;
  }

  /** WCAG relative luminance, 0 (black) to 1 (white). */
  function luminance(hex) {
    const rgb = parseHex(hex);
    if (!rgb) return 0;
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  }

  /** WCAG contrast ratio between two hex colors, 1..21. */
  function contrastRatio(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  const INK_DARK = '#12151a';
  const INK_LIGHT = '#ffffff';

  /**
   * Pick whichever of black/white text is more readable on `background`.
   *
   * This measures both candidates rather than testing the background's
   * luminance against a fixed cutoff. A cutoff gets mid-tones wrong: a mid
   * blue like #4f8cff sits below the threshold, so a cutoff hands back white
   * for 3.2:1 — under WCAG AA — when black would have given 7.3:1. Users pick
   * arbitrary accent colours, so this has to be right across the whole range,
   * not just at the ends.
   */
  function readableTextOn(background) {
    return contrastRatio(INK_DARK, background) >= contrastRatio(INK_LIGHT, background)
      ? INK_DARK
      : INK_LIGHT;
  }

  /** Linear blend of two hex colors; `amount` 0 => a, 1 => b. */
  function mix(a, b, amount) {
    const ca = parseHex(a);
    const cb = parseHex(b);
    if (!ca || !cb) return a;
    const t = clamp(amount, 0, 1);
    return toHex({
      r: ca.r + (cb.r - ca.r) * t,
      g: ca.g + (cb.g - ca.g) * t,
      b: ca.b + (cb.b - ca.b) * t,
    });
  }

  const lighten = (hex, amount) => mix(hex, '#ffffff', amount);
  const darken = (hex, amount) => mix(hex, '#000000', amount);

  /** Deterministic pleasant color for a course that has none assigned. */
  function colorFromString(value) {
    let hash = 0;
    const str = String(value ?? '');
    for (let i = 0; i < str.length; i += 1) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    return hslToHex(hue, 62, 46);
  }

  /**
   * Parse any computed CSS color — `rgb()`, `rgba()`, `#hex`, `transparent` —
   * into {r, g, b, a}. getComputedStyle always hands back rgb/rgba, but hex is
   * accepted so the same helper works on authored values.
   */
  function parseCssColor(value) {
    const input = String(value ?? '').trim().toLowerCase();
    if (!input || input === 'transparent' || input === 'none') return null;

    const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)$/.exec(input);
    if (rgb) {
      let alpha = rgb[4] === undefined ? 1 : parseFloat(rgb[4]);
      if (String(rgb[4]).endsWith('%')) alpha /= 100;
      return {
        r: Number(rgb[1]),
        g: Number(rgb[2]),
        b: Number(rgb[3]),
        a: Number.isFinite(alpha) ? alpha : 1,
      };
    }
    return parseHex(input);
  }

  /** WCAG relative luminance from 0-255 channels. */
  function luminanceRgb({ r, g, b }) {
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  /** HSV saturation, 0 (grey) to 1 (fully saturated). */
  function saturationRgb({ r, g, b }) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  }

  /**
   * Is this an opaque, near-neutral, light background?
   *
   * This is the test that decides whether a panel gets recolored for dark
   * mode. It deliberately only matches whites and light greys: a saturated
   * light colour is almost always a status chip or a brand accent carrying
   * meaning, and repainting those loses information.
   */
  function isConvertibleSurface(cssColor, {
    minAlpha = 0.35, minLuminance = 0.5, maxSaturation = 0.22,
  } = {}) {
    const rgb = parseCssColor(cssColor);
    if (!rgb) return false;
    if (rgb.a < minAlpha) return false;
    return luminanceRgb(rgb) >= minLuminance && saturationRgb(rgb) <= maxSaturation;
  }

  /** Would this text colour be too dark to read on a dark surface? */
  function isDarkInk(cssColor, { maxLuminance = 0.4, minAlpha = 0.35 } = {}) {
    const rgb = parseCssColor(cssColor);
    if (!rgb || rgb.a < minAlpha) return false;
    return luminanceRgb(rgb) < maxLuminance;
  }

  function hslToHex(h, s, l) {
    const sat = s / 100;
    const lig = l / 100;
    const k = (n) => (n + h / 30) % 12;
    const a = sat * Math.min(lig, 1 - lig);
    const f = (n) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return toHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 });
  }

  // -------------------------------------------------------------- dates ----

  const DAY_MS = 86400000;

  function startOfDay(date) {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  /** "Today", "Tomorrow", "Yesterday", or a short weekday/date label. */
  function relativeDayLabel(date, now = new Date()) {
    const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    if (days > 1 && days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatTime(date) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function formatDueDate(value, now = new Date()) {
    if (!value) return 'No due date';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'No due date';
    return `${relativeDayLabel(date, now)} at ${formatTime(date)}`;
  }

  CanvasMax.util = {
    qs,
    qsa,
    el,
    ready,
    waitFor,
    observe,
    debounce,
    escapeHtml,
    stripHtml,
    parseHex,
    toHex,
    clamp,
    luminance,
    luminanceRgb,
    saturationRgb,
    parseCssColor,
    isConvertibleSurface,
    isDarkInk,
    contrastRatio,
    readableTextOn,
    INK_DARK,
    INK_LIGHT,
    mix,
    lighten,
    darken,
    colorFromString,
    hslToHex,
    startOfDay,
    relativeDayLabel,
    formatTime,
    formatDueDate,
    DAY_MS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
