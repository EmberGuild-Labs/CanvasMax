/**
 * Feature: what-if grade calculator.
 *
 * Lives on a course's Grades page. Shows the weighted breakdown Canvas hides,
 * lets the user type hypothetical scores and see the course grade move, and
 * answers the question everyone actually has: "what do I need on the final?"
 *
 * Nothing is written back to Canvas — hypotheticals stay in the page.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});
  const features = (CanvasMax.features = CanvasMax.features || []);
  const { qs, el, waitFor, debounce } = CanvasMax.util;

  const PANEL_ID = 'cmx-whatif-panel';

  function scoreCell(assignment, state, rerender) {
    const id = String(assignment.id);
    const possible = Number(assignment.points_possible) || 0;
    const submission = assignment.submission;
    const actual = submission && submission.score != null ? Number(submission.score) : null;

    const input = el('input', {
      type: 'number',
      class: 'cmx-input cmx-input--score',
      step: 'any',
      min: '0',
      placeholder: actual != null ? String(actual) : '—',
      value: Object.prototype.hasOwnProperty.call(state.overrides, id) ? state.overrides[id] : '',
      'aria-label': `Hypothetical score for ${assignment.name}`,
    });

    const onInput = debounce(() => {
      const raw = input.value.trim();
      if (raw === '') delete state.overrides[id];
      else state.overrides[id] = Number(raw);
      rerender();
    }, 250);

    input.addEventListener('input', onInput);

    return el('td', { class: 'cmx-whatif__num' }, [
      input,
      el('span', { text: ` / ${possible}`, style: { color: 'var(--cmx-ui-muted)', fontSize: '12px' } }),
    ]);
  }

  function buildTable(groups, state, rerender) {
    const { grades } = CanvasMax;
    const table = el('table', { class: 'cmx-whatif' });

    table.append(el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Assignment' }),
        el('th', { class: 'cmx-whatif__num', text: 'Score' }),
        el('th', { class: 'cmx-whatif__num', text: 'Needed' }),
      ]),
    ]));

    const body = el('tbody');
    const result = grades.computeCourseGrade(groups, { overrides: state.overrides });
    const groupById = new Map(result.groups.map((g) => [g.id, g]));

    for (const group of groups) {
      const stats = groupById.get(String(group.id));
      const groupLabel = result.weighted && stats?.weight
        ? `${group.name} · ${stats.weight}%`
        : group.name;
      const groupScore = stats && stats.possible > 0
        ? `${grades.formatPercent(stats.percent, 1)} (${round(stats.earned)}/${round(stats.possible)})`
        : '—';

      body.append(el('tr', { class: 'cmx-whatif__group' }, [
        el('td', { text: groupLabel }),
        el('td', { class: 'cmx-whatif__num', text: groupScore }),
        el('td', {}),
      ]));

      for (const assignment of group.assignments || []) {
        if (!grades.isCountable(assignment)) continue;
        const id = String(assignment.id);
        const hypothetical = Object.prototype.hasOwnProperty.call(state.overrides, id);

        let neededText = '';
        if (state.target != null) {
          const needed = grades.pointsNeededFor(groups, id, state.target, {
            overrides: omit(state.overrides, id),
          });
          if (needed) {
            if (needed.alreadyThere) neededText = 'already there';
            else if (!needed.achievable) neededText = 'not reachable';
            else neededText = `${round(needed.points)} pts`;
          }
        }

        body.append(el('tr', { class: `cmx-whatif__row${hypothetical ? ' is-hypothetical' : ''}` }, [
          el('td', { text: assignment.name, title: assignment.name }),
          scoreCell(assignment, state, rerender),
          el('td', { class: 'cmx-whatif__num', text: neededText, style: { color: 'var(--cmx-ui-muted)', fontSize: '12px' } }),
        ]));
      }
    }

    table.append(body);
    return { table, result };
  }

  const round = (n) => Math.round(n * 100) / 100;

  function omit(object, key) {
    const copy = { ...object };
    delete copy[key];
    return copy;
  }

  async function run(ctx, state) {
    const { grades } = CanvasMax;
    const courseId = ctx.page.courseId;
    if (!courseId) return;

    const host = qs('#content') || await waitFor('#content', { timeout: 8000 });
    if (!host) return;

    const tableHost = el('div', { style: { maxHeight: '460px', overflowY: 'auto' } });
    const resultValue = el('span', { class: 'cmx-result__value', text: '—' });
    const resultDelta = el('span', { class: 'cmx-result__delta' });
    const resultLabel = el('span', { style: { color: 'var(--cmx-ui-muted)', fontSize: '13px' } });

    const targetInput = el('input', {
      type: 'number',
      class: 'cmx-input',
      style: { width: '76px' },
      min: '0',
      max: '150',
      step: 'any',
      placeholder: '90',
      'aria-label': 'Target course percentage',
    });

    const resetButton = el('button', {
      class: 'cmx-btn cmx-btn--ghost',
      text: 'Reset',
      on: {
        click: () => {
          state.overrides = {};
          rerender();
        },
      },
    });

    const panel = el('div', { id: PANEL_ID, class: 'cmx-panel cmx-root' }, [
      el('div', { class: 'cmx-panel__header' }, [
        el('h2', { class: 'cmx-panel__title', text: 'What-if calculator' }),
        el('div', { class: 'cmx-panel__actions' }, [
          el('label', {
            style: { fontSize: '12px', color: 'var(--cmx-ui-muted)', marginRight: '4px' },
            text: 'Target %',
            for: 'cmx-target-input',
          }),
          targetInput,
          resetButton,
        ]),
      ]),
      el('div', { class: 'cmx-panel__body' }, [tableHost]),
      el('div', { class: 'cmx-result' }, [
        el('span', {}, [resultValue, ' ', resultDelta]),
        resultLabel,
      ]),
    ]);

    targetInput.id = 'cmx-target-input';
    targetInput.addEventListener('input', debounce(() => {
      const raw = targetInput.value.trim();
      state.target = raw === '' ? null : Number(raw);
      rerender();
    }, 250));

    state.panel?.remove();
    state.panel = panel;
    host.insertAdjacentElement('afterbegin', panel);

    tableHost.append(el('div', { class: 'cmx-empty' }, [el('span', { class: 'cmx-spinner' })]));

    let groups = [];
    try {
      groups = await ctx.api.assignmentGroups(courseId);
    } catch (err) {
      tableHost.textContent = '';
      tableHost.append(el('div', {
        class: 'cmx-error',
        text: 'Could not load this course’s assignment groups.',
      }));
      console.warn('[CanvasMax] what-if load failed', err);
      return;
    }

    // The baseline is the real grade, with no hypotheticals applied.
    const baseline = grades.computeCourseGrade(groups).percent;

    function rerender() {
      const { table, result } = buildTable(groups, state, rerender);
      tableHost.textContent = '';
      tableHost.append(table);

      const percent = result.percent;
      resultValue.textContent = percent == null ? '—' : grades.formatPercent(percent, 2);

      const letter = percent == null ? null : grades.letterForPercent(percent);
      resultLabel.textContent = [
        letter ? `Letter ${letter}` : null,
        result.weighted ? 'weighted' : 'points-based',
      ].filter(Boolean).join(' · ');

      const changed = Object.keys(state.overrides).length > 0;
      if (changed && percent != null && baseline != null) {
        const delta = percent - baseline;
        resultDelta.textContent = `${delta >= 0 ? '+' : ''}${round(delta)}`;
        resultDelta.className = `cmx-result__delta ${delta >= 0 ? 'is-up' : 'is-down'}`;
      } else {
        resultDelta.textContent = '';
        resultDelta.className = 'cmx-result__delta';
      }
    }

    rerender();
  }

  const state = { overrides: {}, target: null };

  features.push({
    id: 'grade-calculator',
    matches: (page) => page.type === 'grades' && Boolean(page.courseId),

    async init(ctx) {
      if (!ctx.settings.whatIf.enabled) return;
      await run(ctx, state);
    },

    update(ctx) {
      if (!ctx.settings.whatIf.enabled) {
        state.panel?.remove();
        state.panel = null;
        return;
      }
      run(ctx, state);
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
