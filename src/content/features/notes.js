/**
 * Feature: dashboard notes.
 *
 * A scratchpad pinned to the dashboard. Stored in chrome.storage.local rather
 * than sync: notes can get long, and sync's 8 KB per-item cap would start
 * silently dropping writes at exactly the wrong moment.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});
  const features = (CanvasMax.features = CanvasMax.features || []);
  const { qs, el, waitFor, debounce } = CanvasMax.util;

  const PANEL_ID = 'cmx-notes-panel';
  const STORAGE_KEY = 'notes';
  const MAX_LENGTH = 20000;

  function storageKeyFor(origin) {
    // Namespaced per Canvas install so a student at two schools keeps two pads.
    return `${STORAGE_KEY}:${origin}`;
  }

  async function run(ctx, state) {
    const host = qs('#right-side') || await waitFor('#right-side', { timeout: 6000 });
    if (!host) return;

    if (state.panel?.isConnected) return;

    const key = storageKeyFor(ctx.api.origin);
    const saved = await CanvasMax.storage.getLocal(key, '');

    const status = el('div', { class: 'cmx-note__status', 'aria-live': 'polite' });

    const textarea = el('textarea', {
      class: 'cmx-note',
      placeholder: 'Notes to self — saved automatically, kept on this device.',
      maxlength: MAX_LENGTH,
      'aria-label': 'Dashboard notes',
    });
    textarea.value = saved || '';

    const save = debounce(async () => {
      await CanvasMax.storage.setLocal(key, textarea.value.slice(0, MAX_LENGTH));
      const time = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      status.textContent = `Saved ${time}`;
    }, 500);

    textarea.addEventListener('input', () => {
      status.textContent = 'Saving…';
      save();
    });

    const clearButton = el('button', {
      class: 'cmx-btn cmx-btn--ghost',
      text: 'Clear',
      on: {
        click: async () => {
          if (!textarea.value) return;
          textarea.value = '';
          await CanvasMax.storage.setLocal(key, '');
          status.textContent = 'Cleared';
          textarea.focus();
        },
      },
    });

    state.panel = el('div', { id: PANEL_ID, class: 'cmx-panel cmx-root' }, [
      el('div', { class: 'cmx-panel__header' }, [
        el('h2', { class: 'cmx-panel__title', text: 'Notes' }),
        el('div', { class: 'cmx-panel__actions' }, [clearButton]),
      ]),
      el('div', { class: 'cmx-panel__body' }, [textarea, status]),
    ]);

    // Sit below the planner panel when both are on.
    const planner = qs('#cmx-planner-panel');
    if (planner) planner.insertAdjacentElement('afterend', state.panel);
    else host.insertAdjacentElement('afterbegin', state.panel);
  }

  const state = {};

  features.push({
    id: 'notes',
    matches: (page) => page.type === 'dashboard',

    async init(ctx) {
      if (!ctx.settings.dashboard.notes) return;
      await run(ctx, state);
    },

    update(ctx) {
      if (!ctx.settings.dashboard.notes) {
        state.panel?.remove();
        state.panel = null;
        return;
      }
      run(ctx, state);
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
