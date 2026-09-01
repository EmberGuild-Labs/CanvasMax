/**
 * Feature: GPA panel.
 *
 * Pulls every active course's current grade, lets the user set credit hours
 * (and course rigor on the weighted high-school scale), and computes a GPA.
 * Credits are saved per course id, so this is a one-time setup per term.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});
  const features = (CanvasMax.features = CanvasMax.features || []);
  const { qs, el, waitFor, debounce } = CanvasMax.util;

  const PANEL_ID = 'cmx-gpa-panel';

  /** Build the course list the GPA math consumes. */
  function toGpaCourses(courses, settings) {
    const { grades } = CanvasMax;
    return courses.map((course) => {
      const id = String(course.id);
      return {
        id,
        name: settings.dashboard.nicknames?.[id] || course.name || `Course ${id}`,
        percent: grades.percentFromCourse(course),
        letter: grades.letterFromCourse(course),
        credits: Number(settings.gpa.credits?.[id]) || null,
        rigor: settings.gpa.courseWeights?.[id] || 'regular',
      };
    });
  }

  function renderRows(container, gpaCourses, ctx, rerender) {
    container.textContent = '';
    const weighted = ctx.settings.gpa.scale === 'hs-weighted';

    for (const course of gpaCourses) {
      const gradeText = course.letter
        ? `${course.letter}${course.percent != null ? ` · ${Math.round(course.percent)}%` : ''}`
        : '—';

      const creditsInput = el('input', {
        type: 'number',
        class: 'cmx-input',
        min: '0',
        max: '12',
        step: '0.5',
        value: course.credits ?? '',
        placeholder: '1',
        'aria-label': `Credit hours for ${course.name}`,
        style: { width: '52px', padding: '2px 4px', fontSize: '12px' },
      });

      const persist = debounce(async () => {
        const value = creditsInput.value === '' ? null : Number(creditsInput.value);
        await CanvasMax.storage.saveSettings({ gpa: { credits: { [course.id]: value } } });
        ctx.settings.gpa.credits[course.id] = value;
        rerender();
      }, 400);
      creditsInput.addEventListener('input', persist);

      const rigorSelect = weighted
        ? el('select', {
          class: 'cmx-select',
          style: { width: 'auto', padding: '2px 4px', fontSize: '11px' },
          'aria-label': `Course rigor for ${course.name}`,
          on: {
            change: async (event) => {
              const value = event.target.value;
              await CanvasMax.storage.saveSettings({ gpa: { courseWeights: { [course.id]: value } } });
              ctx.settings.gpa.courseWeights[course.id] = value;
              rerender();
            },
          },
        }, [
          ['regular', 'Regular'], ['honors', 'Honors'], ['ap', 'AP'], ['ib', 'IB'],
          ['dual-enrollment', 'DE'],
        ].map(([value, label]) => el('option', {
          value, text: label, ...(course.rigor === value ? { selected: true } : {}),
        })))
        : null;

      container.append(el('div', { class: 'cmx-gpa-row' }, [
        el('span', { class: 'cmx-gpa-row__name', text: course.name, title: course.name }),
        el('span', { class: 'cmx-gpa-row__grade', text: gradeText }),
        el('span', { style: { display: 'flex', gap: '4px' } }, [rigorSelect, creditsInput]),
      ]));
    }
  }

  async function run(ctx, state) {
    const host = qs('#right-side') || await waitFor('#right-side', { timeout: 6000 });
    if (!host) return;

    const { gpa: gpaLib } = CanvasMax;

    const summaryValue = el('span', { class: 'cmx-gpa__value', text: '—' });
    const summaryScale = el('span', { class: 'cmx-gpa__scale' });
    const rows = el('div');
    const footnote = el('div', {
      class: 'cmx-note__status',
      style: { padding: '4px 14px 10px' },
    });

    const scaleSelect = el('select', {
      class: 'cmx-select',
      style: { width: 'auto', fontSize: '11px', padding: '2px 4px' },
      'aria-label': 'GPA scale',
      on: {
        change: async (event) => {
          await CanvasMax.storage.saveSettings({ gpa: { scale: event.target.value } });
          ctx.settings.gpa.scale = event.target.value;
          recompute();
        },
      },
    }, Object.entries(gpaLib.SCALES).map(([key, scale]) => el('option', {
      value: key,
      text: scale.label,
      ...(ctx.settings.gpa.scale === key ? { selected: true } : {}),
    })));

    let courses = [];

    function recompute() {
      const gpaCourses = toGpaCourses(courses, ctx.settings);
      const result = gpaLib.computeGPA(gpaCourses, { scale: ctx.settings.gpa.scale });

      summaryValue.textContent = gpaLib.formatGpa(result.gpa) ?? '—';
      summaryScale.textContent = `/ ${result.scale.max.toFixed(1)} · ${result.totalCredits} credits`;
      footnote.textContent = result.skipped.length
        ? `${result.skipped.length} course${result.skipped.length === 1 ? '' : 's'} skipped (no grade posted yet).`
        : '';

      renderRows(rows, gpaCourses, ctx, recompute);
    }

    const panel = el('div', { id: PANEL_ID, class: 'cmx-panel cmx-root' }, [
      el('div', { class: 'cmx-panel__header' }, [
        el('h2', { class: 'cmx-panel__title', text: 'GPA' }),
        el('div', { class: 'cmx-panel__actions' }, [scaleSelect]),
      ]),
      el('div', { class: 'cmx-panel__body' }, [
        el('div', { class: 'cmx-gpa__summary', style: { padding: '0 14px' } }, [summaryValue, summaryScale]),
        rows,
        footnote,
      ]),
    ]);

    state.panel?.remove();
    state.panel = panel;
    const anchor = qs('#cmx-notes-panel') || qs('#cmx-planner-panel');
    if (anchor) anchor.insertAdjacentElement('afterend', panel);
    else host.insertAdjacentElement('beforeend', panel);

    try {
      courses = await ctx.api.courses();
      recompute();
    } catch (err) {
      rows.append(el('div', { class: 'cmx-error', text: 'Could not load your courses from Canvas.' }));
      console.warn('[CanvasMax] GPA panel failed', err);
    }
  }

  const state = {};

  features.push({
    id: 'gpa-panel',
    matches: (page) => page.type === 'dashboard',

    async init(ctx) {
      if (!ctx.settings.gpa.enabled) return;
      await run(ctx, state);
    },

    update(ctx) {
      if (!ctx.settings.gpa.enabled) {
        state.panel?.remove();
        state.panel = null;
        return;
      }
      run(ctx, state);
    },
  });

  CanvasMax.gpaPanel = { toGpaCourses };
})(typeof globalThis !== 'undefined' ? globalThis : self);
