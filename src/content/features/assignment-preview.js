/**
 * Feature: inline assignment and announcement preview.
 *
 * Alt/Option-click (or the preview affordance in CanvasMax's own lists) opens
 * the item's description in a modal instead of navigating away. Saves a page
 * load when you just want to check what a thing actually asks for.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});
  const features = (CanvasMax.features = CanvasMax.features || []);
  const { el, formatDueDate, stripHtml } = CanvasMax.util;

  let openModal = null;

  function close() {
    openModal?.remove();
    openModal = null;
    document.removeEventListener('keydown', onKeydown, true);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  }

  /**
   * Render Canvas-authored HTML into the modal.
   *
   * Canvas descriptions are already sanitised server-side, but this is
   * third-party content rendered in the page's own origin, so it goes through
   * a template + explicit script/style strip rather than straight innerHTML.
   */
  function renderDescription(html) {
    const container = el('div', { class: 'cmx-modal__body user_content' });
    const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');

    for (const node of parsed.querySelectorAll('script, style, iframe, object, embed, link, meta')) {
      node.remove();
    }
    for (const node of parsed.querySelectorAll('*')) {
      for (const attr of [...node.attributes]) {
        // Drop inline event handlers and javascript: URLs.
        if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
        if ((attr.name === 'href' || attr.name === 'src')
          && /^\s*javascript:/i.test(attr.value)) {
          node.removeAttribute(attr.name);
        }
      }
    }

    container.append(...parsed.body.childNodes);
    if (!container.textContent.trim() && !container.querySelector('img')) {
      container.textContent = '';
      container.append(el('div', { class: 'cmx-empty', text: 'This item has no description.' }));
    }
    return container;
  }

  function showModal({ title, meta, html, url }) {
    close();

    const dialog = el('div', {
      class: 'cmx-modal__dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
    }, [
      el('div', { class: 'cmx-modal__header' }, [
        el('div', { style: { flex: '1 1 auto', minWidth: '0' } }, [
          el('h2', { class: 'cmx-modal__title', text: title }),
          meta ? el('div', { class: 'cmx-modal__meta', text: meta }) : null,
        ]),
        el('button', {
          class: 'cmx-btn cmx-btn--ghost cmx-btn--icon',
          'aria-label': 'Close preview',
          html: '<svg viewBox="0 0 20 20"><path d="M15 5.7 14.3 5 10 9.3 5.7 5 5 5.7 9.3 10 5 14.3l.7.7 4.3-4.3 4.3 4.3.7-.7L10.7 10z"/></svg>',
          on: { click: close },
        }),
      ]),
      renderDescription(html),
      el('div', { class: 'cmx-modal__footer' }, [
        url ? el('a', { class: 'cmx-btn', href: url, text: 'Open in Canvas' }) : null,
        el('button', { class: 'cmx-btn cmx-btn--primary', text: 'Close', on: { click: close } }),
      ]),
    ]);

    const backdrop = el('div', {
      class: 'cmx-modal cmx-root',
      on: {
        click: (event) => { if (event.target === backdrop) close(); },
      },
    }, [dialog]);

    document.body.append(backdrop);
    openModal = backdrop;
    document.addEventListener('keydown', onKeydown, true);
    dialog.querySelector('button')?.focus();
  }

  function showLoading(title) {
    showModal({ title, meta: 'Loading…', html: '' });
  }

  /** Pull /courses/:cid/assignments/:aid out of an href. */
  function parseAssignmentUrl(href) {
    const match = /\/courses\/(\d+)\/assignments\/(\d+)/.exec(href || '');
    return match ? { courseId: match[1], assignmentId: match[2] } : null;
  }

  async function previewFromLink(ctx, href) {
    const target = parseAssignmentUrl(href);
    if (!target) return false;

    showLoading('Loading assignment…');
    try {
      const assignment = await ctx.api.assignment(target.courseId, target.assignmentId);
      const metaParts = [
        formatDueDate(assignment.due_at),
        assignment.points_possible != null ? `${assignment.points_possible} points` : null,
        assignment.submission?.score != null
          ? `Scored ${assignment.submission.score}/${assignment.points_possible}`
          : null,
      ].filter(Boolean);

      showModal({
        title: assignment.name || 'Assignment',
        meta: metaParts.join(' · '),
        html: assignment.description,
        url: `${ctx.api.origin}/courses/${target.courseId}/assignments/${target.assignmentId}`,
      });
    } catch (err) {
      showModal({
        title: 'Could not load that assignment',
        meta: err?.isAuthError ? 'Canvas refused the request.' : 'Something went wrong.',
        html: '',
        url: `${ctx.api.origin}${href}`,
      });
      console.warn('[CanvasMax] preview failed', err);
    }
    return true;
  }

  features.push({
    id: 'assignment-preview',
    matches: () => true,

    init(ctx) {
      if (!ctx.settings.preview.enabled) return;

      document.addEventListener('click', (event) => {
        // Alt-click is the opt-in gesture: ordinary clicks keep working.
        if (!event.altKey || event.button !== 0) return;
        const link = event.target.closest?.('a[href*="/assignments/"]');
        if (!link) return;

        const href = link.getAttribute('href') || '';
        if (!parseAssignmentUrl(href)) return;

        event.preventDefault();
        event.stopPropagation();
        previewFromLink(ctx, href);
      }, true);
    },
  });

  CanvasMax.preview = { showModal, close, parseAssignmentUrl, renderDescription, stripHtml };
})(typeof globalThis !== 'undefined' ? globalThis : self);
