/**
 * CanvasMax — settings store.
 *
 * Layout:
 *   chrome.storage.sync   settings + user themes  (roams across the user's
 *                         Chrome profiles for free; this is the "sync across
 *                         devices" that competing extensions charge for)
 *   chrome.storage.local  notes, API response cache, per-device state
 *
 * Reads always deep-merge over DEFAULTS, so a settings blob written by an older
 * version is forward-compatible and a partial write never drops siblings.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});

  const SCHEMA_VERSION = 2;

  const DEFAULTS = Object.freeze({
    version: SCHEMA_VERSION,
    enabled: true,

    theme: {
      // system | light | dark | schedule
      mode: 'system',
      darkTheme: 'midnight',
      lightTheme: 'canvas-light',
      schedule: { start: '19:00', end: '07:00' },
      dimImages: false,
      font: { family: '', scale: 100 },

      /** Per-role typography. See src/lib/fonts.js for what each role styles. */
      fonts: { ui: '', headings: '', body: '', mono: '' },

      /** Google Fonts families the user has imported, e.g. ["Inter"]. */
      googleFonts: [],

      /** Page background image. The image itself lives in storage.local. */
      background: {
        enabled: false,
        // 'upload' reads from storage.local; 'url' uses a remote address.
        source: 'upload',
        url: '',
        // cover | contain | tile | center
        fit: 'cover',
        // Percentage of a scrim drawn over the image so text stays readable.
        dim: 45,
        blur: 0,
      },

      /**
       * Recolour light panels detected at runtime. On by default because it is
       * what makes dark mode survive Canvas releases we have never seen.
       */
      autoFixSurfaces: true,

      customThemes: {},
      customCss: '',
    },

    dashboard: {
      enabled: true,
      // default | condensed | compact
      cardStyle: 'default',
      gradients: true,
      showGrades: true,
      // percent | letter | both
      gradeDisplay: 'both',
      showCardImages: true,
      hiddenCourses: [],
      cardOrder: [],
      colorOverrides: {},
      imageOverrides: {},
      nicknames: {},
      cardLinks: ['assignments', 'grades', 'announcements', 'discussions', 'modules'],
      notes: true,
    },

    todo: {
      enabled: true,
      daysAhead: 14,
      includeCompleted: false,
      // date | course
      groupBy: 'date',
      showOverdue: true,
      maxItems: 60,
    },

    gpa: {
      enabled: true,
      // 4.0 | 4.3 | hs-weighted
      scale: '4.0',
      credits: {},
      courseWeights: {},
      includeInProgress: true,
    },

    whatIf: { enabled: true },
    preview: { enabled: true },

    tweaks: {
      hideLogo: false,
      hideBreadcrumbs: false,
      hideRightSidebar: false,
      fullWidth: false,
      hideDashboardGreeting: false,
      autoExpandModules: false,
      hiddenNavItems: [],
    },

    reminders: {
      enabled: false,
      leadMinutes: [1440, 120],
    },

    // Extra Canvas installs the user has granted access to, e.g.
    // "canvas.mycollege.edu". *.instructure.com is always covered.
    domains: [],

    debug: false,
  });

  // ------------------------------------------------------------- merging ----

  const isPlainObject = (value) =>
    value != null && typeof value === 'object' && !Array.isArray(value);

  /** Deep-merge `source` over a structural clone of `base`. */
  function deepMerge(base, source) {
    if (!isPlainObject(source)) return structuredCloneSafe(base);
    const out = structuredCloneSafe(base);
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      out[key] = isPlainObject(value) && isPlainObject(out[key])
        ? deepMerge(out[key], value)
        : structuredCloneSafe(value);
    }
    return out;
  }

  function structuredCloneSafe(value) {
    if (Array.isArray(value)) return value.map(structuredCloneSafe);
    if (isPlainObject(value)) {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = structuredCloneSafe(v);
      return out;
    }
    return value;
  }

  // ------------------------------------------------------------ backends ----

  /** In-memory stand-in so the pure logic stays testable outside Chrome. */
  function memoryArea() {
    const data = new Map();
    return {
      get: async (keys) => {
        const wanted = keys == null ? [...data.keys()] : [].concat(keys);
        const out = {};
        for (const key of wanted) if (data.has(key)) out[key] = data.get(key);
        return out;
      },
      set: async (items) => {
        for (const [k, v] of Object.entries(items)) data.set(k, v);
      },
      remove: async (keys) => {
        for (const key of [].concat(keys)) data.delete(key);
      },
    };
  }

  const hasChrome = typeof chrome !== 'undefined' && chrome.storage;
  const memorySync = hasChrome ? null : memoryArea();
  const memoryLocal = hasChrome ? null : memoryArea();

  const area = (name) => {
    if (hasChrome) return chrome.storage[name];
    return name === 'sync' ? memorySync : memoryLocal;
  };

  const KEY = 'settings';

  // ---------------------------------------------------------- migrations ----

  /**
   * Bring a stored blob up to SCHEMA_VERSION. Each step is a pure function so
   * upgrades stay reviewable; add a new entry rather than editing an old one.
   */
  const MIGRATIONS = {
    // 0 -> 1: initial release. Nothing to move yet; the deep-merge against
    // DEFAULTS already fills in anything the blob is missing.
    1: (blob) => blob,

    // 1 -> 2: a single font family became four typographic roles. Whatever the
    // user had set applied to the whole interface, so that is where it lands.
    2: (blob) => {
      const family = blob?.theme?.font?.family;
      if (!family) return blob;
      const theme = { ...blob.theme };
      theme.fonts = { ui: family, headings: '', body: '', mono: '', ...(theme.fonts || {}) };
      if (!theme.fonts.ui) theme.fonts.ui = family;
      return { ...blob, theme };
    },
  };

  function migrate(blob) {
    let out = blob || {};
    let from = Number(out.version) || 0;
    while (from < SCHEMA_VERSION) {
      from += 1;
      const step = MIGRATIONS[from];
      if (step) out = step(out);
      out.version = from;
    }
    return out;
  }

  // --------------------------------------------------------------- API -----

  let cache = null;

  async function getSettings({ fresh = false } = {}) {
    if (cache && !fresh) return cache;
    let stored = {};
    try {
      const result = await area('sync').get(KEY);
      stored = result?.[KEY] ?? {};
    } catch (err) {
      console.warn('[CanvasMax] falling back to local settings', err);
      try {
        const result = await area('local').get(KEY);
        stored = result?.[KEY] ?? {};
      } catch { /* first run */ }
    }
    cache = deepMerge(DEFAULTS, migrate(stored));
    return cache;
  }

  /**
   * Merge `patch` into the stored settings. `patch` is a partial tree, so
   * `saveSettings({ theme: { mode: 'dark' } })` leaves the rest of `theme`
   * alone.
   */
  async function saveSettings(patch) {
    const current = await getSettings();
    const next = deepMerge(current, patch);
    next.version = SCHEMA_VERSION;
    cache = next;
    try {
      await area('sync').set({ [KEY]: next });
    } catch (err) {
      // Most often QUOTA_BYTES_PER_ITEM from a large custom theme set.
      console.warn('[CanvasMax] sync write failed, using local storage', err);
      await area('local').set({ [KEY]: next });
    }
    return next;
  }

  /** Replace the whole settings tree (used by Import and Reset). */
  async function replaceSettings(blob) {
    const next = deepMerge(DEFAULTS, migrate(blob || {}));
    next.version = SCHEMA_VERSION;
    cache = next;
    try {
      await area('sync').set({ [KEY]: next });
    } catch {
      await area('local').set({ [KEY]: next });
    }
    return next;
  }

  async function resetSettings() {
    return replaceSettings({});
  }

  /** Subscribe to settings changes from any extension context. */
  function onChange(callback) {
    if (!hasChrome || !chrome.storage.onChanged) return () => {};
    const listener = (changes, areaName) => {
      if (!(areaName === 'sync' || areaName === 'local')) return;
      if (!changes[KEY]) return;
      cache = deepMerge(DEFAULTS, migrate(changes[KEY].newValue ?? {}));
      callback(cache);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  // ------------------------------------------------------ local-only kv ----

  /** storage.local key holding the uploaded background image data URI. */
  const BACKGROUND_KEY = 'backgroundImage';

  async function getLocal(key, fallback = null) {
    try {
      const result = await area('local').get(key);
      return result?.[key] ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function setLocal(key, value) {
    try {
      await area('local').set({ [key]: value });
    } catch (err) {
      console.warn('[CanvasMax] local write failed', err);
    }
  }

  async function removeLocal(key) {
    try {
      await area('local').remove(key);
    } catch { /* ignore */ }
  }

  CanvasMax.storage = {
    SCHEMA_VERSION,
    DEFAULTS,
    deepMerge,
    migrate,
    getSettings,
    saveSettings,
    replaceSettings,
    resetSettings,
    onChange,
    getLocal,
    setLocal,
    removeLocal,
    BACKGROUND_KEY,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
