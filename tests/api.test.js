'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLibs } = require('./helper');

const { api } = loadLibs();

test('parseLinkHeader reads every rel from a Canvas pagination header', () => {
  const header = '<https://x/api/v1/courses?page=2&per_page=10>; rel="next",'
    + '<https://x/api/v1/courses?page=1&per_page=10>; rel="first",'
    + '<https://x/api/v1/courses?page=9&per_page=10>; rel="last"';
  const links = api.parseLinkHeader(header);
  assert.equal(links.next, 'https://x/api/v1/courses?page=2&per_page=10');
  assert.equal(links.first, 'https://x/api/v1/courses?page=1&per_page=10');
  assert.equal(links.last, 'https://x/api/v1/courses?page=9&per_page=10');
});

test('parseLinkHeader tolerates unquoted rels and missing headers', () => {
  assert.equal(api.parseLinkHeader('<https://x/2>; rel=next').next, 'https://x/2');
  assert.deepEqual(api.parseLinkHeader(null), {});
  assert.deepEqual(api.parseLinkHeader(''), {});
});

test('buildQuery expands arrays into Canvas bracket syntax', () => {
  const query = api.buildQuery({ include: ['total_scores', 'term'], per_page: 100 });
  assert.equal(query, '?include%5B%5D=total_scores&include%5B%5D=term&per_page=100');
});

test('buildQuery drops empty values and returns an empty string for nothing', () => {
  assert.equal(api.buildQuery({ a: null, b: undefined, c: '' }), '');
  assert.equal(api.buildQuery({}), '');
});

test('parseBody strips Canvas anti-hijacking prefix', () => {
  assert.deepEqual(api.parseBody('while(1);[{"id":"7"}]'), [{ id: '7' }]);
  assert.deepEqual(api.parseBody('{"id":"7"}'), { id: '7' });
  assert.equal(api.parseBody(''), null);
  assert.equal(api.parseBody('while(1);'), null);
});

test('parseBody surfaces malformed JSON rather than swallowing it', () => {
  assert.throws(() => api.parseBody('while(1);{oops'), SyntaxError);
});

test('readCookie finds and URL-decodes a value', () => {
  const jar = 'log_session_id=abc; _csrf_token=aB%2Fcd%3D%3D; canvas_session=xyz';
  assert.equal(api.readCookie('_csrf_token', jar), 'aB/cd==');
  assert.equal(api.readCookie('canvas_session', jar), 'xyz');
  assert.equal(api.readCookie('missing', jar), null);
});

test('readCookie is not fooled by a name that is a suffix of another', () => {
  assert.equal(api.readCookie('token', 'csrf_token=nope; token=yes'), 'yes');
});

test('a client normalizes its origin and drops a trailing slash', () => {
  const client = new api.CanvasApi('https://canvas.school.edu/');
  assert.equal(client.origin, 'https://canvas.school.edu');
});

test('CanvasApiError flags authentication failures', () => {
  assert.equal(new api.CanvasApiError('x', { status: 401 }).isAuthError, true);
  assert.equal(new api.CanvasApiError('x', { status: 403 }).isAuthError, true);
  assert.equal(new api.CanvasApiError('x', { status: 500 }).isAuthError, false);
});

test('cached() serves a hit within the TTL and refetches after it', async () => {
  const client = new api.CanvasApi('https://x');
  let calls = 0;
  const load = async () => { calls += 1; return calls; };

  assert.equal(await client.cached('k', 10000, load), 1);
  assert.equal(await client.cached('k', 10000, load), 1, 'second call is served from cache');
  assert.equal(calls, 1);

  assert.equal(await client.cached('k', 0, load), 2, 'a zero TTL always refetches');
});

test('cached() collapses concurrent calls into one request', async () => {
  const client = new api.CanvasApi('https://x');
  let calls = 0;
  const load = () => {
    calls += 1;
    return new Promise((resolve) => setTimeout(() => resolve('v'), 10));
  };

  const [a, b, c] = await Promise.all([
    client.cached('same', 10000, load),
    client.cached('same', 10000, load),
    client.cached('same', 10000, load),
  ]);

  assert.equal(calls, 1, 'three callers, one request');
  assert.deepEqual([a, b, c], ['v', 'v', 'v']);
});

test('invalidate clears by prefix, or everything when given none', async () => {
  const client = new api.CanvasApi('https://x');
  await client.cached('courses', 10000, async () => 1);
  await client.cached('planner:a', 10000, async () => 1);
  await client.cached('planner:b', 10000, async () => 1);

  client.invalidate('planner:');
  assert.equal(client.cache.has('courses'), true);
  assert.equal(client.cache.has('planner:a'), false);

  client.invalidate();
  assert.equal(client.cache.size, 0);
});

test('request() sends the string-ids Accept header and session cookies', async () => {
  const client = new api.CanvasApi('https://canvas.test');
  let seen = null;

  global.fetch = async (url, init) => {
    seen = { url, init };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => 'while(1);{"id":"1"}',
    };
  };

  const { data } = await client.request('/api/v1/users/self/profile');
  assert.deepEqual(data, { id: '1' });
  assert.equal(seen.url, 'https://canvas.test/api/v1/users/self/profile');
  assert.equal(seen.init.credentials, 'same-origin');
  assert.match(seen.init.headers.Accept, /canvas-string-ids/);
  delete global.fetch;
});

test('request() throws a typed error on a non-OK response', async () => {
  const client = new api.CanvasApi('https://canvas.test');
  global.fetch = async () => ({
    ok: false, status: 403, headers: { get: () => null }, text: async () => '',
  });

  await assert.rejects(
    () => client.request('/api/v1/courses'),
    (err) => err instanceof api.CanvasApiError && err.status === 403 && err.isAuthError
  );
  delete global.fetch;
});

test('paginate() follows rel="next" until it runs out', async () => {
  const client = new api.CanvasApi('https://canvas.test');
  const pages = {
    'https://canvas.test/api/v1/courses?per_page=100': {
      body: '[{"id":"1"},{"id":"2"}]',
      link: '<https://canvas.test/api/v1/courses?page=2>; rel="next"',
    },
    'https://canvas.test/api/v1/courses?page=2': {
      body: '[{"id":"3"}]',
      link: null,
    },
  };

  global.fetch = async (url) => {
    const page = pages[url];
    if (!page) throw new Error(`unexpected url ${url}`);
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'Link' ? page.link : null) },
      text: async () => page.body,
    };
  };

  const all = await client.paginate('/api/v1/courses');
  assert.deepEqual(all.map((c) => c.id), ['1', '2', '3']);
  delete global.fetch;
});

test('paginate() stops at the page cap even if Canvas keeps offering more', async () => {
  const client = new api.CanvasApi('https://canvas.test');
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => '<https://canvas.test/next>; rel="next"' },
    text: async () => '[{"id":"x"}]',
  });

  const all = await client.paginate('/api/v1/courses', { max: 3 });
  assert.equal(all.length, 3);
  delete global.fetch;
});

test('looksLikeCanvas recognises Canvas markers and rejects other pages', () => {
  const withSelector = (matches) => ({
    querySelector: (sel) => (matches.includes(sel) ? {} : null),
  });

  assert.equal(api.looksLikeCanvas(withSelector(['meta[name="csrf-param"]'])), true);
  assert.equal(api.looksLikeCanvas(withSelector(['#application.ic-app, body.ic-app'])), true);
  assert.equal(api.looksLikeCanvas(withSelector([])), false);
  assert.equal(api.looksLikeCanvas(null), false);
});
