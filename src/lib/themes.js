/**
 * CanvasMax — theme engine.
 *
 * A theme is just a small palette. `compileTheme` expands that palette into
 * the CSS custom properties that `src/content/theme.css` is written against,
 * deriving hover/active/elevated variants rather than making the user pick
 * twenty colors by hand.
 *
 * Themes are plain JSON: they can be exported, shared in a text file, and
 * imported by anyone, with no account and no server in between.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});
  const { mix, readableTextOn, luminance } = CanvasMax.util;

  /**
   * @typedef {object} Theme
   * @property {string} id
   * @property {string} name
   * @property {boolean} dark
   * @property {object} colors  bg, surface, border, text, textMuted, accent, navBg, navText, link
   * @property {number} [radius]
   */

  const BUILTIN_THEMES = Object.freeze({
    // ------------------------------------------------------------- dark ---
    midnight: {
      id: 'midnight', name: 'Midnight', dark: true, radius: 10,
      colors: {
        bg: '#0f1419', surface: '#171d26', border: '#2a3340',
        text: '#e5eaf0', textMuted: '#94a3b4',
        accent: '#4f8cff', navBg: '#0b0f14', navText: '#c8d2de', link: '#6ea8ff',
      },
    },
    carbon: {
      id: 'carbon', name: 'Carbon', dark: true, radius: 6,
      colors: {
        bg: '#1a1a1a', surface: '#242424', border: '#383838',
        text: '#e8e8e8', textMuted: '#a0a0a0',
        accent: '#f0883e', navBg: '#111111', navText: '#d0d0d0', link: '#f0a868',
      },
    },
    amoled: {
      id: 'amoled', name: 'True Black', dark: true, radius: 8,
      colors: {
        bg: '#000000', surface: '#0c0c0e', border: '#242428',
        text: '#f2f2f4', textMuted: '#8b8b93',
        accent: '#00d0a0', navBg: '#000000', navText: '#d8d8dd', link: '#3ce0b8',
      },
    },
    grape: {
      id: 'grape', name: 'Grape', dark: true, radius: 12,
      colors: {
        bg: '#1e1a2b', surface: '#282240', border: '#3d3459',
        text: '#eae4ff', textMuted: '#a99fc6',
        accent: '#bd93f9', navBg: '#171327', navText: '#d6cdf0', link: '#c9a6ff',
      },
    },
    frost: {
      id: 'frost', name: 'Frost', dark: true, radius: 8,
      colors: {
        bg: '#2e3440', surface: '#3b4252', border: '#4c566a',
        text: '#eceff4', textMuted: '#a9b3c4',
        accent: '#88c0d0', navBg: '#272c36', navText: '#d8dee9', link: '#8fbcbb',
      },
    },
    tide: {
      id: 'tide', name: 'Deep Tide', dark: true, radius: 10,
      colors: {
        bg: '#0b1f2a', surface: '#12303f', border: '#1e4557',
        text: '#e0f2f9', textMuted: '#8fb3c2',
        accent: '#2bb3c0', navBg: '#07161e', navText: '#cbe6f0', link: '#4fd0dc',
      },
    },
    moss: {
      id: 'moss', name: 'Moss', dark: true, radius: 8,
      colors: {
        bg: '#141a14', surface: '#1e271e', border: '#31402f',
        text: '#e6ede4', textMuted: '#9bab96',
        accent: '#7cb342', navBg: '#0f140f', navText: '#d3ddcf', link: '#9ccc65',
      },
    },
    ember: {
      id: 'ember', name: 'Ember', dark: true, radius: 10,
      colors: {
        bg: '#1c1416', surface: '#291d20', border: '#402c31',
        text: '#f5e8e9', textMuted: '#b79ba0',
        accent: '#ff6b6b', navBg: '#150f11', navText: '#e6d2d4', link: '#ff8a8a',
      },
    },

    // ------------------------------------------------------------ light ---
    'canvas-light': {
      id: 'canvas-light', name: 'Canvas Light', dark: false, radius: 6,
      colors: {
        bg: '#f5f5f5', surface: '#ffffff', border: '#c7cdd1',
        text: '#2d3b45', textMuted: '#6b7780',
        accent: '#0374b5', navBg: '#394b58', navText: '#ffffff', link: '#0374b5',
      },
    },
    paper: {
      id: 'paper', name: 'Paper', dark: false, radius: 10,
      colors: {
        bg: '#faf8f5', surface: '#ffffff', border: '#e2ddd4',
        text: '#33302b', textMuted: '#7a736a',
        accent: '#a4632c', navBg: '#33302b', navText: '#f5f0e8', link: '#a4632c',
      },
    },
    sky: {
      id: 'sky', name: 'Clear Sky', dark: false, radius: 12,
      colors: {
        bg: '#eef4fb', surface: '#ffffff', border: '#cfdcec',
        text: '#1c2c3e', textMuted: '#5f7288',
        accent: '#1f7ae0', navBg: '#1b3a5c', navText: '#e8f1fb', link: '#1f7ae0',
      },
    },
    sepia: {
      id: 'sepia', name: 'Sepia', dark: false, radius: 8,
      colors: {
        bg: '#f2e9d8', surface: '#faf3e6', border: '#ddceb0',
        text: '#3b3226', textMuted: '#7d7059',
        accent: '#8a6d3b', navBg: '#4a3f2e', navText: '#f2e9d8', link: '#8a6d3b',
      },
    },
  });

  const DARK_THEME_IDS = Object.values(BUILTIN_THEMES).filter((t) => t.dark).map((t) => t.id);
  const LIGHT_THEME_IDS = Object.values(BUILTIN_THEMES).filter((t) => !t.dark).map((t) => t.id);

  /** Every color a complete theme must define. */
  const REQUIRED_COLORS = Object.freeze([
    'bg', 'surface', 'border', 'text', 'textMuted', 'accent', 'navBg', 'navText', 'link',
  ]);

  /**
   * Look a theme up by id across built-ins and the user's own themes.
   */
  function resolveTheme(id, customThemes = {}) {
    if (customThemes && customThemes[id]) return normalizeTheme(customThemes[id]);
    if (BUILTIN_THEMES[id]) return normalizeTheme(BUILTIN_THEMES[id]);
    return normalizeTheme(BUILTIN_THEMES.midnight);
  }

  /** Fill in anything a hand-written or imported theme is missing. */
  function normalizeTheme(theme) {
    const base = theme?.dark === false ? BUILTIN_THEMES['canvas-light'] : BUILTIN_THEMES.midnight;
    const colors = { ...base.colors, ...(theme?.colors || {}) };
    for (const key of REQUIRED_COLORS) {
      if (!colors[key]) colors[key] = base.colors[key];
    }
    return {
      id: theme?.id || 'custom',
      name: theme?.name || 'Custom theme',
      author: theme?.author || '',
      dark: theme?.dark !== false,
      radius: Number.isFinite(Number(theme?.radius)) ? Number(theme.radius) : base.radius,
      colors,
    };
  }

  /**
   * Expand a theme into CSS custom properties.
   * Derived values (hover, elevated surfaces, shadows, translucent overlays)
   * are computed here so `theme.css` only ever references stable names.
   */
  function themeVariables(theme) {
    const t = normalizeTheme(theme);
    const c = t.colors;
    const dark = t.dark;

    // In a dark theme "raising" a surface means lightening it; in a light
    // theme it means going whiter and leaning on the shadow instead.
    const raise = (color, amount) => (dark ? mix(color, '#ffffff', amount) : mix(color, '#ffffff', amount));
    const sink = (color, amount) => (dark ? mix(color, '#000000', amount) : mix(color, '#000000', amount));

    return {
      '--cmx-bg': c.bg,
      '--cmx-bg-sunken': dark ? sink(c.bg, 0.35) : sink(c.bg, 0.03),
      '--cmx-surface': c.surface,
      '--cmx-surface-raised': raise(c.surface, dark ? 0.06 : 0.0),
      '--cmx-surface-hover': dark ? raise(c.surface, 0.1) : sink(c.surface, 0.04),
      '--cmx-surface-active': dark ? raise(c.surface, 0.16) : sink(c.surface, 0.08),
      '--cmx-border': c.border,
      '--cmx-border-strong': dark ? raise(c.border, 0.15) : sink(c.border, 0.15),

      '--cmx-text': c.text,
      '--cmx-text-muted': c.textMuted,
      '--cmx-text-faint': mix(c.textMuted, c.bg, 0.4),
      '--cmx-text-inverse': readableTextOn(c.text),

      '--cmx-accent': c.accent,
      '--cmx-accent-hover': dark ? raise(c.accent, 0.15) : sink(c.accent, 0.12),
      '--cmx-accent-soft': mix(c.accent, c.surface, dark ? 0.82 : 0.88),
      '--cmx-accent-text': readableTextOn(c.accent),

      '--cmx-link': c.link,
      '--cmx-link-hover': dark ? raise(c.link, 0.18) : sink(c.link, 0.15),

      '--cmx-nav-bg': c.navBg,
      '--cmx-nav-text': c.navText,
      '--cmx-nav-hover': dark ? raise(c.navBg, 0.1) : raise(c.navBg, 0.12),
      '--cmx-nav-active': c.accent,

      '--cmx-success': dark ? '#4ade80' : '#0b874b',
      '--cmx-warning': dark ? '#fbbf24' : '#b45309',
      '--cmx-danger': dark ? '#f87171' : '#c0392b',

      '--cmx-radius': `${t.radius}px`,
      '--cmx-radius-sm': `${Math.max(2, Math.round(t.radius * 0.5))}px`,
      '--cmx-shadow': dark
        ? '0 2px 8px rgba(0,0,0,.55)'
        : '0 1px 3px rgba(16,24,40,.12), 0 1px 2px rgba(16,24,40,.06)',
      '--cmx-shadow-lg': dark
        ? '0 12px 32px rgba(0,0,0,.65)'
        : '0 12px 32px rgba(16,24,40,.16)',
      '--cmx-overlay': dark ? 'rgba(0,0,0,.6)' : 'rgba(16,24,40,.4)',
      '--cmx-scheme': dark ? 'dark' : 'light',
    };
  }

  /** Render the variables as a CSS rule targeting :root. */
  function compileTheme(theme, { selector = ':root' } = {}) {
    const vars = themeVariables(theme);
    const body = Object.entries(vars)
      .map(([key, value]) => `  ${key}: ${value};`)
      .join('\n');
    return `${selector} {\n${body}\n}`;
  }

  /**
   * Extra CSS driven by user preferences that aren't part of the palette.
   */
  function compilePreferences(settings) {
    const parts = [];
    const font = settings?.theme?.font || {};

    if (font.family) {
      // The family string comes from the user; quote it so a stray token can't
      // terminate the declaration.
      const safe = String(font.family).replace(/[^\w\s,'"-]/g, '');
      parts.push(`html body, html .ic-app { font-family: ${safe}, "Lato", "Helvetica Neue", sans-serif !important; }`);
    }
    if (Number(font.scale) && Number(font.scale) !== 100) {
      const scale = Math.min(150, Math.max(75, Number(font.scale)));
      parts.push(`html { font-size: ${scale}% !important; }`);
    }
    if (settings?.theme?.dimImages) {
      parts.push('html.cmx-dark #content img:not(.cmx-keep), html.cmx-dark .ic-DashboardCard__header_image { filter: brightness(.82) contrast(1.02); }');
    }
    if (settings?.tweaks?.fullWidth) {
      parts.push('.ic-Layout-wrapper, #main { max-width: none !important; }');
    }
    return parts.join('\n');
  }

  /**
   * Validate an imported theme before it is saved.
   * @returns {{ok:boolean, errors:string[], theme?:Theme}}
   */
  function validateTheme(input) {
    const errors = [];
    if (!input || typeof input !== 'object') {
      return { ok: false, errors: ['Theme must be a JSON object.'] };
    }
    if (!input.name || typeof input.name !== 'string') errors.push('Theme needs a "name".');
    if (!input.colors || typeof input.colors !== 'object') {
      errors.push('Theme needs a "colors" object.');
    } else {
      for (const key of REQUIRED_COLORS) {
        const value = input.colors[key];
        if (value && !/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(value).trim())) {
          errors.push(`colors.${key} is not a hex color.`);
        }
      }
    }
    if (errors.length) return { ok: false, errors };

    const theme = normalizeTheme(input);
    return { ok: true, errors: [], theme };
  }

  /**
   * Flag palettes that would be hard to read, so the theme editor can warn
   * instead of letting someone ship themselves grey-on-grey.
   */
  function auditContrast(theme) {
    const t = normalizeTheme(theme);
    const { contrastRatio } = CanvasMax.util;
    const checks = [
      ['Body text on background', t.colors.text, t.colors.bg, 4.5],
      ['Body text on surface', t.colors.text, t.colors.surface, 4.5],
      ['Muted text on surface', t.colors.textMuted, t.colors.surface, 3],
      ['Links on surface', t.colors.link, t.colors.surface, 3],
      ['Nav text on nav', t.colors.navText, t.colors.navBg, 4.5],
    ];
    return checks.map(([label, fg, bg, min]) => {
      const ratio = contrastRatio(fg, bg);
      return { label, ratio: Math.round(ratio * 100) / 100, min, pass: ratio >= min };
    });
  }

  /** Derive a stable id from a theme name, avoiding collisions. */
  function slugify(name, taken = {}) {
    const base = String(name || 'theme')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'theme';
    let id = base;
    let n = 2;
    while (taken[id] || BUILTIN_THEMES[id]) {
      id = `${base}-${n}`;
      n += 1;
    }
    return id;
  }

  /**
   * Decide whether dark mode should be on right now.
   * @param {object} settings
   * @param {Date} now
   * @param {boolean} systemPrefersDark
   */
  function shouldUseDark(settings, now = new Date(), systemPrefersDark = false) {
    const mode = settings?.theme?.mode || 'system';
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    if (mode === 'system') return Boolean(systemPrefersDark);
    if (mode === 'schedule') {
      const { start = '19:00', end = '07:00' } = settings?.theme?.schedule || {};
      return isWithinSchedule(now, start, end);
    }
    return false;
  }

  /** Minutes-since-midnight comparison that handles windows crossing midnight. */
  function isWithinSchedule(now, start, end) {
    const toMinutes = (hhmm) => {
      const [h, m] = String(hhmm).split(':').map(Number);
      if (!Number.isFinite(h)) return null;
      return h * 60 + (Number.isFinite(m) ? m : 0);
    };
    const startMin = toMinutes(start);
    const endMin = toMinutes(end);
    if (startMin == null || endMin == null) return false;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (startMin === endMin) return false;
    return startMin < endMin
      ? nowMin >= startMin && nowMin < endMin
      : nowMin >= startMin || nowMin < endMin; // wraps past midnight
  }

  CanvasMax.themes = {
    BUILTIN_THEMES,
    DARK_THEME_IDS,
    LIGHT_THEME_IDS,
    REQUIRED_COLORS,
    resolveTheme,
    normalizeTheme,
    themeVariables,
    compileTheme,
    compilePreferences,
    validateTheme,
    auditContrast,
    slugify,
    shouldUseDark,
    isWithinSchedule,
    luminance,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
