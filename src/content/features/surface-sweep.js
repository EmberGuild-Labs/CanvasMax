/**
 * Feature: light-surface sweep.
 *
 * The original dark mode was fail-unsafe. It forced the dark palette's *text*
 * colours with `!important` across the whole page, but only recoloured the
 * backgrounds it had selectors for. Canvas's newer screens are built from
 * InstUI components whose class names are generated per build, so there is no
 * stable selector to write — those panels stayed white while the text on them
 * went light, and the result was invisible headings.
 *
 * Guessing more selectors does not fix that; the next Canvas release breaks it
 * again. Instead this reads the *computed* background of each element and
 * recolours the ones that are actually light. It is the same trick a browser's
 * own reader mode uses, and it works on markup nobody has seen yet.
 *
 * Two deliberate limits keep it from doing damage:
 *
 *   - Only near-neutral light backgrounds are converted. A saturated light
 *     colour is nearly always a status chip or a brand accent that carries
 *     meaning, and repainting those loses information.
 *   - After a panel is darkened, a second pass re-reads the text inside it and
 *     lightens only the glyphs that would now be unreadable, rather than
 *     blanket-forcing every descendant.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});
  const features = (CanvasMax.features = CanvasMax.features || []);
  const { qsa, debounce, isConvertibleSurface, isDarkInk } = CanvasMax.util;

  const SURFACE_CLASS = 'cmx-surface-fix';
  const INK_CLASS = 'cmx-ink-fix';

  /** Where to look. Sweeping the whole document is wasteful and risky. */
  const SCOPES = [
    '#content',
    '#not_right_side',
    '#right-side-wrapper',
    '.ic-Layout-contentMain',
    '.ic-app-main-content',
    '[role="main"]',
  ];

  /** Elements whose background is theirs to keep. */
  const SKIP_TAGS = new Set([
    'IMG', 'SVG', 'PATH', 'G', 'CANVAS', 'VIDEO', 'IFRAME', 'OBJECT', 'EMBED',
    'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SCRIPT', 'STYLE', 'LINK', 'BR', 'HR',
  ]);

  /**
   * Cap on elements examined per pass. getComputedStyle forces style
   * resolution, so an unbounded walk on a big Canvas page is a jank source.
   */
  const MAX_NODES = 2500;

  let observer = null;
  let enabled = false;

  const isDark = () => document.documentElement.classList.contains('cmx-dark');

  function scopeRoots() {
    const roots = [];
    for (const selector of SCOPES) {
      for (const node of qsa(selector)) {
        // Skip anything already covered by an ancestor we are going to walk.
        if (!roots.some((existing) => existing.contains(node))) roots.push(node);
      }
    }
    return roots;
  }

  /** Phase one: find opaque, near-neutral, light panels and darken them. */
  function sweepSurfaces() {
    const converted = [];
    let budget = MAX_NODES;

    for (const scope of scopeRoots()) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
      let node = scope;

      do {
        if (budget-- <= 0) return converted;
        if (SKIP_TAGS.has(node.tagName)) continue;
        // Never touch CanvasMax's own UI; it is already themed.
        if (node.classList.contains('cmx-root') || node.closest('.cmx-root')) continue;
        if (node.classList.contains(SURFACE_CLASS)) continue;

        const style = getComputedStyle(node);
        if (!isConvertibleSurface(style.backgroundColor)) continue;

        // A panel carrying an image or gradient is decorative — a course
        // banner, a hero. Leave the artwork alone and fix the text on it.
        if (style.backgroundImage && style.backgroundImage !== 'none') {
          node.classList.add(INK_CLASS);
          continue;
        }

        node.classList.add(SURFACE_CLASS);
        converted.push(node);
      } while ((node = walker.nextNode()));
    }

    return converted;
  }

  /** Does this element paint its own background rather than showing its parent's? */
  function paintsOwnBackground(backgroundColor) {
    const rgb = CanvasMax.util.parseCssColor(backgroundColor);
    return Boolean(rgb) && rgb.a >= 0.35;
  }

  /**
   * Phase two: inside the panels we just darkened, lighten only the text that
   * would now be unreadable. Runs on the next frame so the new background has
   * actually been applied before anything is measured.
   *
   * Any descendant that paints its own background is skipped along with its
   * whole subtree. Its text sits on *that* background, not on the panel we
   * changed — lightening it is how a green "Submitted" chip ended up with pale
   * text on pale green.
   */
  function sweepInk(converted) {
    if (!converted.length) return;
    let budget = MAX_NODES;

    for (const panel of converted) {
      const consider = (node) => {
        if (budget-- <= 0) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;

        const style = getComputedStyle(node);
        if (node !== panel && paintsOwnBackground(style.backgroundColor)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!node.classList.contains(INK_CLASS)
          && hasOwnText(node)
          && isDarkInk(style.color)) {
          node.classList.add(INK_CLASS);
        }
        return NodeFilter.FILTER_ACCEPT;
      };

      // The filter is never called for the root, so handle the panel itself.
      consider(panel);

      const walker = document.createTreeWalker(
        panel,
        NodeFilter.SHOW_ELEMENT,
        { acceptNode: consider }
      );
      while (walker.nextNode()) { /* the filter does the work */ }
    }
  }

  /** True when the element has a direct, non-empty text child. */
  function hasOwnText(element) {
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.nodeValue.trim()) return true;
    }
    return false;
  }

  function run() {
    if (!enabled || !isDark()) return;
    const converted = sweepSurfaces();
    requestAnimationFrame(() => sweepInk(converted));
  }

  const scheduled = debounce(() => {
    // Idle time where available; Canvas's own rendering matters more than ours.
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1200 });
    else run();
  }, 250);

  function clear() {
    for (const node of qsa(`.${SURFACE_CLASS}, .${INK_CLASS}`)) {
      node.classList.remove(SURFACE_CLASS, INK_CLASS);
    }
  }

  function start() {
    if (observer) return;
    observer = new MutationObserver(scheduled);
    observer.observe(document.body, { childList: true, subtree: true });
    scheduled();
  }

  function stop() {
    observer?.disconnect();
    observer = null;
    clear();
  }

  features.push({
    id: 'surface-sweep',
    matches: () => true,

    init(ctx) {
      enabled = ctx.settings.enabled && ctx.settings.theme.autoFixSurfaces !== false;
      if (!enabled) return;

      if (isDark()) start();
      // theme.js announces every change of palette, including light <-> dark.
      document.addEventListener('cmx:theme', (event) => {
        if (!enabled) return;
        if (event.detail?.dark) start();
        else stop();
      });
    },

    update(ctx) {
      enabled = ctx.settings.enabled && ctx.settings.theme.autoFixSurfaces !== false;
      if (!enabled) { stop(); return; }
      if (isDark()) { clear(); start(); scheduled(); }
      else stop();
    },
  });

  CanvasMax.surfaceSweep = {
    sweepSurfaces, sweepInk, hasOwnText, paintsOwnBackground, SURFACE_CLASS, INK_CLASS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
