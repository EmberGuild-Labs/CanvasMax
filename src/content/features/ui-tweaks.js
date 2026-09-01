/**
 * Feature: interface tweaks.
 *
 * The purely-cosmetic toggles. Anything expressible in CSS is handled by a
 * root class in theme.css; this module covers the ones that need to identify
 * specific elements at runtime.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});
  const features = (CanvasMax.features = CanvasMax.features || []);
  const { qsa, observe } = CanvasMax.util;

  /** Global-nav entries a user can hide, keyed by the id Canvas gives them. */
  const NAV_ITEMS = Object.freeze({
    global_nav_courses_link: 'Courses',
    global_nav_dashboard_link: 'Dashboard',
    global_nav_calendar_link: 'Calendar',
    global_nav_conversations_link: 'Inbox',
    global_nav_groups_link: 'Groups',
    global_nav_accounts_link: 'Admin',
    global_nav_help_link: 'Help',
    global_nav_history_link: 'History',
  });

  function applyNavHiding(settings) {
    const hidden = new Set(settings.tweaks.hiddenNavItems || []);
    for (const id of Object.keys(NAV_ITEMS)) {
      const link = document.getElementById(id);
      const item = link?.closest('li') || link;
      if (!item) continue;
      item.classList.toggle('cmx-nav-hidden', hidden.has(id));
    }
  }

  /**
   * Expand every collapsed module on a Modules page.
   * Canvas stores collapse state server-side, so we click its own toggles
   * rather than forcing display, keeping the page's own state consistent.
   */
  function expandModules() {
    for (const header of qsa('.context_module .collapse_module_link')) {
      const module = header.closest('.context_module');
      const content = module?.querySelector('.content');
      if (content && content.style.display === 'none') header.click();
    }
    for (const expand of qsa('.context_module .expand_module_link')) {
      const module = expand.closest('.context_module');
      const content = module?.querySelector('.content');
      if (content && getComputedStyle(content).display === 'none') expand.click();
    }
  }

  features.push({
    id: 'ui-tweaks',
    matches: () => true,

    init(ctx) {
      applyNavHiding(ctx.settings);
      // The global nav mounts asynchronously on some Canvas releases.
      const header = document.getElementById('header');
      if (header) observe(header, () => applyNavHiding(ctx.settings));

      if (ctx.settings.tweaks.autoExpandModules && ctx.page.type === 'modules') {
        // One pass after the modules list settles.
        setTimeout(expandModules, 600);
      }
    },

    update(ctx) {
      applyNavHiding(ctx.settings);
    },

    NAV_ITEMS,
  });

  CanvasMax.uiTweaks = { NAV_ITEMS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
