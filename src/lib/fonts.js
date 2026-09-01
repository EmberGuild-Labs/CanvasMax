/**
 * CanvasMax — typography.
 *
 * Canvas is one font everywhere. This splits it into four roles so a user can
 * set a display face for headings without inflicting it on a wall of reading,
 * and can give code a real monospace.
 *
 * Google Fonts are handled by fetching the family in the service worker,
 * inlining the woff2 files as data URIs, and injecting the resulting
 * @font-face rules. The page therefore makes no request to Google at all —
 * which keeps the extension's "nothing leaves your browser" promise intact and
 * sidesteps the page's own content security policy.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});

  /**
   * The four roles, and what each one actually restyles.
   *
   * `body` deliberately targets Canvas's user-content containers only: that is
   * assignment text, pages and discussion posts, the places where a reading
   * face earns its keep.
   */
  const FONT_ROLES = Object.freeze({
    ui: {
      label: 'Interface',
      hint: 'Navigation, buttons, menus and everything CanvasMax adds.',
      selectors: [
        'html body',
        'html .ic-app',
        'html button',
        'html input',
        'html select',
        'html textarea',
        'html .cmx-root',
      ],
    },
    headings: {
      label: 'Headings',
      hint: 'Page titles, section headers and dashboard card names.',
      selectors: [
        'html h1', 'html h2', 'html h3', 'html h4', 'html h5', 'html h6',
        'html .ic-DashboardCard__header-title',
        'html .cmx-panel__title',
      ],
    },
    body: {
      label: 'Course content',
      hint: 'Assignment descriptions, pages and discussion posts.',
      selectors: [
        'html .user_content',
        'html .show-content',
        'html .description',
        'html .discussion_entry .message',
        'html .cmx-modal__body',
      ],
    },
    mono: {
      label: 'Code',
      hint: 'Code blocks and preformatted text.',
      selectors: ['html code', 'html pre', 'html kbd', 'html samp'],
    },
  });

  /** Fallback stacks appended after the user's choice, per role. */
  const FALLBACKS = Object.freeze({
    ui: '"Lato", "Helvetica Neue", Helvetica, Arial, sans-serif',
    headings: '"Lato", "Helvetica Neue", Helvetica, Arial, sans-serif',
    body: 'Georgia, "Times New Roman", serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  });

  /**
   * Sanitise a font family name for use in a CSS declaration.
   *
   * The name reaches us from a text field, so it is untrusted: anything that
   * could close the declaration or the rule has to go, or a family name like
   * `x; } body { display:none` would rewrite the page.
   *
   * @returns {string} a quoted family name, or '' if nothing usable is left
   */
  function sanitizeFamily(name) {
    const cleaned = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 64);
    if (!cleaned) return '';
    // Reject anything containing a character a font family cannot have, rather
    // than stripping those characters and accepting the remainder. Stripping
    // turned `url(evil)` into the plausible-looking family `urlevil`, which is
    // harmless but silently not what anyone asked for; refusing is honest and
    // leaves no path where a mangled string reaches the stylesheet.
    if (!/^[\w \-]+$/.test(cleaned)) return '';
    return `"${cleaned}"`;
  }

  /** Build the full stack for one role. */
  function familyStack(name, role) {
    const family = sanitizeFamily(name);
    const fallback = FALLBACKS[role] || FALLBACKS.ui;
    return family ? `${family}, ${fallback}` : '';
  }

  /**
   * Compile the per-role font settings into CSS.
   * @param {object} fonts  { ui, headings, body, mono }
   * @param {number} scale  percentage of the normal text size
   */
  function compileFontCss(fonts = {}, scale = 100) {
    const parts = [];

    for (const [role, def] of Object.entries(FONT_ROLES)) {
      const stack = familyStack(fonts[role], role);
      if (!stack) continue;
      parts.push(`${def.selectors.join(',\n')} {\n  font-family: ${stack} !important;\n}`);
    }

    const size = Number(scale);
    if (Number.isFinite(size) && size !== 100) {
      const clamped = Math.min(150, Math.max(75, size));
      parts.push(`html { font-size: ${clamped}% !important; }`);
    }

    return parts.join('\n\n');
  }

  /**
   * The Google Fonts CSS endpoint for a set of families.
   * Weights 400 and 700 cover normal and bold, which is all Canvas asks for.
   */
  function googleFontsUrl(families, { weights = [400, 700] } = {}) {
    const clean = [...new Set((families || [])
      .map((name) => String(name ?? '').trim())
      .filter((name) => /^[\w \-]{1,64}$/.test(name)))];
    if (!clean.length) return null;

    const params = clean.map((family) => {
      const encoded = family.replace(/ /g, '+');
      return `family=${encodeURIComponent(encoded).replace(/%2B/g, '+')}:wght@${weights.join(';')}`;
    });
    return `https://fonts.googleapis.com/css2?${params.join('&')}&display=swap`;
  }

  /** Extract every https://fonts.gstatic.com URL from a Google Fonts stylesheet. */
  function extractFontUrls(css) {
    const urls = new Set();
    for (const match of String(css ?? '').matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)) {
      urls.add(match[1]);
    }
    return [...urls];
  }

  /** A family name is valid for Google Fonts if it is plain words. */
  const isValidFamilyName = (name) => /^[\w \-]{1,64}$/.test(String(name ?? '').trim());

  CanvasMax.fonts = {
    FONT_ROLES,
    FALLBACKS,
    sanitizeFamily,
    familyStack,
    compileFontCss,
    googleFontsUrl,
    extractFontUrls,
    isValidFamilyName,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
