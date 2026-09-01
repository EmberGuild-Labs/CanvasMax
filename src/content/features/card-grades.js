/**
 * Feature: grades on dashboard cards.
 *
 * Canvas already computes each enrollment's current score, so the fast path is
 * a single /api/v1/courses call with `total_scores`. When a course hides the
 * total from students Canvas omits the score, and we fall back to computing it
 * from that course's assignment groups — which is exactly what the Grades page
 * would show if it were visible.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});
  const features = (CanvasMax.features = CanvasMax.features || []);
  const { qsa, el, observe, waitFor } = CanvasMax.util;

  const BADGE_CLASS = 'cmx-grade-badge';

  function formatBadge(percent, letter, mode) {
    const rounded = percent == null ? null : Math.round(percent * 100) / 100;
    const percentText = rounded == null ? null : `${rounded}%`;

    if (mode === 'percent') return { main: percentText, sub: null };
    if (mode === 'letter') return { main: letter, sub: null };
    return { main: percentText, sub: letter };
  }

  function renderBadge(card, { percent, letter, pending }, mode) {
    const host = card.querySelector('.ic-DashboardCard__header_content')
      || card.querySelector('[class*="header_content"]')
      || card.querySelector('.ic-DashboardCard__header');
    if (!host) return;

    let badge = host.querySelector(`.${BADGE_CLASS}`);
    if (!badge) {
      badge = el('span', { class: `${BADGE_CLASS} cmx-root` });
      host.append(badge);
    }

    if (pending) {
      badge.textContent = '';
      badge.classList.remove('cmx-grade-badge--none');
      badge.append(el('span', { class: 'cmx-spinner', 'aria-label': 'Loading grade' }));
      return;
    }

    const { main, sub } = formatBadge(percent, letter, mode);

    if (!main && !sub) {
      badge.className = `${BADGE_CLASS} ${BADGE_CLASS}--none cmx-root`;
      badge.textContent = 'No grade yet';
      badge.title = 'Canvas has not posted a total score for this course';
      return;
    }

    badge.className = `${BADGE_CLASS} cmx-root`;
    badge.textContent = '';
    badge.append(el('span', { text: main || sub }));
    if (main && sub) badge.append(el('span', { class: `${BADGE_CLASS}__letter`, text: sub }));
    badge.title = `Current grade in this course${percent == null ? '' : `: ${percent.toFixed(2)}%`}`;
  }

  /**
   * Build courseId -> { percent, letter } from the cheap list endpoint,
   * filling gaps from assignment groups only where needed.
   */
  async function loadGrades(ctx) {
    const { grades } = CanvasMax;
    const courses = await ctx.api.courses();
    const map = new Map();
    const needsFallback = [];

    for (const course of courses) {
      const id = String(course.id);
      const percent = grades.percentFromCourse(course);
      const letter = grades.letterFromCourse(course);
      if (percent == null && letter == null) needsFallback.push(id);
      map.set(id, { percent, letter });
    }

    // Compute the stragglers, but cap the fan-out: a student with 30 hidden
    // courses should not fire 30 parallel multi-page requests.
    const budget = needsFallback.slice(0, 8);
    await Promise.all(budget.map(async (courseId) => {
      try {
        const groups = await ctx.api.assignmentGroups(courseId);
        const result = grades.computeCourseGrade(groups);
        if (result.percent != null) {
          map.set(courseId, {
            percent: result.percent,
            letter: grades.letterForPercent(result.percent),
            computed: true,
          });
        }
      } catch (err) {
        if (ctx.settings.debug) console.warn('[CanvasMax] grade fallback failed', courseId, err);
      }
    }));

    return map;
  }

  async function run(ctx) {
    const mode = ctx.settings.dashboard.gradeDisplay || 'both';

    // Paint spinners first so the cards don't jump when data lands.
    for (const card of qsa('.ic-DashboardCard')) {
      renderBadge(card, { pending: true }, mode);
    }

    let map;
    try {
      map = await loadGrades(ctx);
    } catch (err) {
      console.warn('[CanvasMax] could not load grades', err);
      for (const card of qsa('.ic-DashboardCard')) {
        const badge = card.querySelector(`.${BADGE_CLASS}`);
        if (badge) badge.remove();
      }
      return;
    }

    const paint = () => {
      for (const card of qsa('.ic-DashboardCard')) {
        const courseId = card.dataset.cmxCourseId
          || (/\/courses\/(\d+)/.exec(card.querySelector('a[href*="/courses/"]')?.getAttribute('href') || '') || [])[1];
        if (!courseId) continue;
        renderBadge(card, map.get(String(courseId)) || {}, mode);
      }
    };

    paint();
    observe(document.querySelector('.ic-DashboardCard__box') || document.body, paint);
  }

  function removeAll() {
    for (const badge of qsa(`.${BADGE_CLASS}`)) badge.remove();
  }

  features.push({
    id: 'card-grades',
    matches: (page) => page.type === 'dashboard',

    async init(ctx) {
      if (!ctx.settings.dashboard.enabled || !ctx.settings.dashboard.showGrades) return;
      await waitFor('.ic-DashboardCard', { timeout: 15000 });
      await run(ctx);
    },

    update(ctx) {
      if (!ctx.settings.dashboard.enabled || !ctx.settings.dashboard.showGrades) {
        removeAll();
        return;
      }
      ctx.api.invalidate('courses');
      run(ctx);
    },
  });

  CanvasMax.cardGrades = { formatBadge };
})(typeof globalThis !== 'undefined' ? globalThis : self);
