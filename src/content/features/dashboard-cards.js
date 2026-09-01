/**
 * Feature: dashboard card customisation.
 *
 * Recolors, re-images, reorders, hides and extends Canvas's dashboard cards.
 * Canvas re-renders the dashboard client-side (React), so everything here is
 * idempotent and driven by a MutationObserver rather than run once.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});
  const features = (CanvasMax.features = CanvasMax.features || []);
  const { qs, qsa, el, observe, colorFromString, readableTextOn, waitFor } = CanvasMax.util;

  const MARK = 'cmxCard'; // dataset flag so we never double-decorate

  /** Every link CanvasMax can add under a card, in menu order. */
  const LINK_DEFS = Object.freeze({
    assignments: { label: 'Assignments', path: 'assignments' },
    grades: { label: 'Grades', path: 'grades' },
    announcements: { label: 'Announcements', path: 'announcements' },
    discussions: { label: 'Discussions', path: 'discussion_topics' },
    modules: { label: 'Modules', path: 'modules' },
    files: { label: 'Files', path: 'files' },
    syllabus: { label: 'Syllabus', path: 'assignments/syllabus' },
    people: { label: 'People', path: 'users' },
    quizzes: { label: 'Quizzes', path: 'quizzes' },
    pages: { label: 'Pages', path: 'pages' },
  });

  function cardCourseId(card) {
    const link = card.querySelector('a[href*="/courses/"]');
    const match = link && /\/courses\/(\d+)/.exec(link.getAttribute('href') || '');
    return match ? match[1] : null;
  }

  function cardTitle(card) {
    const node = card.querySelector('.ic-DashboardCard__header-title, [class*="header-title"]');
    return node ? node.textContent.trim() : '';
  }

  /** The container Canvas lays the cards out in. */
  function cardGrid() {
    return qs('.ic-DashboardCard__box .ic-DashboardCard__box__container')
      || qs('.ic-DashboardCard__box')
      || qs('[class*="DashboardCard"][class*="box"]')
      || (qs('.ic-DashboardCard') || {}).parentElement
      || null;
  }

  function resolveColor(courseId, title, settings, canvasColors) {
    const override = settings.dashboard.colorOverrides?.[courseId];
    if (override) return override;
    const fromCanvas = canvasColors?.[`course_${courseId}`];
    if (fromCanvas) return fromCanvas;
    return colorFromString(title || courseId);
  }

  function decorate(card, ctx, canvasColors) {
    const { settings } = ctx;
    const courseId = cardCourseId(card);
    if (!courseId) return;

    card.dataset.cmxCourseId = courseId;

    // ------------------------------------------------------------- hide --
    const hidden = (settings.dashboard.hiddenCourses || []).map(String);
    if (hidden.includes(String(courseId))) {
      card.style.display = 'none';
      card.dataset[MARK] = 'hidden';
      return;
    }
    if (card.dataset[MARK] === 'hidden') card.style.display = '';

    // ------------------------------------------------------------ color --
    const color = resolveColor(courseId, cardTitle(card), settings, canvasColors);
    card.style.setProperty('--cmx-card-color', color);

    const hero = card.querySelector('.ic-DashboardCard__header_hero, [class*="header_hero"]');
    if (hero) {
      hero.style.setProperty('background-color', color, 'important');
      // The hero holds the card's action icons; keep them legible on any hue.
      hero.style.setProperty('color', readableTextOn(color), 'important');
    }

    // ------------------------------------------------------------ image --
    const imageUrl = settings.dashboard.imageOverrides?.[courseId];
    const imageNode = card.querySelector('.ic-DashboardCard__header_image, [class*="header_image"]');
    if (imageNode && imageUrl && settings.dashboard.showCardImages) {
      // Only http(s) — a data: or javascript: URL here would be a needless risk.
      if (/^https?:\/\//i.test(imageUrl)) {
        imageNode.style.setProperty('background-image', `url("${CSS.escape(imageUrl).replace(/\\/g, '')}")`, 'important');
        imageNode.style.setProperty('background-size', 'cover', 'important');
        imageNode.style.setProperty('background-position', 'center', 'important');
      }
    }

    // -------------------------------------------------------- nicknames --
    const nickname = settings.dashboard.nicknames?.[courseId];
    const titleNode = card.querySelector('.ic-DashboardCard__header-title span, .ic-DashboardCard__header-title');
    if (nickname && titleNode && titleNode.textContent.trim() !== nickname) {
      titleNode.textContent = nickname;
    }

    // ------------------------------------------------------------ links --
    renderLinks(card, courseId, ctx);

    card.dataset[MARK] = 'done';
  }

  function renderLinks(card, courseId, ctx) {
    const wanted = ctx.settings.dashboard.cardLinks || [];
    const existing = card.querySelector('.cmx-card-actions');

    if (!wanted.length) {
      existing?.remove();
      return;
    }

    const signature = wanted.join(',');
    if (existing && existing.dataset.cmxSignature === signature) return;
    existing?.remove();

    const origin = ctx.api.origin;
    const nav = el('div', {
      class: 'cmx-card-actions cmx-root',
      dataset: { cmxSignature: signature },
    });

    for (const key of wanted) {
      const def = LINK_DEFS[key];
      if (!def) continue;
      nav.append(el('a', {
        href: `${origin}/courses/${courseId}/${def.path}`,
        text: def.label,
        title: `${def.label} for this course`,
      }));
    }

    if (!nav.childElementCount) return;
    card.append(nav);
  }

  /**
   * Reorder cards to match the user's saved order. Cards not in the list keep
   * their Canvas order and sort after the explicitly-ordered ones.
   */
  function applyOrder(ctx) {
    const order = (ctx.settings.dashboard.cardOrder || []).map(String);
    if (!order.length) return;

    const grid = cardGrid();
    if (!grid) return;

    const cards = qsa('.ic-DashboardCard', grid);
    if (cards.length < 2) return;

    const rank = new Map(order.map((id, index) => [id, index]));
    const sorted = [...cards].sort((a, b) => {
      const ra = rank.has(a.dataset.cmxCourseId) ? rank.get(a.dataset.cmxCourseId) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.dataset.cmxCourseId) ? rank.get(b.dataset.cmxCourseId) : Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });

    // Only touch the DOM when the order actually differs, so we don't fight
    // React's reconciler on every mutation.
    const changed = sorted.some((card, index) => cards[index] !== card);
    if (!changed) return;

    const parent = sorted[0].parentElement;
    if (!parent) return;
    for (const card of sorted) parent.append(card);
  }

  async function run(ctx) {
    let canvasColors = {};
    try {
      canvasColors = await ctx.api.customColors();
    } catch (err) {
      if (ctx.settings.debug) console.warn('[CanvasMax] could not read Canvas card colors', err);
    }

    const paint = () => {
      for (const card of qsa('.ic-DashboardCard')) decorate(card, ctx, canvasColors);
      applyOrder(ctx);
    };

    const grid = cardGrid();
    observe(grid || document.body, paint);
  }

  features.push({
    id: 'dashboard-cards',
    matches: (page) => page.type === 'dashboard',

    async init(ctx) {
      if (!ctx.settings.dashboard.enabled) return;
      // The dashboard renders after the shell; wait for the first card.
      await waitFor('.ic-DashboardCard', { timeout: 15000 });
      await run(ctx);
    },

    update(ctx) {
      if (!ctx.settings.dashboard.enabled) return;
      for (const card of qsa('.ic-DashboardCard')) delete card.dataset[MARK];
      run(ctx);
    },

    LINK_DEFS,
  });

  CanvasMax.dashboardCards = { LINK_DEFS, cardCourseId };
})(typeof globalThis !== 'undefined' ? globalThis : self);
