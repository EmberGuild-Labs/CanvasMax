/**
 * CanvasMax — content script entry point.
 *
 * Loaded last, after lib/ and every feature module. Each feature has pushed a
 * descriptor onto CanvasMax.features; this file decides which page we are on,
 * runs the features that apply, and keeps them in step with settings changes
 * and Canvas's client-side navigation.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});
  const { api, storage, util } = CanvasMax;

  /**
   * Classify the current page from its path.
   * Kept pure and exported so it can be tested without a browser.
   */
  function detectPage(pathname = location.pathname, search = location.search) {
    const path = pathname.replace(/\/+$/, '') || '/';

    if (path === '/' || path === '/dashboard') return { type: 'dashboard' };

    const course = /^\/courses\/(\d+)(?:\/(.*))?$/.exec(path);
    if (course) {
      const courseId = course[1];
      const rest = course[2] || '';

      if (rest === '' || rest === 'wiki') return { type: 'course', courseId };
      if (rest === 'grades' || /^grades\/\d+$/.test(rest)) return { type: 'grades', courseId };
      if (rest === 'modules') return { type: 'modules', courseId };
      if (rest === 'assignments') return { type: 'assignments', courseId };

      const assignment = /^assignments\/(\d+)/.exec(rest);
      if (assignment) return { type: 'assignment', courseId, assignmentId: assignment[1] };

      const quiz = /^quizzes\/(\d+)/.exec(rest);
      if (quiz) return { type: 'quiz', courseId, quizId: quiz[1] };

      return { type: 'course-other', courseId, section: rest.split('/')[0] };
    }

    if (path === '/grades') return { type: 'all-grades' };
    if (path.startsWith('/calendar')) return { type: 'calendar' };
    if (path.startsWith('/conversations')) return { type: 'inbox' };
    if (path.startsWith('/profile') || path.startsWith('/users')) return { type: 'profile' };

    return { type: 'other', path, search };
  }

  const started = new Set();

  async function buildContext(settings) {
    return {
      settings,
      api: api.default,
      page: detectPage(),
      util,
    };
  }

  async function runFeatures(ctx) {
    for (const feature of CanvasMax.features || []) {
      let applies = true;
      try {
        applies = feature.matches ? feature.matches(ctx.page, ctx.settings) : true;
      } catch (err) {
        console.error(`[CanvasMax] ${feature.id}.matches threw`, err);
        applies = false;
      }
      if (!applies) continue;

      try {
        if (started.has(feature.id)) {
          await feature.update?.(ctx);
        } else {
          started.add(feature.id);
          await feature.init?.(ctx);
        }
      } catch (err) {
        // One broken feature must never take down the rest.
        console.error(`[CanvasMax] feature "${feature.id}" failed`, err);
      }
    }
  }

  /**
   * Canvas is mostly server-rendered, but a few areas swap the URL without a
   * reload. Poll for that rather than trying to patch the page's own history
   * object from an isolated world.
   */
  function watchNavigation(onNavigate) {
    let lastPath = location.pathname;
    const check = () => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      onNavigate();
    };
    window.addEventListener('popstate', check);
    setInterval(check, 900);
  }

  async function main() {
    // Bail out quietly on anything that is not a Canvas install. This matters
    // for the custom-domain support, where the user may have granted access to
    // a host that turns out not to run Canvas.
    if (!api.looksLikeCanvas()) return;

    let settings;
    try {
      settings = await storage.getSettings();
    } catch (err) {
      console.error('[CanvasMax] could not read settings', err);
      return;
    }

    if (!settings.enabled) {
      // Still run the theme feature so it can strip any classes left behind.
      const ctx = await buildContext(settings);
      await CanvasMax.features.find((f) => f.id === 'theme')?.init?.(ctx);
      return;
    }

    let ctx = await buildContext(settings);
    if (settings.debug) console.info('[CanvasMax] booting', ctx.page);

    await util.ready();
    await runFeatures(ctx);

    // Live updates from the options page or popup.
    storage.onChange(async (next) => {
      ctx = await buildContext(next);
      if (next.debug) console.info('[CanvasMax] settings changed');
      runFeatures(ctx);
    });

    watchNavigation(async () => {
      const fresh = await storage.getSettings();
      ctx = await buildContext(fresh);
      // A new page means features that were never started here should init.
      runFeatures(ctx);
    });

    // Tell the service worker which Canvas install this is. The manifest
    // matches *.instructure.com by wildcard, so this is the only way the
    // background page learns the concrete origin it should poll for reminders.
    try {
      chrome.runtime?.sendMessage({ type: 'cmx:hello', origin: api.default.origin });
    } catch {
      // The worker may be asleep or the context invalidated by an update.
    }

    // Let the popup ask the page to re-render without a reload.
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === 'cmx:refresh') {
          api.default.invalidate();
          storage.getSettings({ fresh: true }).then(async (fresh) => {
            ctx = await buildContext(fresh);
            await runFeatures(ctx);
            sendResponse({ ok: true });
          });
          return true; // keep the channel open for the async response
        }
        if (message?.type === 'cmx:ping') {
          sendResponse({ ok: true, page: detectPage(), origin: api.default.origin });
        }
        return undefined;
      });
    }
  }

  CanvasMax.boot = { detectPage, runFeatures };

  main().catch((err) => console.error('[CanvasMax] boot failed', err));
})(typeof globalThis !== 'undefined' ? globalThis : self);
