/**
 * Feature: background image and typography.
 *
 * The background is painted onto two fixed layers behind the page rather than
 * onto `body` itself: one for the image, one for a scrim over it. Canvas's own
 * containers are already transparent under a CanvasMax theme, so the image
 * shows through the gaps while every panel stays opaque and readable. The
 * scrim is what keeps it readable — a photograph behind body text is a
 * legibility problem, and the dim slider is the fix.
 *
 * Fonts are applied per role (see src/lib/fonts.js), with any imported Google
 * Fonts injected as @font-face rules whose woff2 files are already inlined as
 * data URIs by the service worker.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});
  const features = (CanvasMax.features = CanvasMax.features || []);

  const FONT_STYLE_ID = 'cmx-fonts';
  const GOOGLE_STYLE_ID = 'cmx-google-fonts';
  const BACKGROUND_CLASS = 'cmx-has-background';

  /** How each fit option maps onto background-size / -repeat. */
  const FIT = Object.freeze({
    cover: { size: 'cover', repeat: 'no-repeat' },
    contain: { size: 'contain', repeat: 'no-repeat' },
    tile: { size: 'auto', repeat: 'repeat' },
    center: { size: 'auto', repeat: 'no-repeat' },
  });

  function setStyle(id, css) {
    let node = document.getElementById(id);
    if (!css) {
      node?.remove();
      return;
    }
    if (!node) {
      node = document.createElement('style');
      node.id = id;
      (document.head || document.documentElement).appendChild(node);
    }
    if (node.textContent !== css) node.textContent = css;
  }

  // -------------------------------------------------------- background ----

  /**
   * Only data: and https: images are accepted. A `javascript:` or other exotic
   * scheme has no business in a CSS url(), and the value reaches us from a
   * text field the user can paste anything into.
   */
  function safeImageUrl(value) {
    const url = String(value ?? '').trim();
    if (!url) return null;
    if (url.startsWith('data:image/')) return url;
    if (/^https:\/\/[^\s"')]+$/i.test(url)) return url;
    return null;
  }

  async function resolveBackgroundImage(settings) {
    const background = settings.theme.background || {};
    if (!background.enabled) return null;

    if (background.source === 'url') return safeImageUrl(background.url);

    const stored = await CanvasMax.storage.getLocal(CanvasMax.storage.BACKGROUND_KEY, '');
    return safeImageUrl(stored);
  }

  async function applyBackground(settings) {
    const html = document.documentElement;
    const background = settings.theme.background || {};
    const image = settings.enabled ? await resolveBackgroundImage(settings) : null;

    if (!image) {
      html.classList.remove(BACKGROUND_CLASS);
      for (const prop of ['--cmx-bgimg', '--cmx-bgimg-size', '--cmx-bgimg-repeat',
        '--cmx-bgimg-dim', '--cmx-bgimg-blur']) {
        html.style.removeProperty(prop);
      }
      return;
    }

    const fit = FIT[background.fit] || FIT.cover;
    const dim = Math.min(90, Math.max(0, Number(background.dim) || 0)) / 100;
    const blur = Math.min(20, Math.max(0, Number(background.blur) || 0));

    // The scrim colour is the theme's own ground, so a dark theme dims toward
    // its black and a light theme toward its white.
    html.style.setProperty('--cmx-bgimg', `url("${image.replace(/"/g, '%22')}")`);
    html.style.setProperty('--cmx-bgimg-size', fit.size);
    html.style.setProperty('--cmx-bgimg-repeat', fit.repeat);
    html.style.setProperty('--cmx-bgimg-dim', String(dim));
    html.style.setProperty('--cmx-bgimg-blur', `${blur}px`);
    html.classList.add(BACKGROUND_CLASS);
  }

  // ------------------------------------------------------------- fonts ----

  function applyFonts(settings) {
    const css = CanvasMax.fonts.compileFontCss(
      settings.theme.fonts,
      settings.theme.font?.scale ?? 100
    );
    setStyle(FONT_STYLE_ID, settings.enabled ? css : '');
  }

  /**
   * Pull each imported family's cached @font-face block out of storage.local
   * and inject them together. The service worker put them there with the font
   * binaries already inlined, so nothing is fetched from here.
   */
  async function applyGoogleFonts(settings) {
    const families = settings.enabled ? (settings.theme.googleFonts || []) : [];
    if (!families.length) {
      setStyle(GOOGLE_STYLE_ID, '');
      return;
    }

    const blocks = await Promise.all(families.map(
      (family) => CanvasMax.storage.getLocal(`googleFont:${family}`, '')
    ));

    const css = blocks.filter(Boolean).join('\n');
    setStyle(GOOGLE_STYLE_ID, css);

    if (settings.debug) {
      const missing = families.filter((family, i) => !blocks[i]);
      if (missing.length) console.info('[CanvasMax] Google fonts not cached yet:', missing);
    }
  }

  async function apply(ctx) {
    try {
      await applyGoogleFonts(ctx.settings);
      applyFonts(ctx.settings);
      await applyBackground(ctx.settings);
    } catch (err) {
      console.warn('[CanvasMax] appearance failed', err);
    }
  }

  features.push({
    id: 'appearance',
    matches: () => true,
    init: apply,
    update: apply,
  });

  CanvasMax.appearance = { safeImageUrl, FIT };
})(typeof globalThis !== 'undefined' ? globalThis : self);
