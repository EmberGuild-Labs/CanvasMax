/**
 * CanvasMax — Canvas LMS REST client.
 *
 * The whole extension rests on one fact: a signed-in Canvas user can already
 * call `/api/v1/*` from their own browser session. Sending the request with
 * `credentials: "same-origin"` reuses the session cookie, so CanvasMax needs
 * no OAuth app, no developer key, no API token and no server of its own —
 * which is why every feature here can be free. Data never leaves the browser.
 *
 * Two Canvas-specific details matter:
 *   - `Accept: application/json+canvas-string-ids` makes Canvas return IDs as
 *     strings. Canvas IDs can exceed Number.MAX_SAFE_INTEGER; without this
 *     header they silently round.
 *   - Canvas prefixes JSON bodies with `while(1);` as an anti-hijacking guard,
 *     so responses must be de-prefixed before parsing.
 */
(function (root) {
  'use strict';

  const CanvasMax = (root.CanvasMax = root.CanvasMax || {});

  const JSON_PREFIX = /^while\(1\);/;
  const DEFAULT_PER_PAGE = 100;
  const MAX_PAGES = 25; // hard stop so a pathological account can't spin forever

  // -------------------------------------------------------- pure helpers ----

  /**
   * Parse an RFC 5988 `Link` header into { rel: url }.
   * Canvas paginates everything, and `rel="next"` is the only reliable way to
   * walk it — `page=N+1` breaks on bookmarked pagination.
   */
  function parseLinkHeader(header) {
    const out = {};
    if (!header) return out;
    for (const part of String(header).split(',')) {
      const match = /<([^>]+)>\s*;\s*rel="?([^";]+)"?/.exec(part.trim());
      if (match) out[match[2]] = match[1];
    }
    return out;
  }

  /** Read a cookie value from document.cookie, URL-decoded. */
  function readCookie(name, cookieString) {
    const source = cookieString ?? (typeof document !== 'undefined' ? document.cookie : '');
    for (const chunk of String(source).split(';')) {
      const idx = chunk.indexOf('=');
      if (idx === -1) continue;
      if (chunk.slice(0, idx).trim() === name) {
        return decodeURIComponent(chunk.slice(idx + 1).trim());
      }
    }
    return null;
  }

  /** Build a query string, expanding arrays into Canvas's `key[]=` form. */
  function buildQuery(params = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const item of value) search.append(`${key}[]`, String(item));
      } else {
        search.append(key, String(value));
      }
    }
    const str = search.toString();
    return str ? `?${str}` : '';
  }

  /** Strip Canvas's anti-JSON-hijacking prefix and parse. */
  function parseBody(text) {
    const cleaned = String(text ?? '').replace(JSON_PREFIX, '').trim();
    if (!cleaned) return null;
    return JSON.parse(cleaned);
  }

  /**
   * Heuristic: does this page look like Canvas?
   * Canvas ships a `csrf-param` meta tag and mounts under `#application`, and
   * every install exposes `/api/v1`. We check the cheap DOM signals first so a
   * non-Canvas page costs nothing.
   */
  function looksLikeCanvas(doc = typeof document !== 'undefined' ? document : null) {
    if (!doc) return false;
    if (doc.querySelector('meta[name="csrf-param"]')) return true;
    if (doc.querySelector('#application.ic-app, body.ic-app')) return true;
    if (doc.querySelector('link[href*="/dist/brandable_css"]')) return true;
    return false;
  }

  // ------------------------------------------------------------- errors ----

  class CanvasApiError extends Error {
    constructor(message, { status = 0, url = '' } = {}) {
      super(message);
      this.name = 'CanvasApiError';
      this.status = status;
      this.url = url;
    }
    /** True when the user simply is not signed in / lacks access. */
    get isAuthError() {
      return this.status === 401 || this.status === 403;
    }
  }

  // -------------------------------------------------------------- client ----

  class CanvasApi {
    /**
     * @param {string} origin e.g. "https://canvas.university.edu". Defaults to
     *   the current page's origin, which is what content scripts want.
     */
    constructor(origin) {
      this.origin = (origin || (typeof location !== 'undefined' ? location.origin : '')).replace(/\/$/, '');
      this.cache = new Map(); // in-memory, per page load
      this.inflight = new Map(); // de-duplicates concurrent identical GETs
    }

    get csrfToken() {
      return readCookie('_csrf_token');
    }

    /**
     * Fetch a single API response. Returns { data, links, response }.
     */
    async request(path, { method = 'GET', params, body, signal } = {}) {
      const url = path.startsWith('http')
        ? path
        : `${this.origin}${path.startsWith('/') ? '' : '/'}${path}${buildQuery(params)}`;

      const headers = {
        Accept: 'application/json+canvas-string-ids, application/json',
        'X-Requested-With': 'XMLHttpRequest',
      };
      const init = { method, headers, credentials: 'same-origin', signal };

      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      if (method !== 'GET' && method !== 'HEAD') {
        const token = this.csrfToken;
        if (token) headers['X-CSRF-Token'] = token;
      }

      let response;
      try {
        response = await fetch(url, init);
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        throw new CanvasApiError(`Network error contacting Canvas: ${err.message}`, { url });
      }

      if (!response.ok) {
        throw new CanvasApiError(
          `Canvas returned ${response.status} for ${path}`,
          { status: response.status, url }
        );
      }

      const text = await response.text();
      let data;
      try {
        data = parseBody(text);
      } catch (err) {
        throw new CanvasApiError(`Could not parse Canvas response: ${err.message}`, { url });
      }

      return { data, links: parseLinkHeader(response.headers.get('Link')), response };
    }

    /**
     * Fetch every page of a list endpoint by following `rel="next"`.
     */
    async paginate(path, { params = {}, max = MAX_PAGES, signal } = {}) {
      const merged = { per_page: DEFAULT_PER_PAGE, ...params };
      let next = null;
      const all = [];
      for (let page = 0; page < max; page += 1) {
        const { data, links } = await this.request(next || path, {
          params: next ? undefined : merged,
          signal,
        });
        if (Array.isArray(data)) all.push(...data);
        else if (data) all.push(data);
        if (!links.next) break;
        next = links.next;
      }
      return all;
    }

    /**
     * Memoized GET. `ttl` of 0 disables caching. Concurrent callers for the
     * same key share one request rather than stampeding Canvas.
     */
    async cached(key, ttl, loader) {
      const now = Date.now();
      const hit = this.cache.get(key);
      if (hit && ttl > 0 && now - hit.time < ttl) return hit.value;

      if (this.inflight.has(key)) return this.inflight.get(key);

      const promise = (async () => {
        try {
          const value = await loader();
          this.cache.set(key, { time: Date.now(), value });
          return value;
        } finally {
          this.inflight.delete(key);
        }
      })();

      this.inflight.set(key, promise);
      return promise;
    }

    invalidate(prefix = '') {
      for (const key of [...this.cache.keys()]) {
        if (!prefix || key.startsWith(prefix)) this.cache.delete(key);
      }
    }

    // ---------------------------------------------------------- endpoints --

    /** The signed-in user's profile. */
    profile() {
      return this.cached('profile', 300000, async () =>
        (await this.request('/api/v1/users/self/profile')).data
      );
    }

    /**
     * Active courses with score data attached.
     * `total_scores` + `current_grading_period_scores` is what powers the
     * grade badge on dashboard cards and the GPA panel.
     */
    courses({ ttl = 120000 } = {}) {
      return this.cached('courses', ttl, () =>
        this.paginate('/api/v1/courses', {
          params: {
            enrollment_state: 'active',
            include: [
              'total_scores',
              'current_grading_period_scores',
              'term',
              'favorites',
              'course_image',
              'concluded',
            ],
            state: ['available'],
          },
        })
      );
    }

    /**
     * Canvas's own dashboard card payload — position, color, image and the
     * per-course link set the real dashboard renders from.
     */
    dashboardCards({ ttl = 120000 } = {}) {
      return this.cached('dashboardCards', ttl, async () => {
        try {
          return (await this.request('/api/v1/dashboard/dashboard_cards')).data || [];
        } catch (err) {
          // Not every Canvas release exposes this; callers fall back to courses().
          if (err instanceof CanvasApiError && err.status === 404) return [];
          throw err;
        }
      });
    }

    /** { "course_42": "#abc123", ... } */
    customColors({ ttl = 300000 } = {}) {
      return this.cached('colors', ttl, async () => {
        const data = (await this.request('/api/v1/users/self/colors')).data;
        return data?.custom_colors || {};
      });
    }

    /** Persist a card color back into Canvas so it follows the user everywhere. */
    async setCustomColor(assetString, hexcode) {
      const clean = String(hexcode).replace(/^#/, '');
      const result = await this.request(`/api/v1/users/self/colors/${assetString}`, {
        method: 'PUT',
        params: { hexcode: clean },
      });
      this.invalidate('colors');
      return result.data;
    }

    /** { "course_42": "My nickname" } */
    async courseNicknames({ ttl = 300000 } = {}) {
      return this.cached('nicknames', ttl, async () => {
        const list = await this.paginate('/api/v1/users/self/course_nicknames');
        const out = {};
        for (const item of list) if (item?.course_id) out[String(item.course_id)] = item.nickname;
        return out;
      });
    }

    /**
     * Planner items in a date window — the union of assignments, quizzes,
     * discussions, calendar events and the user's own planner notes.
     */
    plannerItems({ startDate, endDate, contextCodes, ttl = 60000 } = {}) {
      const key = `planner:${startDate}:${endDate}:${(contextCodes || []).join(',')}`;
      return this.cached(key, ttl, () =>
        this.paginate('/api/v1/planner/items', {
          params: {
            start_date: startDate,
            end_date: endDate,
            context_codes: contextCodes,
            per_page: 50,
          },
          max: 6,
        })
      );
    }

    /** Canvas's native to-do list (ungraded submissions needing attention). */
    todo({ ttl = 60000 } = {}) {
      return this.cached('todo', ttl, () => this.paginate('/api/v1/users/self/todo', { max: 3 }));
    }

    /** Missing submissions across all courses. */
    missingSubmissions({ ttl = 300000 } = {}) {
      return this.cached('missing', ttl, () =>
        this.paginate('/api/v1/users/self/missing_submissions', {
          params: { include: ['planner_overrides'], filter: ['submittable'] },
          max: 3,
        })
      );
    }

    /**
     * Assignment groups with their assignments and the user's submissions —
     * everything the weighted-grade and what-if calculators need, in one call
     * per course.
     */
    assignmentGroups(courseId, { ttl = 60000 } = {}) {
      return this.cached(`groups:${courseId}`, ttl, () =>
        this.paginate(`/api/v1/courses/${courseId}/assignment_groups`, {
          params: {
            include: ['assignments', 'submission', 'score_statistics'],
            exclude_response_fields: ['description', 'rubric'],
          },
          max: 5,
        })
      );
    }

    assignments(courseId, { ttl = 60000 } = {}) {
      return this.cached(`assignments:${courseId}`, ttl, () =>
        this.paginate(`/api/v1/courses/${courseId}/assignments`, {
          params: { include: ['submission'], order_by: 'due_at' },
          max: 5,
        })
      );
    }

    assignment(courseId, assignmentId, { ttl = 300000 } = {}) {
      return this.cached(`assignment:${courseId}:${assignmentId}`, ttl, async () =>
        (await this.request(`/api/v1/courses/${courseId}/assignments/${assignmentId}`, {
          params: { include: ['submission'] },
        })).data
      );
    }

    /** The user's enrollments, which carry authoritative computed scores. */
    enrollments({ ttl = 120000 } = {}) {
      return this.cached('enrollments', ttl, () =>
        this.paginate('/api/v1/users/self/enrollments', {
          params: { state: ['active'], type: ['StudentEnrollment'] },
          max: 5,
        })
      );
    }

    /**
     * Mark a planner item complete (or not). Canvas models this as a
     * "planner override" attached to the underlying object, so a first toggle
     * creates one and later toggles update it.
     */
    async setPlannerComplete(item, complete) {
      const overrideId = item?.planner_override?.id;
      const payload = { marked_complete: Boolean(complete) };
      const result = overrideId
        ? await this.request(`/api/v1/planner/overrides/${overrideId}`, {
          method: 'PUT',
          body: payload,
        })
        : await this.request('/api/v1/planner/overrides', {
          method: 'POST',
          body: {
            plannable_type: item.plannable_type,
            plannable_id: item.plannable_id,
            ...payload,
          },
        });
      this.invalidate('planner:');
      return result.data;
    }

    announcements(contextCodes, { ttl = 300000, days = 21 } = {}) {
      if (!contextCodes?.length) return Promise.resolve([]);
      const start = new Date(Date.now() - days * 86400000).toISOString();
      const key = `announcements:${contextCodes.join(',')}`;
      return this.cached(key, ttl, () =>
        this.paginate('/api/v1/announcements', {
          params: { context_codes: contextCodes, start_date: start, active_only: true, per_page: 20 },
          max: 3,
        })
      );
    }

    /** Verify the session is live and this really is a Canvas install. */
    async healthCheck() {
      try {
        const profile = await this.profile();
        return { ok: Boolean(profile?.id), profile };
      } catch (err) {
        return { ok: false, error: err };
      }
    }
  }

  CanvasMax.api = {
    CanvasApi,
    CanvasApiError,
    parseLinkHeader,
    readCookie,
    buildQuery,
    parseBody,
    looksLikeCanvas,
    /** Lazily-created client bound to the current origin. */
    get default() {
      if (!CanvasMax.api._default) CanvasMax.api._default = new CanvasApi();
      return CanvasMax.api._default;
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
