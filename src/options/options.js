/**
 * CanvasMax options page.
 *
 * Most of the UI is generated from the SECTIONS schema below: adding a setting
 * means adding one entry rather than writing markup and a change handler. The
 * theme editor, domain manager and import/export panels are hand-built because
 * they do more than read and write a single value.
 */
(function () {
  'use strict';

  const { util, storage, themes, gpa } = window.CanvasMax;
  const { el, qs, debounce } = util;

  let settings = null;

  // ------------------------------------------------------- path helpers ----

  const getPath = (object, path) =>
    path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), object);

  /** Build the minimal nested patch object for a dotted path. */
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

  async function update(path, value) {
    settings = await storage.saveSettings(patchFor(path, value));
    applyPageTheme();
    toast('Saved');
  }

  // -------------------------------------------------------------- toast ----

  let toastTimer = null;
  function toast(message) {
    const node = qs('#toast');
    node.textContent = message;
    node.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('is-visible'), 1600);
  }

  // ------------------------------------------------------------- schema ----

  const CARD_LINK_OPTIONS = Object.entries(window.CanvasMax.dashboardCards.LINK_DEFS)
    .map(([value, def]) => ({ value, label: def.label }));

  const NAV_OPTIONS = Object.entries(window.CanvasMax.uiTweaks.NAV_ITEMS)
    .map(([value, label]) => ({ value, label }));

  /** One text field per typographic role, straight from fonts.js. */
  const FONT_FIELDS = Object.entries(window.CanvasMax.fonts.FONT_ROLES).map(([role, def]) => ({
    type: 'text',
    path: `theme.fonts.${role}`,
    label: def.label,
    hint: def.hint,
    placeholder: 'Canvas default',
  }));

  const SECTIONS = [
    {
      id: 'general',
      title: 'General',
      hint: 'CanvasMax runs entirely in your browser. Nothing it reads from Canvas is sent anywhere else.',
      cards: [{
        title: 'Extension',
        fields: [
          {
            type: 'toggle', path: 'enabled', label: 'Enable CanvasMax',
            hint: 'Turn everything off without uninstalling.',
          },
          {
            type: 'toggle', path: 'debug', label: 'Verbose logging',
            hint: 'Log what each feature is doing to the page console.',
          },
        ],
      }],
      custom: 'data',
    },

    {
      id: 'appearance',
      title: 'Appearance',
      hint: 'Pick when dark mode applies and which palette each mode uses.',
      cards: [{
        title: 'Mode',
        fields: [
          {
            type: 'select', path: 'theme.mode', label: 'Theme mode',
            hint: 'Schedule mode switches automatically at the times below.',
            options: [
              { value: 'system', label: 'Follow system' },
              { value: 'light', label: 'Always light' },
              { value: 'dark', label: 'Always dark' },
              { value: 'schedule', label: 'On a schedule' },
            ],
          },
          {
            type: 'time', path: 'theme.schedule.start', label: 'Dark mode starts',
            visibleWhen: (s) => s.theme.mode === 'schedule',
          },
          {
            type: 'time', path: 'theme.schedule.end', label: 'Dark mode ends',
            visibleWhen: (s) => s.theme.mode === 'schedule',
          },
        ],
      }, {
        title: 'Typography',
        fields: [
          ...FONT_FIELDS,
          {
            type: 'number', path: 'theme.font.scale', label: 'Text size',
            hint: 'Percentage of the normal size.', min: 75, max: 150, step: 5,
          },
        ],
      }, {
        title: 'Readability',
        fields: [
          {
            type: 'toggle', path: 'theme.autoFixSurfaces', label: 'Repair light panels automatically',
            hint: 'Finds panels Canvas leaves white in dark mode and recolours them. Leave this on unless it causes trouble — it is what keeps dark mode working on Canvas screens this extension has never seen.',
          },
          {
            type: 'toggle', path: 'theme.dimImages', label: 'Dim images in dark mode',
            hint: 'Takes the glare off bright course images.',
          },
        ],
      }],
      custom: ['fonts', 'background', 'themes'],
    },

    {
      id: 'dashboard',
      title: 'Dashboard',
      hint: 'Card appearance, grades and quick links.',
      cards: [{
        title: 'Cards',
        fields: [
          { type: 'toggle', path: 'dashboard.enabled', label: 'Customise dashboard cards' },
          {
            type: 'select', path: 'dashboard.cardStyle', label: 'Card density',
            options: [
              { value: 'default', label: 'Default' },
              { value: 'condensed', label: 'Condensed' },
              { value: 'compact', label: 'Compact' },
            ],
          },
          { type: 'toggle', path: 'dashboard.gradients', label: 'Gradient card headers' },
          { type: 'toggle', path: 'dashboard.showCardImages', label: 'Show course images' },
        ],
      }, {
        title: 'Grades',
        fields: [
          {
            type: 'toggle', path: 'dashboard.showGrades', label: 'Show grades on cards',
            hint: 'Reads the score Canvas already computes for each enrollment.',
          },
          {
            type: 'select', path: 'dashboard.gradeDisplay', label: 'Grade format',
            options: [
              { value: 'both', label: 'Percent and letter' },
              { value: 'percent', label: 'Percent only' },
              { value: 'letter', label: 'Letter only' },
            ],
          },
        ],
      }, {
        title: 'Quick links',
        fields: [
          {
            type: 'checks', path: 'dashboard.cardLinks', label: 'Links under each card',
            stack: true, options: CARD_LINK_OPTIONS,
          },
        ],
      }, {
        title: 'Notes',
        fields: [
          {
            type: 'toggle', path: 'dashboard.notes', label: 'Dashboard notepad',
            hint: 'A scratchpad in the sidebar, stored on this device.',
          },
        ],
      }],
      custom: 'courses',
    },

    {
      id: 'planner',
      title: 'Planner',
      hint: 'The "Coming up" panel, built from Canvas’s planner API.',
      cards: [{
        title: 'Panel',
        fields: [
          { type: 'toggle', path: 'todo.enabled', label: 'Show the planner panel' },
          {
            type: 'number', path: 'todo.daysAhead', label: 'Days to look ahead',
            min: 1, max: 90, step: 1,
          },
          {
            type: 'select', path: 'todo.groupBy', label: 'Group items by',
            options: [
              { value: 'date', label: 'Due date' },
              { value: 'course', label: 'Course' },
            ],
          },
          { type: 'toggle', path: 'todo.showOverdue', label: 'Show overdue work' },
          { type: 'toggle', path: 'todo.includeCompleted', label: 'Keep completed items visible' },
          {
            type: 'number', path: 'todo.maxItems', label: 'Maximum items',
            min: 10, max: 200, step: 10,
          },
        ],
      }],
    },

    {
      id: 'grades',
      title: 'Grades & GPA',
      hint: 'GPA panel and the what-if calculator on each course’s Grades page.',
      cards: [{
        title: 'GPA',
        fields: [
          { type: 'toggle', path: 'gpa.enabled', label: 'Show the GPA panel' },
          {
            type: 'select', path: 'gpa.scale', label: 'GPA scale',
            options: Object.entries(gpa.SCALES).map(([value, scale]) => ({ value, label: scale.label })),
          },
        ],
      }, {
        title: 'What-if calculator',
        fields: [
          {
            type: 'toggle', path: 'whatIf.enabled', label: 'Show the what-if calculator',
            hint: 'Type hypothetical scores on a Grades page and watch the total move. Nothing is sent to Canvas.',
          },
          {
            type: 'toggle', path: 'preview.enabled', label: 'Alt-click to preview assignments',
            hint: 'Opens an assignment’s description in a dialog instead of navigating.',
          },
        ],
      }],
    },

    {
      id: 'tweaks',
      title: 'Interface',
      hint: 'Small changes to Canvas’s chrome.',
      cards: [{
        title: 'Hide things',
        fields: [
          { type: 'toggle', path: 'tweaks.hideLogo', label: 'Hide the institution logo' },
          { type: 'toggle', path: 'tweaks.hideBreadcrumbs', label: 'Hide breadcrumbs' },
          { type: 'toggle', path: 'tweaks.hideRightSidebar', label: 'Hide the right sidebar' },
          { type: 'toggle', path: 'tweaks.hideDashboardGreeting', label: 'Hide the dashboard greeting' },
          {
            type: 'checks', path: 'tweaks.hiddenNavItems', label: 'Hide global navigation items',
            stack: true, options: NAV_OPTIONS,
          },
        ],
      }, {
        title: 'Layout',
        fields: [
          {
            type: 'toggle', path: 'tweaks.fullWidth', label: 'Use the full window width',
            hint: 'Removes Canvas’s maximum content width.',
          },
          { type: 'toggle', path: 'tweaks.autoExpandModules', label: 'Auto-expand modules' },
        ],
      }],
    },

    {
      id: 'reminders',
      title: 'Reminders',
      hint: 'Desktop notifications before work is due. Polling happens in the background every 30 minutes.',
      cards: [{
        title: 'Notifications',
        fields: [
          { type: 'toggle', path: 'reminders.enabled', label: 'Enable reminders' },
          {
            type: 'checks', path: 'reminders.leadMinutes', label: 'Remind me',
            stack: true, numeric: true,
            options: [
              { value: 10080, label: '1 week before' },
              { value: 2880, label: '2 days before' },
              { value: 1440, label: '1 day before' },
              { value: 360, label: '6 hours before' },
              { value: 120, label: '2 hours before' },
              { value: 30, label: '30 minutes before' },
            ],
          },
        ],
      }],
      custom: 'reminders',
    },

    {
      id: 'domains',
      title: 'Canvas sites',
      hint: 'CanvasMax works on *.instructure.com out of the box. Add your school’s own Canvas domain here.',
      cards: [],
      custom: 'domains',
    },

    {
      id: 'advanced',
      title: 'Advanced',
      hint: 'Custom CSS, applied to every Canvas page after the theme.',
      cards: [{
        title: 'Custom CSS',
        fields: [
          {
            type: 'textarea', path: 'theme.customCss', label: 'CSS',
            hint: 'Use the CanvasMax variables (for example var(--cmx-accent)) so your rules follow the active theme.',
            rows: 12, stack: true,
            placeholder: '.ic-DashboardCard { border-width: 2px; }',
          },
        ],
      }],
    },
  ];

  // ---------------------------------------------------- control builders ---

  function buildToggle(field) {
    const input = el('input', {
      type: 'checkbox',
      id: `f-${field.path}`,
      ...(getPath(settings, field.path) ? { checked: true } : {}),
    });
    input.addEventListener('change', () => update(field.path, input.checked));
    return el('label', { class: 'switch' }, [input, el('span', { class: 'switch__track' })]);
  }

  function buildSelect(field) {
    const current = String(getPath(settings, field.path));
    const select = el('select', { id: `f-${field.path}` },
      field.options.map((option) => el('option', {
        value: option.value,
        text: option.label,
        ...(String(option.value) === current ? { selected: true } : {}),
      })));
    select.addEventListener('change', () => update(field.path, select.value));
    return select;
  }

  function buildNumber(field) {
    const input = el('input', {
      type: 'number',
      id: `f-${field.path}`,
      value: getPath(settings, field.path) ?? '',
      min: field.min,
      max: field.max,
      step: field.step || 1,
    });
    input.addEventListener('change', () => {
      let value = Number(input.value);
      if (!Number.isFinite(value)) value = field.min ?? 0;
      value = Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, value));
      input.value = value;
      update(field.path, value);
    });
    return input;
  }

  function buildText(field) {
    const input = el('input', {
      type: field.type === 'time' ? 'time' : 'text',
      id: `f-${field.path}`,
      value: getPath(settings, field.path) ?? '',
      placeholder: field.placeholder || '',
    });
    input.addEventListener('change', () => update(field.path, input.value));
    return input;
  }

  function buildTextarea(field) {
    const area = el('textarea', {
      id: `f-${field.path}`,
      rows: field.rows || 8,
      placeholder: field.placeholder || '',
    });
    area.value = getPath(settings, field.path) ?? '';
    area.addEventListener('input', debounce(() => update(field.path, area.value), 600));
    return area;
  }

  function buildChecks(field) {
    const selected = (getPath(settings, field.path) || []).map(String);
    const wrap = el('div', { class: 'checks' });

    for (const option of field.options) {
      const input = el('input', {
        type: 'checkbox',
        value: option.value,
        ...(selected.includes(String(option.value)) ? { checked: true } : {}),
      });
      input.addEventListener('change', () => {
        const values = [...wrap.querySelectorAll('input:checked')]
          .map((node) => (field.numeric ? Number(node.value) : node.value));
        update(field.path, values);
      });
      wrap.append(el('label', {}, [input, el('span', { text: option.label })]));
    }
    return wrap;
  }

  function buildRange(field) {
    const value = getPath(settings, field.path) ?? field.min ?? 0;
    const output = el('output', {
      text: `${value}${field.unit || ''}`,
      style: { fontVariantNumeric: 'tabular-nums', minWidth: '46px', textAlign: 'right', fontSize: '13px' },
    });
    const input = el('input', {
      type: 'range',
      id: `f-${field.path}`,
      min: field.min ?? 0,
      max: field.max ?? 100,
      step: field.step || 1,
      value,
      style: { width: '170px' },
    });
    input.addEventListener('input', () => { output.textContent = `${input.value}${field.unit || ''}`; });
    input.addEventListener('change', () => update(field.path, Number(input.value)));
    return el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [input, output]);
  }

  const BUILDERS = {
    range: buildRange,
    toggle: buildToggle,
    select: buildSelect,
    number: buildNumber,
    text: buildText,
    time: buildText,
    textarea: buildTextarea,
    checks: buildChecks,
  };

  function buildField(field) {
    if (field.visibleWhen && !field.visibleWhen(settings)) return null;

    const control = (BUILDERS[field.type] || buildText)(field);
    const stack = field.stack || field.type === 'textarea' || field.type === 'checks';

    return el('div', { class: `field${stack ? ' field--stack' : ''}` }, [
      el('label', { class: 'field__label', for: `f-${field.path}` }, [
        el('span', { text: field.label }),
        field.hint ? el('span', { class: 'field__hint', text: field.hint }) : null,
      ]),
      el('div', { class: 'field__control' }, [control]),
    ]);
  }

  // ------------------------------------------------------- theme editor ----

  let editingThemeId = null;

  function themeSwatch(theme) {
    const c = theme.colors;
    return el('span', { class: 'theme-card__swatch' }, [
      el('span', { style: { background: c.navBg } }),
      el('span', { style: { background: c.bg } }),
      el('span', { style: { background: c.surface } }),
      el('span', { style: { background: c.accent } }),
    ]);
  }

  function renderThemesCard() {
    const container = el('div', { class: 'card card--pad' });
    const custom = settings.theme.customThemes || {};

    const renderGrid = (kind) => {
      const wantDark = kind === 'dark';
      const activeId = wantDark ? settings.theme.darkTheme : settings.theme.lightTheme;
      const path = wantDark ? 'theme.darkTheme' : 'theme.lightTheme';

      const all = [
        ...Object.values(themes.BUILTIN_THEMES).map((t) => ({ theme: t, builtin: true })),
        ...Object.values(custom).map((t) => ({ theme: themes.normalizeTheme(t), builtin: false })),
      ].filter((entry) => entry.theme.dark === wantDark);

      const grid = el('div', { class: 'theme-grid' });
      for (const { theme, builtin } of all) {
        const card = el('button', {
          class: `theme-card${theme.id === activeId ? ' is-active' : ''}`,
          type: 'button',
          title: `Use ${theme.name}`,
          on: { click: () => update(path, theme.id).then(render) },
        }, [
          themeSwatch(theme),
          el('div', { class: 'theme-card__body' }, [
            el('div', { class: 'theme-card__name', text: theme.name }),
            el('div', { class: 'theme-card__meta', text: builtin ? 'Built in' : 'Yours' }),
          ]),
          theme.id === activeId ? el('span', { class: 'theme-card__badge', text: 'ACTIVE' }) : null,
        ]);
        grid.append(card);
      }
      return grid;
    };

    container.append(
      el('h3', { class: 'card__title', text: 'Dark themes' }),
      renderGrid('dark'),
      el('h3', { class: 'card__title', text: 'Light themes' }),
      renderGrid('light'),
      el('div', { class: 'btn-row' }, [
        el('button', {
          class: 'btn btn--primary', type: 'button', text: 'New theme',
          on: { click: () => startEditing(null) },
        }),
        el('button', {
          class: 'btn', type: 'button', text: 'Duplicate active dark theme',
          on: {
            click: () => {
              const source = themes.resolveTheme(settings.theme.darkTheme, custom);
              startEditing(null, { ...source, name: `${source.name} copy`, id: undefined });
            },
          },
        }),
        el('button', {
          class: 'btn', type: 'button', text: 'Import theme JSON',
          on: { click: importTheme },
        }),
        Object.keys(custom).length
          ? el('button', {
            class: 'btn', type: 'button', text: 'Export my themes',
            on: { click: exportThemes },
          })
          : null,
      ]),
      renderCustomThemeList(custom),
      editorState ? renderEditor() : null
    );

    return container;
  }

  function renderCustomThemeList(custom) {
    const ids = Object.keys(custom);
    if (!ids.length) {
      return el('p', { class: 'empty', text: 'You have no custom themes yet. Duplicate one to get started.' });
    }
    const list = el('ul', { class: 'list' });
    for (const id of ids) {
      const theme = themes.normalizeTheme(custom[id]);
      list.append(el('li', { class: 'list__row' }, [
        el('span', { text: `${theme.name} · ${theme.dark ? 'dark' : 'light'}` }),
        el('button', {
          class: 'btn btn--sm', type: 'button', text: 'Edit',
          on: { click: () => startEditing(id) },
        }),
        el('button', {
          class: 'btn btn--sm btn--danger', type: 'button', text: 'Delete',
          on: { click: () => deleteTheme(id, theme.name) },
        }),
      ]));
    }
    return list;
  }

  let editorState = null;

  function startEditing(id, seed) {
    const custom = settings.theme.customThemes || {};
    editingThemeId = id;
    editorState = id
      ? themes.normalizeTheme(custom[id])
      : themes.normalizeTheme(seed || themes.BUILTIN_THEMES.midnight);
    if (!id) editorState.name = seed?.name || 'My theme';
    render();
    document.getElementById('theme-editor')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderEditor() {
    if (!editorState) return null;
    const theme = editorState;

    const previewNode = el('div', { class: 'preview' });
    const auditNode = el('div', { class: 'audit' });

    const refreshPreview = () => {
      const c = theme.colors;
      previewNode.textContent = '';
      previewNode.style.background = c.bg;
      previewNode.style.borderColor = c.border;
      previewNode.append(
        el('div', {
          class: 'preview__nav',
          style: { background: c.navBg, color: c.navText },
          text: 'Canvas',
        }),
        el('div', { class: 'preview__body' }, [
          el('div', {
            class: 'preview__card',
            style: { background: c.surface, borderColor: c.border },
          }, [
            el('div', { class: 'preview__hero', style: { background: c.accent } }),
            el('div', { class: 'preview__cardbody' }, [
              el('div', { style: { color: c.text, fontWeight: '600' }, text: 'Organic Chemistry' }),
              el('div', { class: 'preview__muted', style: { color: c.textMuted }, text: 'Fall term · 92.4%' }),
            ]),
          ]),
          el('div', { style: { color: c.text } }, [
            'Body text with a ',
            el('a', { style: { color: c.link }, text: 'link' }),
            '.',
          ]),
          el('span', {
            class: 'preview__btn',
            style: { background: c.accent, color: util.readableTextOn(c.accent) },
            text: 'Primary button',
          }),
        ])
      );

      auditNode.textContent = '';
      for (const check of themes.auditContrast(theme)) {
        auditNode.append(el('div', {
          class: `audit__row ${check.pass ? 'is-pass' : 'is-fail'}`,
        }, [
          el('span', { text: check.label }),
          el('span', { text: `${check.ratio}:1 ${check.pass ? '' : `(needs ${check.min})`}` }),
        ]));
      }
    };

    const colorRows = themes.REQUIRED_COLORS.map((key) => {
      const value = theme.colors[key];
      const picker = el('input', { type: 'color', value, 'aria-label': `${key} color` });
      const text = el('input', { type: 'text', value, 'aria-label': `${key} hex value` });

      const set = (next) => {
        if (!util.parseHex(next)) return;
        theme.colors[key] = next;
        picker.value = next.slice(0, 7);
        text.value = next;
        refreshPreview();
      };
      picker.addEventListener('input', () => set(picker.value));
      text.addEventListener('change', () => set(text.value.trim()));

      return el('div', { class: 'color-row' }, [
        el('label', { text: key }),
        picker,
        text,
      ]);
    });

    const nameInput = el('input', { type: 'text', value: theme.name, 'aria-label': 'Theme name' });
    nameInput.addEventListener('input', () => { theme.name = nameInput.value; });

    const darkToggle = el('input', {
      type: 'checkbox',
      ...(theme.dark ? { checked: true } : {}),
    });
    darkToggle.addEventListener('change', () => { theme.dark = darkToggle.checked; refreshPreview(); });

    const radiusInput = el('input', {
      type: 'number', value: theme.radius, min: 0, max: 24, step: 1, 'aria-label': 'Corner radius',
    });
    radiusInput.addEventListener('change', () => { theme.radius = Number(radiusInput.value) || 0; });

    const editor = el('div', { class: 'editor', id: 'theme-editor' }, [
      el('div', {}, [
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Theme name' }),
          el('div', { class: 'field__control' }, [nameInput]),
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label' }, [
            el('span', { text: 'Dark theme' }),
            el('span', { class: 'field__hint', text: 'Dark themes are offered for the dark slot, light for the light slot.' }),
          ]),
          el('div', { class: 'field__control' }, [
            el('label', { class: 'switch' }, [darkToggle, el('span', { class: 'switch__track' })]),
          ]),
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: 'Corner radius (px)' }),
          el('div', { class: 'field__control' }, [radiusInput]),
        ]),
        ...colorRows,
        el('div', { class: 'btn-row' }, [
          el('button', { class: 'btn btn--primary', type: 'button', text: 'Save theme', on: { click: saveTheme } }),
          el('button', {
            class: 'btn', type: 'button', text: 'Copy JSON',
            on: {
              click: async () => {
                await navigator.clipboard.writeText(JSON.stringify(exportShape(theme), null, 2));
                toast('Theme JSON copied');
              },
            },
          }),
          el('button', {
            class: 'btn', type: 'button', text: 'Cancel',
            on: {
              click: () => { editorState = null; editingThemeId = null; render(); },
            },
          }),
        ]),
      ]),
      el('div', {}, [previewNode, auditNode]),
    ]);

    refreshPreview();
    return editor;
  }

  const exportShape = (theme) => ({
    id: theme.id,
    name: theme.name,
    dark: theme.dark,
    radius: theme.radius,
    colors: theme.colors,
  });

  async function saveTheme() {
    const custom = { ...(settings.theme.customThemes || {}) };
    const check = themes.validateTheme(editorState);
    if (!check.ok) {
      toast(check.errors[0]);
      return;
    }

    const id = editingThemeId || themes.slugify(editorState.name, custom);
    custom[id] = exportShape({ ...check.theme, id });

    settings = await storage.saveSettings({ theme: { customThemes: custom } });

    // Make a brand new theme the active one for its mode — otherwise saving
    // appears to do nothing.
    if (!editingThemeId) {
      await update(custom[id].dark ? 'theme.darkTheme' : 'theme.lightTheme', id);
    }

    editingThemeId = null;
    editorState = null;
    applyPageTheme();
    render();
    toast('Theme saved');
  }

  async function deleteTheme(id, name) {
    if (!window.confirm(`Delete the theme "${name}"? This cannot be undone.`)) return;

    const custom = { ...(settings.theme.customThemes || {}) };
    delete custom[id];

    // A deep merge can add and overwrite keys but never remove one, so a
    // deletion has to go through replaceSettings with the map rebuilt.
    const next = storage.deepMerge(settings, {});
    next.theme.customThemes = custom;
    if (next.theme.darkTheme === id) next.theme.darkTheme = 'midnight';
    if (next.theme.lightTheme === id) next.theme.lightTheme = 'canvas-light';

    settings = await storage.replaceSettings(next);
    applyPageTheme();
    render();
    toast('Theme deleted');
  }

  function importTheme() {
    const input = el('input', { type: 'file', accept: 'application/json,.json' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const custom = { ...(settings.theme.customThemes || {}) };
        let added = 0;

        for (const entry of list) {
          const check = themes.validateTheme(entry);
          if (!check.ok) continue;
          const id = themes.slugify(check.theme.name, custom);
          custom[id] = exportShape({ ...check.theme, id });
          added += 1;
        }

        if (!added) {
          toast('No valid themes in that file');
          return;
        }
        settings = await storage.saveSettings({ theme: { customThemes: custom } });
        render();
        toast(`Imported ${added} theme${added === 1 ? '' : 's'}`);
      } catch (err) {
        toast('That file is not valid JSON');
        console.warn(err);
      }
    });
    input.click();
  }

  function exportThemes() {
    const custom = Object.values(settings.theme.customThemes || {}).map(themes.normalizeTheme).map(exportShape);
    download('canvasmax-themes.json', JSON.stringify(custom, null, 2));
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ------------------------------------------------------------ courses ----

  /**
   * Per-course controls (hide, recolor, rename, image). Needs a live Canvas
   * session, so it degrades to an explanation when no Canvas tab is available.
   */
  function renderCoursesCard() {
    const container = el('div', { class: 'card card--pad' }, [
      el('h3', { class: 'card__title', text: 'Per-course settings' }),
      el('p', { class: 'empty', text: 'Loading your courses from Canvas…' }),
    ]);

    (async () => {
      const origins = await sendToWorker({ type: 'cmx:origins' });
      const origin = origins?.origins?.[0];

      if (!origin) {
        container.lastChild.replaceWith(el('div', { class: 'callout' }, [
          'Open your Canvas dashboard once with CanvasMax enabled, then come back — ',
          'the extension needs to know which Canvas site you use before it can list your courses.',
        ]));
        return;
      }

      let courses = [];
      try {
        courses = await new window.CanvasMax.api.CanvasApi(origin).courses({ ttl: 0 });
      } catch (err) {
        container.lastChild.replaceWith(el('div', { class: 'callout callout--warn' }, [
          `Could not reach ${origin}. Make sure you are signed in to Canvas in this browser.`,
        ]));
        console.warn(err);
        return;
      }

      const hidden = (settings.dashboard.hiddenCourses || []).map(String);
      const list = el('ul', { class: 'list' });

      for (const course of courses) {
        const id = String(course.id);
        const nickname = settings.dashboard.nicknames?.[id] || '';
        const color = settings.dashboard.colorOverrides?.[id] || '#4f8cff';

        const hideBox = el('input', {
          type: 'checkbox',
          ...(hidden.includes(id) ? { checked: true } : {}),
          'aria-label': `Hide ${course.name}`,
        });
        hideBox.addEventListener('change', async () => {
          const current = new Set((settings.dashboard.hiddenCourses || []).map(String));
          if (hideBox.checked) current.add(id);
          else current.delete(id);
          await update('dashboard.hiddenCourses', [...current]);
        });

        const colorInput = el('input', {
          type: 'color', value: color, 'aria-label': `Card color for ${course.name}`,
          style: { width: '36px', height: '28px', padding: '0' },
        });
        colorInput.addEventListener('change', () => {
          update(`dashboard.colorOverrides.${id}`, colorInput.value);
        });

        const nameInput = el('input', {
          type: 'text', value: nickname, placeholder: course.name,
          'aria-label': `Nickname for ${course.name}`,
          style: { width: '190px' },
        });
        nameInput.addEventListener('change', () => {
          update(`dashboard.nicknames.${id}`, nameInput.value.trim());
        });

        list.append(el('li', { class: 'list__row' }, [
          el('span', { text: course.name, title: course.name }),
          nameInput,
          colorInput,
          el('label', { style: { display: 'flex', gap: '4px', alignItems: 'center', fontSize: '12.5px' } }, [
            hideBox, el('span', { text: 'Hide' }),
          ]),
        ]));
      }

      container.lastChild.replaceWith(list);
    })();

    return container;
  }

  // ------------------------------------------------------------ domains ----

  function renderDomainsCard() {
    const container = el('div', { class: 'card card--pad' });

    const input = el('input', {
      type: 'text',
      placeholder: 'canvas.myschool.edu',
      'aria-label': 'Canvas domain',
      style: { flex: '1 1 auto', minWidth: '200px' },
    });

    const addButton = el('button', {
      class: 'btn btn--primary', type: 'button', text: 'Grant access',
      on: { click: () => addDomain(input.value.trim()) },
    });

    const list = el('ul', { class: 'list' });

    const refreshList = () => {
      list.textContent = '';
      const domains = settings.domains || [];
      if (!domains.length) {
        list.append(el('li', { class: 'empty', text: 'No extra domains yet.' }));
        return;
      }
      for (const domain of domains) {
        list.append(el('li', { class: 'list__row' }, [
          el('span', { text: domain }),
          el('button', {
            class: 'btn btn--sm btn--danger', type: 'button', text: 'Remove',
            on: { click: () => removeDomain(domain) },
          }),
        ]));
      }
    };

    async function addDomain(domain) {
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
        toast('Enter a hostname like canvas.myschool.edu');
        return;
      }
      const pattern = `*://${domain}/*`;
      let granted = false;
      try {
        granted = await chrome.permissions.request({ origins: [pattern] });
      } catch (err) {
        toast('Could not request permission');
        console.warn(err);
        return;
      }
      if (!granted) {
        toast('Permission declined');
        return;
      }

      const domains = [...new Set([...(settings.domains || []), domain])];
      settings = await storage.saveSettings({ domains });
      await sendToWorker({ type: 'cmx:sync-scripts' });
      input.value = '';
      refreshList();
      toast(`CanvasMax now runs on ${domain}`);
    }

    async function removeDomain(domain) {
      const domains = (settings.domains || []).filter((d) => d !== domain);
      const next = storage.deepMerge(settings, {});
      next.domains = domains;
      settings = await storage.replaceSettings(next);

      try {
        await chrome.permissions.remove({ origins: [`*://${domain}/*`] });
      } catch { /* the user may have revoked it already */ }

      await sendToWorker({ type: 'cmx:sync-scripts' });
      refreshList();
      toast(`Removed ${domain}`);
    }

    container.append(
      el('h3', { class: 'card__title', text: 'Your Canvas sites' }),
      el('p', { class: 'field__hint', style: { padding: '10px 0' } }, [
        'Canvas is self-hosted, so most schools use their own domain. Add yours and Chrome will ask for permission for that one site.',
      ]),
      el('div', { style: { display: 'flex', gap: '8px', padding: '4px 0 14px' } }, [input, addButton]),
      list,
      el('div', { class: 'callout' }, [
        'CanvasMax only ever asks for the sites you add. It never requests access to all your browsing.',
      ])
    );

    refreshList();
    return container;
  }

  // --------------------------------------------------------------- data ----

  function renderDataCard() {
    const fileInput = el('input', {
      type: 'file', accept: 'application/json,.json', style: { display: 'none' },
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        settings = await storage.replaceSettings(parsed);
        applyPageTheme();
        render();
        toast('Settings imported');
      } catch (err) {
        toast('That file is not valid CanvasMax settings');
        console.warn(err);
      }
    });

    return el('div', { class: 'card card--pad' }, [
      el('h3', { class: 'card__title', text: 'Your settings' }),
      el('p', { class: 'field__hint', style: { padding: '10px 0' } }, [
        'Settings sync through your Chrome profile automatically. Export gives you a portable copy — for another browser, or as a backup.',
      ]),
      el('div', { class: 'btn-row' }, [
        el('button', {
          class: 'btn', type: 'button', text: 'Export settings',
          on: {
            click: () => download('canvasmax-settings.json', JSON.stringify(settings, null, 2)),
          },
        }),
        el('button', {
          class: 'btn', type: 'button', text: 'Import settings',
          on: { click: () => fileInput.click() },
        }),
        el('button', {
          class: 'btn btn--danger', type: 'button', text: 'Reset everything',
          on: {
            click: async () => {
              if (!window.confirm('Reset all CanvasMax settings to their defaults?')) return;
              settings = await storage.resetSettings();
              applyPageTheme();
              render();
              toast('Settings reset');
            },
          },
        }),
      ]),
      fileInput,
    ]);
  }

  function renderRemindersCard() {
    return el('div', { class: 'card card--pad' }, [
      el('h3', { class: 'card__title', text: 'Test' }),
      el('div', { class: 'btn-row' }, [
        el('button', {
          class: 'btn', type: 'button', text: 'Check for due work now',
          on: {
            click: async () => {
              toast('Checking…');
              const result = await sendToWorker({ type: 'cmx:run-reminders' });
              toast(result?.ok ? 'Checked. Any due reminders have been sent.' : 'Could not reach the background worker');
            },
          },
        }),
      ]),
      el('div', { class: 'callout' }, [
        'Chrome must be running for reminders to fire. CanvasMax checks every 30 minutes and never notifies twice for the same deadline.',
      ]),
    ]);
  }

  // ------------------------------------------------------ google fonts ----

  function renderFontsCard() {
    const container = el('div', { class: 'card card--pad' });
    const list = el('ul', { class: 'list' });
    const status = el('p', { class: 'field__hint', style: { padding: '8px 0 0' } });

    const input = el('input', {
      type: 'text',
      placeholder: 'Lora',
      'aria-label': 'Google Fonts family name',
      style: { flex: '1 1 auto', minWidth: '180px' },
    });

    const refreshList = () => {
      list.textContent = '';
      const families = settings.theme.googleFonts || [];
      if (!families.length) {
        list.append(el('li', { class: 'empty', text: 'No imported fonts yet.' }));
        return;
      }
      for (const family of families) {
        list.append(el('li', { class: 'list__row' }, [
          el('span', {
            text: family,
            style: { fontFamily: `"${family}", inherit`, fontSize: '16px' },
          }),
          el('button', {
            class: 'btn btn--sm btn--danger', type: 'button', text: 'Remove',
            on: { click: () => removeFont(family) },
          }),
        ]));
      }
    };

    async function importFont() {
      const family = input.value.trim();
      if (!window.CanvasMax.fonts.isValidFamilyName(family)) {
        toast('Enter a family name like "Lora"');
        return;
      }

      // Ask for access to Google's domains only at the moment it is needed,
      // rather than demanding it at install time.
      let granted = false;
      try {
        granted = await chrome.permissions.request({
          origins: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'],
        });
      } catch (err) {
        toast('Could not request permission');
        console.warn(err);
        return;
      }
      if (!granted) {
        toast('Permission declined — fonts can’t be downloaded without it');
        return;
      }

      status.textContent = `Downloading ${family}…`;
      const result = await sendToWorker({ type: 'cmx:import-font', family });

      if (!result?.ok) {
        status.textContent = result?.error || 'Could not reach the background worker.';
        return;
      }

      const families = [...new Set([...(settings.theme.googleFonts || []), family])];
      settings = await storage.saveSettings({ theme: { googleFonts: families } });
      status.textContent = `Imported ${family} — ${result.faces} styles, ${(result.bytes / 1024).toFixed(0)} KB.`;
      input.value = '';
      refreshList();
      toast(`${family} imported`);
    }

    async function removeFont(family) {
      const families = (settings.theme.googleFonts || []).filter((f) => f !== family);
      const next = storage.deepMerge(settings, {});
      next.theme.googleFonts = families;
      settings = await storage.replaceSettings(next);
      await sendToWorker({ type: 'cmx:remove-font', family });
      refreshList();
      toast(`Removed ${family}`);
    }

    container.append(
      el('h3', { class: 'card__title', text: 'Google Fonts' }),
      el('p', { class: 'field__hint', style: { padding: '10px 0' } }, [
        'Import a family by name, then use it in any of the roles above. ',
        'CanvasMax downloads the font once, in the background, and stores it on this device — ',
        'your Canvas pages never contact Google.',
      ]),
      el('div', { style: { display: 'flex', gap: '8px', padding: '4px 0 12px' } }, [
        input,
        el('button', {
          class: 'btn btn--primary', type: 'button', text: 'Import',
          on: { click: importFont },
        }),
      ]),
      list,
      status
    );

    refreshList();
    return container;
  }

  // -------------------------------------------------------- background ----

  /**
   * Downscale an uploaded image before storing it. A phone photo is several
   * megabytes; as a page background it only ever needs to be screen-sized, and
   * storage.local is not the place for the original.
   */
  async function toDownscaledDataUrl(file, maxDimension = 1920, quality = 0.82) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    return { dataUrl: canvas.toDataURL('image/jpeg', quality), width, height };
  }

  function renderBackgroundCard() {
    const container = el('div', { class: 'card card--pad' });
    const preview = el('div', {
      style: {
        height: '150px',
        borderRadius: 'var(--cmx-radius-sm)',
        border: '1px solid var(--cmx-border)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--cmx-text-muted)',
        fontSize: '13px',
        marginBottom: '14px',
        overflow: 'hidden',
      },
    });
    const status = el('p', { class: 'field__hint', style: { padding: '6px 0 0' } });

    const fileInput = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/gif',
      style: { display: 'none' },
    });

    async function refreshPreview() {
      const background = settings.theme.background || {};
      let image = '';
      if (background.source === 'url') image = background.url || '';
      else image = await storage.getLocal(storage.BACKGROUND_KEY, '');

      if (image) {
        preview.style.backgroundImage = `url("${image.replace(/"/g, '%22')}")`;
        preview.textContent = '';
      } else {
        preview.style.backgroundImage = 'none';
        preview.textContent = 'No background image yet';
      }
    }

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      status.textContent = 'Processing…';
      try {
        const { dataUrl, width, height } = await toDownscaledDataUrl(file);
        const kb = Math.round((dataUrl.length * 0.75) / 1024);
        if (kb > 4096) {
          status.textContent = 'That image is still too large after resizing. Try a smaller one.';
          return;
        }
        await storage.setLocal(storage.BACKGROUND_KEY, dataUrl);
        settings = await storage.saveSettings({
          theme: { background: { enabled: true, source: 'upload' } },
        });
        status.textContent = `Saved — resized to ${width}x${height}, about ${kb} KB.`;
        await refreshPreview();
        render();
        toast('Background set');
      } catch (err) {
        status.textContent = 'Could not read that image file.';
        console.warn(err);
      }
    });

    container.append(
      el('h3', { class: 'card__title', text: 'Background image' }),
      el('div', { style: { padding: '14px 0 0' } }, [preview]),
      el('div', { class: 'btn-row' }, [
        el('button', {
          class: 'btn btn--primary', type: 'button', text: 'Upload an image',
          on: { click: () => fileInput.click() },
        }),
        el('button', {
          class: 'btn', type: 'button', text: 'Clear',
          on: {
            click: async () => {
              await storage.removeLocal(storage.BACKGROUND_KEY);
              settings = await storage.saveSettings({ theme: { background: { enabled: false } } });
              status.textContent = '';
              await refreshPreview();
              render();
              toast('Background cleared');
            },
          },
        }),
      ]),
      buildField({
        type: 'toggle', path: 'theme.background.enabled', label: 'Show the background image',
      }),
      buildField({
        type: 'select', path: 'theme.background.source', label: 'Image source',
        options: [
          { value: 'upload', label: 'Uploaded image' },
          { value: 'url', label: 'Web address' },
        ],
      }),
      buildField({
        type: 'text', path: 'theme.background.url', label: 'Image address',
        hint: 'Must start with https://. Only used when the source is set to a web address.',
        placeholder: 'https://example.com/wallpaper.jpg',
        stack: true,
      }),
      buildField({
        type: 'select', path: 'theme.background.fit', label: 'Fit',
        options: [
          { value: 'cover', label: 'Fill the window' },
          { value: 'contain', label: 'Fit inside the window' },
          { value: 'tile', label: 'Tile' },
          { value: 'center', label: 'Centre at original size' },
        ],
      }),
      buildField({
        type: 'range', path: 'theme.background.dim', label: 'Dim',
        hint: 'Fades the image toward the theme’s background colour. Text sitting over a photograph needs this.',
        min: 0, max: 90, step: 5, unit: '%',
      }),
      buildField({
        type: 'range', path: 'theme.background.blur', label: 'Blur',
        min: 0, max: 20, step: 1, unit: 'px',
      }),
      status,
      fileInput
    );

    refreshPreview();
    return container;
  }

  const CUSTOM_CARDS = {
    fonts: renderFontsCard,
    background: renderBackgroundCard,
    themes: renderThemesCard,
    courses: renderCoursesCard,
    domains: renderDomainsCard,
    data: renderDataCard,
    reminders: renderRemindersCard,
  };

  // ------------------------------------------------------------ plumbing ---

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

  /** Paint the options page itself with the user's active theme. */
  function applyPageTheme() {
    const dark = themes.shouldUseDark(
      settings,
      new Date(),
      window.matchMedia('(prefers-color-scheme: dark)').matches
    );
    const theme = themes.resolveTheme(
      dark ? settings.theme.darkTheme : settings.theme.lightTheme,
      settings.theme.customThemes
    );
    const vars = themes.themeVariables(theme);
    for (const [key, value] of Object.entries(vars)) {
      document.documentElement.style.setProperty(key, value);
    }
  }

  let activeSection = 'general';

  function render() {
    const nav = qs('#nav');
    nav.textContent = '';
    for (const section of SECTIONS) {
      nav.append(el('button', {
        class: `nav__item${section.id === activeSection ? ' is-active' : ''}`,
        type: 'button',
        text: section.title,
        on: {
          click: () => {
            activeSection = section.id;
            render();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          },
        },
      }));
    }

    const main = qs('#main');
    main.textContent = '';

    const section = SECTIONS.find((s) => s.id === activeSection) || SECTIONS[0];
    const node = el('section', { class: 'section is-active' }, [
      el('div', { class: 'section__head' }, [
        el('h1', { class: 'section__title', text: section.title }),
        el('p', { class: 'section__hint', text: section.hint }),
      ]),
    ]);

    for (const card of section.cards || []) {
      const fields = (card.fields || []).map(buildField).filter(Boolean);
      if (!fields.length) continue;
      node.append(el('div', { class: 'card' }, [
        el('h3', { class: 'card__title', text: card.title }),
        ...fields,
      ]));
    }

    for (const key of [].concat(section.custom || [])) {
      if (CUSTOM_CARDS[key]) node.append(CUSTOM_CARDS[key]());
    }

    main.append(node);
  }

  // ---------------------------------------------------------------- init ---

  (async function init() {
    settings = await storage.getSettings({ fresh: true });

    qs('#version').textContent = `v${chrome.runtime.getManifest().version}`;

    const params = new URLSearchParams(location.search);
    if (params.get('welcome')) activeSection = 'domains';

    applyPageTheme();
    render();

    // Keep the page honest if another context changes settings.
    storage.onChange((next) => {
      settings = next;
      applyPageTheme();
    });
  })();
})();
