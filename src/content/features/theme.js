/**
 * Feature: theming.
 *
 * Applies the active palette to the live page and keeps the localStorage
 * mirror that src/content/early.js reads on the next load. Also owns the
 * "system" and "schedule" modes, re-evaluating them as the OS preference flips
 * or the clock crosses the boundary.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});
  const features = (CanvasMax.features = CanvasMax.features || []);

  const BOOT_KEY = 'cmx:boot';
  const PREF_STYLE_ID = 'cmx-preferences';
  const CUSTOM_STYLE_ID = 'cmx-custom-css';

  let mediaQuery = null;
  let scheduleTimer = null;
  let currentCtx = null;

  /** Root classes that come from settings rather than the palette. */
  function toggleClasses(settings) {
    const { dashboard, tweaks } = settings;
    return {
      'cmx-gradient-cards': Boolean(dashboard.gradients),
      'cmx-cards-condensed': dashboard.cardStyle === 'condensed',
      'cmx-cards-compact': dashboard.cardStyle === 'compact',
      'cmx-hide-card-images': !dashboard.showCardImages,
      'cmx-hide-logo': Boolean(tweaks.hideLogo),
      'cmx-hide-breadcrumbs': Boolean(tweaks.hideBreadcrumbs),
      'cmx-hide-right-sidebar': Boolean(tweaks.hideRightSidebar),
      'cmx-hide-greeting': Boolean(tweaks.hideDashboardGreeting),
      'cmx-full-width': Boolean(tweaks.fullWidth),
    };
  }

  function systemPrefersDark() {
    if (!mediaQuery) {
      try {
        mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      } catch {
        return false;
      }
    }
    return mediaQuery.matches;
  }

  function apply(ctx) {
    const { settings } = ctx;
    const { themes, util } = CanvasMax;
    const html = document.documentElement;

    if (!settings.enabled) {
      html.classList.remove('cmx-themed', 'cmx-dark', 'cmx-light');
      for (const name of Object.keys(toggleClasses(settings))) html.classList.remove(name);
      removeStyle(PREF_STYLE_ID);
      removeStyle(CUSTOM_STYLE_ID);
      return;
    }

    const dark = themes.shouldUseDark(settings, new Date(), systemPrefersDark());
    const themeId = dark ? settings.theme.darkTheme : settings.theme.lightTheme;
    const theme = themes.resolveTheme(themeId, settings.theme.customThemes);
    const vars = themes.themeVariables(theme);

    html.classList.add('cmx-themed');
    html.classList.toggle('cmx-dark', dark);
    html.classList.toggle('cmx-light', !dark);

    for (const [name, on] of Object.entries(toggleClasses(settings))) {
      html.classList.toggle(name, on);
    }

    for (const [key, value] of Object.entries(vars)) {
      html.style.setProperty(key, value);
    }

    setStyle(PREF_STYLE_ID, themes.compilePreferences(settings));
    setStyle(CUSTOM_STYLE_ID, settings.theme.customCss || '');

    writeBootCache(settings);
    ctx.theme = theme;
    ctx.isDark = dark;

    document.dispatchEvent(new CustomEvent('cmx:theme', { detail: { theme, dark } }));
    if (settings.debug) console.info('[CanvasMax] theme applied', theme.name, { dark });
  }

  function setStyle(id, css) {
    let node = document.getElementById(id);
    if (!css) {
      if (node) node.remove();
      return;
    }
    if (!node) {
      node = document.createElement('style');
      node.id = id;
      (document.head || document.documentElement).appendChild(node);
    }
    if (node.textContent !== css) node.textContent = css;
  }

  function removeStyle(id) {
    document.getElementById(id)?.remove();
  }

  /**
   * Persist the minimum needed for a flash-free next load. Both palettes are
   * stored so early.js can resolve system/schedule modes on its own.
   */
  function writeBootCache(settings) {
    const { themes } = CanvasMax;
    try {
      const darkTheme = themes.resolveTheme(settings.theme.darkTheme, settings.theme.customThemes);
      const lightTheme = themes.resolveTheme(settings.theme.lightTheme, settings.theme.customThemes);
      const classes = Object.entries(toggleClasses(settings))
        .filter(([, on]) => on)
        .map(([name]) => name);

      const payload = {
        v: 1,
        enabled: Boolean(settings.enabled),
        mode: settings.theme.mode,
        scheduleStart: settings.theme.schedule?.start,
        scheduleEnd: settings.theme.schedule?.end,
        darkVars: themes.themeVariables(darkTheme),
        lightVars: themes.themeVariables(lightTheme),
        classes,
        extraCss: [themes.compilePreferences(settings), settings.theme.customCss || '']
          .filter(Boolean)
          .join('\n'),
      };
      window.localStorage.setItem(BOOT_KEY, JSON.stringify(payload));
    } catch {
      // Non-fatal: the page simply themes a beat later next time.
    }
  }

  /**
   * In schedule mode, wake up exactly when the next boundary is due rather
   * than polling.
   */
  function armScheduleTimer(ctx) {
    if (scheduleTimer) clearTimeout(scheduleTimer);
    if (ctx.settings.theme.mode !== 'schedule') return;

    const { start, end } = ctx.settings.theme.schedule || {};
    const now = new Date();
    const msUntil = (hhmm) => {
      const [h, m] = String(hhmm || '').split(':').map(Number);
      if (!Number.isFinite(h)) return Infinity;
      const target = new Date(now);
      target.setHours(h, Number.isFinite(m) ? m : 0, 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1);
      return target - now;
    };

    const wait = Math.min(msUntil(start), msUntil(end));
    if (!Number.isFinite(wait)) return;
    // +1s of slack so we land safely past the boundary.
    scheduleTimer = setTimeout(() => apply(ctx), wait + 1000);
  }

  features.push({
    id: 'theme',
    /** Runs on every Canvas page — theming is never page-specific. */
    matches: () => true,

    init(ctx) {
      currentCtx = ctx;
      apply(ctx);
      armScheduleTimer(ctx);

      if (mediaQuery) {
        const onSchemeChange = () => {
          if (currentCtx?.settings.theme.mode === 'system') apply(currentCtx);
        };
        if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', onSchemeChange);
        else if (mediaQuery.addListener) mediaQuery.addListener(onSchemeChange);
      }
    },

    update(ctx) {
      currentCtx = ctx;
      apply(ctx);
      armScheduleTimer(ctx);
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
