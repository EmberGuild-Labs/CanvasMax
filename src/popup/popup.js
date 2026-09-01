/**
 * CanvasMax popup — the handful of switches worth reaching without opening
 * the full settings page, plus a glance at what is due.
 */
(function () {
  'use strict';

  const { util, storage, themes } = window.CanvasMax;
  const { el, qs, formatDueDate } = util;

  let settings = null;

  const MODES = [
    { value: 'system', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'schedule', label: 'Timed' },
  ];

  const TOGGLES = [
    { path: 'dashboard.showGrades', label: 'Grades on cards' },
    { path: 'todo.enabled', label: 'Planner panel' },
    { path: 'dashboard.notes', label: 'Dashboard notes' },
    { path: 'gpa.enabled', label: 'GPA panel' },
    { path: 'reminders.enabled', label: 'Due-date reminders' },
  ];

  const getPath = (object, path) =>
    path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), object);

  function patchFor(path, value) {
    const keys = path.split('.');
    const patch = {};
    let node = patch;
    for (let i = 0; i < keys.length - 1; i += 1) {
      node[keys[i]] = {};
      node = node[keys[i]];
    }
    node[keys[keys.length - 1]] = value;
    return patch;
  }

  async function save(path, value) {
    settings = await storage.saveSettings(patchFor(path, value));
    applyPopupTheme();
  }

  function applyPopupTheme() {
    const dark = themes.shouldUseDark(
      settings,
      new Date(),
      window.matchMedia('(prefers-color-scheme: dark)').matches
    );
    const theme = themes.resolveTheme(
      dark ? settings.theme.darkTheme : settings.theme.lightTheme,
      settings.theme.customThemes
    );
    for (const [key, value] of Object.entries(themes.themeVariables(theme))) {
      document.documentElement.style.setProperty(key, value);
    }
  }

  function renderModes() {
    const host = qs('#mode');
    host.textContent = '';
    for (const mode of MODES) {
      host.append(el('button', {
        type: 'button',
        text: mode.label,
        class: settings.theme.mode === mode.value ? 'is-active' : '',
        'aria-pressed': settings.theme.mode === mode.value ? 'true' : 'false',
        on: {
          click: async () => {
            await save('theme.mode', mode.value);
            renderModes();
          },
        },
      }));
    }
  }

  function themeOptions(select, wantDark, path) {
    const custom = Object.values(settings.theme.customThemes || {}).map(themes.normalizeTheme);
    const all = [...Object.values(themes.BUILTIN_THEMES), ...custom]
      .filter((theme) => theme.dark === wantDark);
    const current = getPath(settings, path);

    select.textContent = '';
    for (const theme of all) {
      select.append(el('option', {
        value: theme.id,
        text: theme.name,
        ...(theme.id === current ? { selected: true } : {}),
      }));
    }
    select.addEventListener('change', () => save(path, select.value));
  }

  function renderToggles() {
    const host = qs('#toggles');
    host.textContent = '';
    for (const toggle of TOGGLES) {
      const input = el('input', {
        type: 'checkbox',
        ...(getPath(settings, toggle.path) ? { checked: true } : {}),
        'aria-label': toggle.label,
      });
      input.addEventListener('change', () => save(toggle.path, input.checked));

      host.append(el('div', { class: 'row' }, [
        el('span', { class: 'row__label', text: toggle.label }),
        el('label', { class: 'switch' }, [input, el('span', { class: 'switch__track' })]),
      ]));
    }
  }

  function sendToWorker(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response);
        });
      } catch {
        resolve(null);
      }
    });
  }

  async function renderDue() {
    const host = qs('#due');
    const response = await sendToWorker({ type: 'cmx:upcoming', hours: 72 });
    host.textContent = '';

    if (!response?.ok) {
      host.append(el('li', {
        class: 'empty',
        text: 'Open a Canvas tab once so CanvasMax knows where to look.',
      }));
      return;
    }

    const items = (response.items || []).slice(0, 6);
    if (!items.length) {
      host.append(el('li', { class: 'empty', text: 'Nothing due in the next three days.' }));
      return;
    }

    const soonCutoff = Date.now() + 12 * 3600000;
    for (const item of items) {
      host.append(el('li', {}, [
        el('a', { href: item.url, target: '_blank', rel: 'noopener', text: item.title, title: item.title }),
        el('div', {
          class: `due__meta${item.due <= soonCutoff ? ' is-soon' : ''}`,
          text: [item.context, formatDueDate(item.due)].filter(Boolean).join(' · '),
        }),
      ]));
    }
  }

  (async function init() {
    settings = await storage.getSettings({ fresh: true });
    applyPopupTheme();

    const enabled = qs('#enabled');
    enabled.checked = Boolean(settings.enabled);
    enabled.addEventListener('change', () => save('enabled', enabled.checked));

    renderModes();
    themeOptions(qs('#darkTheme'), true, 'theme.darkTheme');
    themeOptions(qs('#lightTheme'), false, 'theme.lightTheme');
    renderToggles();
    renderDue();

    qs('#open-options').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
      window.close();
    });

    qs('#refresh').addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      chrome.tabs.sendMessage(tab.id, { type: 'cmx:refresh' }, () => {
        // A non-Canvas tab has no listener; ignore the resulting lastError.
        void chrome.runtime.lastError;
        window.close();
      });
    });
  })();
})();
