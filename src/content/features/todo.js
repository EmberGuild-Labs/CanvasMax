/**
 * Feature: the planner panel ("what's due").
 *
 * Canvas's own To Do list only shows work that needs *submitting*, in an
 * unhelpful order, and its full planner view is the thing paid alternatives
 * gate. This builds the same view from /api/v1/planner/items, which returns
 * assignments, quizzes, discussions, calendar events and the user's own
 * planner notes in one pass, and renders it grouped, filterable and
 * checkable.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});
  const features = (CanvasMax.features = CanvasMax.features || []);
  const {
    qs, el, waitFor, relativeDayLabel, formatTime, colorFromString, startOfDay, DAY_MS,
  } = CanvasMax.util;

  const PANEL_ID = 'cmx-planner-panel';
  /** How far back to look for work that is overdue but still actionable. */
  const OVERDUE_WINDOW_DAYS = 21;

  const TYPE_LABEL = {
    assignment: 'Assignment',
    quiz: 'Quiz',
    discussion_topic: 'Discussion',
    wiki_page: 'Page',
    planner_note: 'Note',
    calendar_event: 'Event',
    assessment_request: 'Peer review',
    sub_assignment: 'Assignment',
  };

  // ------------------------------------------------------------- shaping ---

  /**
   * Reduce a raw planner item to what the UI needs.
   * @returns {object|null} null for items we deliberately never show
   */
  function normalizeItem(item, now = new Date()) {
    const plannable = item?.plannable || {};
    const dateValue = item?.plannable_date || plannable.due_at || plannable.todo_date || plannable.start_at;
    const date = dateValue ? new Date(dateValue) : null;
    if (date && Number.isNaN(date.getTime())) return null;

    const submissions = item?.submissions || {};
    const complete = Boolean(
      item?.planner_override?.marked_complete
      || submissions.submitted
      || submissions.graded
      || submissions.excused
    );

    const overdue = Boolean(date && date < now && !complete && item?.plannable_type !== 'calendar_event');

    return {
      key: `${item.plannable_type}:${item.plannable_id}`,
      raw: item,
      type: item.plannable_type,
      typeLabel: TYPE_LABEL[item.plannable_type] || 'Item',
      title: plannable.title || plannable.name || '(untitled)',
      url: item.html_url || plannable.html_url || null,
      courseId: item.course_id ? String(item.course_id) : null,
      contextName: item.context_name || '',
      date,
      points: Number.isFinite(Number(plannable.points_possible)) ? Number(plannable.points_possible) : null,
      complete,
      overdue,
      missing: Boolean(submissions.missing),
      late: Boolean(submissions.late),
    };
  }

  /** Sort undated items last, otherwise chronological. */
  function byDate(a, b) {
    if (!a.date && !b.date) return a.title.localeCompare(b.title);
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date - b.date;
  }

  /**
   * Group items for display.
   * @returns {Array<{label:string, items:Array, overdue?:boolean}>}
   */
  function groupItems(items, { groupBy = 'date', now = new Date() } = {}) {
    const groups = [];

    const overdue = items.filter((item) => item.overdue).sort(byDate);
    const upcoming = items.filter((item) => !item.overdue).sort(byDate);

    if (overdue.length) groups.push({ key: 'overdue', label: 'Overdue', items: overdue, overdue: true });

    if (groupBy === 'course') {
      const byCourse = new Map();
      for (const item of upcoming) {
        const label = item.contextName || 'Other';
        if (!byCourse.has(label)) byCourse.set(label, []);
        byCourse.get(label).push(item);
      }
      for (const [label, list] of [...byCourse.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        groups.push({ key: `course:${label}`, label, items: list });
      }
      return groups;
    }

    const byDay = new Map();
    for (const item of upcoming) {
      const key = item.date ? startOfDay(item.date).getTime() : 'none';
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(item);
    }
    const keys = [...byDay.keys()].sort((a, b) => {
      if (a === 'none') return 1;
      if (b === 'none') return -1;
      return a - b;
    });
    for (const key of keys) {
      groups.push({
        key: `day:${key}`,
        label: key === 'none' ? 'No due date' : relativeDayLabel(new Date(key), now),
        items: byDay.get(key),
      });
    }
    return groups;
  }

  // ------------------------------------------------------------ rendering --

  function itemRow(item, ctx, colorFor) {
    const checkbox = el('input', {
      type: 'checkbox',
      class: 'cmx-item__check',
      'aria-label': `Mark "${item.title}" complete`,
      ...(item.complete ? { checked: true } : {}),
    });

    checkbox.addEventListener('change', async () => {
      checkbox.disabled = true;
      const wanted = checkbox.checked;
      try {
        await ctx.api.setPlannerComplete(item.raw, wanted);
        item.complete = wanted;
        row.classList.toggle('is-done', wanted);
      } catch (err) {
        console.warn('[CanvasMax] could not update planner item', err);
        checkbox.checked = !wanted; // put the UI back the way Canvas has it
      } finally {
        checkbox.disabled = false;
      }
    });

    const meta = el('div', { class: 'cmx-item__meta' }, [
      el('span', {
        class: 'cmx-item__dot',
        style: { background: colorFor(item) },
        'aria-hidden': 'true',
      }),
      el('span', { class: 'cmx-item__course', text: item.contextName || item.typeLabel }),
      item.date ? el('span', { text: formatTime(item.date) }) : null,
      item.points != null ? el('span', { text: `${item.points} pts` }) : null,
      item.missing ? el('span', { class: 'cmx-chip cmx-chip--overdue', text: 'Missing' }) : null,
      item.late && !item.missing ? el('span', { class: 'cmx-chip cmx-chip--today', text: 'Late' }) : null,
    ]);

    const title = item.url
      ? el('a', { class: 'cmx-item__title', href: `${ctx.api.origin}${item.url}`, text: item.title })
      : el('span', { class: 'cmx-item__title', text: item.title });

    const row = el('li', {
      class: `cmx-item${item.complete ? ' is-done' : ''}`,
      dataset: { cmxKey: item.key },
    }, [checkbox, el('div', { class: 'cmx-item__body' }, [title, meta])]);

    return row;
  }

  function render(container, groups, ctx, colorFor) {
    container.textContent = '';

    if (!groups.length) {
      container.append(el('div', { class: 'cmx-empty', text: 'Nothing due in this window. Enjoy it.' }));
      return;
    }

    for (const group of groups) {
      container.append(el('div', { class: 'cmx-group__label' }, [
        el('span', { text: group.label }),
        el('span', { class: 'cmx-group__count', text: `${group.items.length}` }),
      ]));
      const list = el('ul', { class: 'cmx-list' });
      for (const item of group.items) list.append(itemRow(item, ctx, colorFor));
      container.append(list);
    }
  }

  function buildPanel(ctx, { onRefresh, onChangeRange }) {
    const body = el('div', { class: 'cmx-panel__body' }, [
      el('div', { class: 'cmx-empty' }, [el('span', { class: 'cmx-spinner' })]),
    ]);

    const rangeSelect = el('select', {
      class: 'cmx-select',
      style: { width: 'auto', fontSize: '11px', padding: '2px 4px' },
      'aria-label': 'How far ahead to look',
      on: { change: (event) => onChangeRange(Number(event.target.value)) },
    }, [7, 14, 30, 60].map((days) => el('option', {
      value: days,
      text: `${days}d`,
      ...(days === ctx.settings.todo.daysAhead ? { selected: true } : {}),
    })));

    const refreshButton = el('button', {
      class: 'cmx-btn cmx-btn--ghost cmx-btn--icon',
      title: 'Refresh',
      'aria-label': 'Refresh planner',
      html: '<svg viewBox="0 0 20 20"><path d="M10 3a7 7 0 1 0 6.32 4h-2.2A5 5 0 1 1 10 5v2.5L14 4 10 .5V3z"/></svg>',
      on: { click: onRefresh },
    });

    const panel = el('div', { id: PANEL_ID, class: 'cmx-panel cmx-root' }, [
      el('div', { class: 'cmx-panel__header' }, [
        el('h2', { class: 'cmx-panel__title', text: 'Coming up' }),
        el('div', { class: 'cmx-panel__actions' }, [rangeSelect, refreshButton]),
      ]),
      body,
    ]);

    return { panel, body };
  }

  /** Where the panel goes: the right sidebar if there is one, else the dashboard. */
  async function mountPoint() {
    const sidebar = qs('#right-side') || await waitFor('#right-side', { timeout: 6000 });
    if (sidebar) return { node: sidebar, position: 'afterbegin' };
    const dashboard = qs('.ic-Dashboard-header__layout') || qs('#content');
    return dashboard ? { node: dashboard, position: 'afterend' } : null;
  }

  // ---------------------------------------------------------------- data ---

  async function load(ctx, daysAhead) {
    const now = new Date();
    const start = new Date(now.getTime() - OVERDUE_WINDOW_DAYS * DAY_MS);
    const end = new Date(now.getTime() + daysAhead * DAY_MS);

    const raw = await ctx.api.plannerItems({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });

    const items = raw
      .map((item) => normalizeItem(item, now))
      .filter(Boolean)
      .filter((item) => {
        if (item.complete && !ctx.settings.todo.includeCompleted) return false;
        if (item.overdue && !ctx.settings.todo.showOverdue) return false;
        return true;
      })
      .slice(0, ctx.settings.todo.maxItems || 60);

    return items;
  }

  async function run(ctx, state) {
    const mount = await mountPoint();
    if (!mount) return;

    if (!state.panel) {
      const built = buildPanel(ctx, {
        onRefresh: () => {
          ctx.api.invalidate('planner:');
          run(ctx, state);
        },
        onChangeRange: async (days) => {
          await CanvasMax.storage.saveSettings({ todo: { daysAhead: days } });
          ctx.settings.todo.daysAhead = days;
          ctx.api.invalidate('planner:');
          run(ctx, state);
        },
      });
      state.panel = built.panel;
      state.body = built.body;
      mount.node.insertAdjacentElement(mount.position, state.panel);
    } else if (!state.panel.isConnected) {
      mount.node.insertAdjacentElement(mount.position, state.panel);
    }

    state.body.textContent = '';
    state.body.append(el('div', { class: 'cmx-empty' }, [el('span', { class: 'cmx-spinner' })]));

    let colors = {};
    try {
      colors = await ctx.api.customColors();
    } catch { /* colors are cosmetic */ }

    const colorFor = (item) => colors[`course_${item.courseId}`]
      || colorFromString(item.contextName || item.courseId || item.title);

    try {
      const items = await load(ctx, ctx.settings.todo.daysAhead);
      const groups = groupItems(items, { groupBy: ctx.settings.todo.groupBy });
      render(state.body, groups, ctx, colorFor);
    } catch (err) {
      state.body.textContent = '';
      const message = err?.isAuthError
        ? 'Canvas would not share your planner — try reloading after signing in again.'
        : 'Could not load your planner from Canvas.';
      state.body.append(el('div', { class: 'cmx-error', text: message }));
      console.warn('[CanvasMax] planner load failed', err);
    }
  }

  const state = {};

  features.push({
    id: 'todo',
    matches: (page) => page.type === 'dashboard' || page.type === 'course',

    async init(ctx) {
      if (!ctx.settings.todo.enabled) return;
      await run(ctx, state);
    },

    update(ctx) {
      if (!ctx.settings.todo.enabled) {
        state.panel?.remove();
        state.panel = null;
        return;
      }
      ctx.api.invalidate('planner:');
      run(ctx, state);
    },
  });

  // Exported for tests.
  CanvasMax.todo = { normalizeItem, groupItems, byDate, TYPE_LABEL };
})(typeof globalThis !== 'undefined' ? globalThis : self);
