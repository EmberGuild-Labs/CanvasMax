# CanvasMax

A free, open-source Chrome extension that does what Better Canvas / BetterCampus does — dark mode, custom themes, dashboard grades, a real planner, GPA and what-if calculators — with nothing behind a paywall, no account, and no server.

CanvasMax is an independent, clean-room implementation. It shares no code with any other Canvas extension.

---

## Why this exists

Better Canvas was a free extension. It rebranded to **BetterCampus** and moved its themes, full planner and other tools behind a **$120/year Pro tier**. That is a lot of money for students, and it is charged for something that turns out not to need a paid backend at all.

Everything those features display comes from data the student's browser is *already allowed to read*: Canvas exposes a complete REST API at `/api/v1/*`, authenticated by the same session cookie that renders the pages. An extension running on a Canvas tab can call it directly.

So CanvasMax has:

- no account system
- no license server
- no backend of any kind
- no analytics, telemetry, or third-party requests

Which means there is nothing to charge for. See [How it works](#how-it-works).

---

## Feature parity

| Feature | BetterCampus | CanvasMax |
| --- | --- | --- |
| Dark mode | Free | Free |
| Built-in themes | Limited set free | 12 built in |
| **Custom themes** | **Pro** | Free, unlimited |
| **Theme editor with live preview** | **Pro** | Free |
| Theme import / export / sharing | Pro | Free, plain JSON files |
| Scheduled + system-following dark mode | Free | Free |
| Dashboard card colors and images | Free | Free |
| Card gradients, condensed and compact layouts | Free | Free |
| Hide, rename and reorder courses | Partly Pro | Free |
| Grades on dashboard cards | Free | Free, with a fallback that computes hidden totals |
| **Full planner / assignments-due list** | **Pro** | Free |
| Check items off from the planner | Pro | Free, writes back to Canvas |
| Dashboard notes | Free | Free |
| GPA calculator (4.0, 4.3, weighted HS) | Free | Free |
| **What-if grade calculator** | **Pro** | Free |
| "What do I need on the final?" | Pro | Free |
| Assignment preview without navigating | Free | Free (alt-click) |
| Custom fonts and text scaling | Free | Free |
| Interface tweaks (hide logo, nav items, sidebar) | Free | Free |
| **Settings sync across devices** | **Pro** | Free, via Chrome profile sync |
| Due-date reminders | Pro | Free |
| Custom CSS | Pro | Free |
| Self-hosted Canvas domains | Varies | Free, per-domain opt-in |

---

## Install

CanvasMax is not on the Chrome Web Store yet. Load it unpacked:

1. `git clone https://github.com/EmberGuild-Labs/CanvasMax.git`
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and choose the cloned folder
5. Open your Canvas site and sign in

To build an uploadable zip instead:

```bash
npm run package     # runs the static checks, then writes dist/canvasmax-<version>.zip
```

Works in any Chromium browser with Manifest V3 support: Chrome, Edge, Brave, Opera, Arc, Vivaldi.

### If your school uses its own Canvas domain

Most universities self-host Canvas at something like `canvas.myschool.edu` rather than `myschool.instructure.com`. An extension cannot request access to every possible domain without asking for access to your entire browsing history, which CanvasMax will not do.

Instead: open **CanvasMax settings → Canvas sites**, type your domain, and click **Grant access**. Chrome will prompt for that one site. CanvasMax then registers its scripts for that domain only.

---

## Features

### Theming

Twelve built-in themes — eight dark (Midnight, Carbon, True Black, Grape, Frost, Deep Tide, Moss, Ember) and four light (Canvas Light, Paper, Clear Sky, Sepia) — plus a full editor for your own.

A theme is nine colors. The engine derives everything else (hover states, raised surfaces, borders, shadows, translucent overlays, readable text on each background) so you are not hand-picking forty values to get a coherent result.

Dark mode can follow your system setting, stay on, stay off, or run on a schedule. Scheduled mode wakes at the exact boundary rather than polling, and handles windows that cross midnight.

**No flash of white.** Reading settings from extension storage is asynchronous, which normally means a white flash on every page load. CanvasMax mirrors the compiled palette into the Canvas origin's `localStorage`, which a content script *can* read synchronously at `document_start`, and applies it before the first paint. Only the very first page load after installing flashes.

The theme editor shows a live preview and a **WCAG contrast audit** as you pick colors, so you find out that your muted text is unreadable before you commit to it. All twelve built-in themes pass their contrast targets, and there is a test that keeps it that way.

### Sharing themes

A theme is a small JSON object. Export yours to a file, send it to anyone, and they can import it. There is no gallery to sign into and no server in the middle. See [docs/THEMES.md](docs/THEMES.md) for the format.

### Dashboard

Recolor, rename, re-image, reorder and hide course cards. Three densities: default, condensed (the header image collapses to an accent bar) and compact (also drops the action row). Optional gradient headers. Configurable quick links under each card — Assignments, Grades, Announcements, Discussions, Modules, Files, Syllabus, People, Quizzes, Pages.

Card colors default to whatever you already set in Canvas, so the dashboard does not change out from under you.

### Grades on cards

Reads the score Canvas already computes for each enrollment, preferring the current grading period when your institution uses them.

When a course is configured to hide totals from students, Canvas omits the score. CanvasMax then computes it from that course's assignment groups — the same arithmetic the Grades page would run — for up to eight such courses per load, so a student with many hidden courses does not trigger a request storm.

### Planner

Built from `/api/v1/planner/items`, which returns assignments, quizzes, discussions, calendar events and your own planner notes in one pass.

Groups by date or by course, separates overdue work into its own section, flags missing and late submissions, and lets you check items off — which writes a real planner override back to Canvas, so the change shows up in Canvas's own UI and on your phone.

### GPA

Computes your GPA from live Canvas grades on three scales:

- **4.0** — standard US unweighted, A and A+ both 4.0
- **4.3** — A+ worth 4.3
- **High school weighted** — 4.0 base plus Honors (+0.5) and AP/IB/Dual-enrollment (+1.0)

Set credit hours once per course. Courses with no posted grade are *skipped*, not counted as zero. Failing a weighted class earns no rigor bonus. Where a course defines its own grading standard, that standard is used rather than an assumed one.

### What-if calculator

On any course's Grades page, CanvasMax adds a panel showing the weighted breakdown Canvas hides, and lets you type hypothetical scores and watch the course grade move. Nothing is sent to Canvas — hypotheticals stay in the page.

Enter a target percentage and each row shows the score you would need on that assignment to reach it, or tells you the target is already met or no longer reachable. The grade is piecewise-linear in any single score, so this is solved directly from two probes rather than by searching.

The math mirrors Canvas's own, including the part people get wrong: in a weighted course, a group with no graded work yet is **dropped and the remaining weights renormalised**, not counted as zero. Otherwise every student would show single digits in week one.

### Reminders

Optional desktop notifications before work is due, at lead times you choose (1 week through 30 minutes). The background worker checks every 30 minutes and never notifies twice for the same deadline. The toolbar badge shows how many things are due in the next 24 hours.

### Interface tweaks

Hide the institution logo, breadcrumbs, right sidebar, dashboard greeting, or individual global-navigation items. Full-window width. Auto-expand modules. Custom fonts and text scaling. And a custom CSS box that can reference the CanvasMax theme variables, so your rules follow whichever theme is active.

---

## How it works

### The core idea

When you are signed in to Canvas, your browser holds a session cookie. Canvas's REST API accepts that same cookie:

```js
fetch('/api/v1/courses?include[]=total_scores', { credentials: 'same-origin' })
```

A content script running on a Canvas tab is same-origin with Canvas, so this just works. No OAuth app, no developer key, no API token, no server relaying anything. Every number CanvasMax displays is fetched by your own browser, from your own school, using your own session — and never leaves the machine.

Two Canvas-specific details the client handles:

- **`Accept: application/json+canvas-string-ids`.** Canvas IDs can exceed `Number.MAX_SAFE_INTEGER`. Without this header they silently round to the wrong number.
- **The `while(1);` prefix.** Canvas prepends it to JSON bodies as an anti-hijacking guard; it must be stripped before parsing.

Pagination follows the RFC 5988 `Link` header's `rel="next"` rather than incrementing `page=N`, because Canvas uses bookmarked pagination on several endpoints where page numbers break.

### Endpoints used

| Endpoint | Powers |
| --- | --- |
| `GET /api/v1/users/self/profile` | session health check |
| `GET /api/v1/courses` (`total_scores`, `current_grading_period_scores`, `term`) | course list, card grades, GPA |
| `GET /api/v1/users/self/colors` | existing Canvas card colors |
| `PUT /api/v1/users/self/colors/:asset` | writing a card color back to Canvas |
| `GET /api/v1/planner/items` | the planner panel and reminders |
| `POST` / `PUT /api/v1/planner/overrides` | checking planner items off |
| `GET /api/v1/courses/:id/assignment_groups` (`assignments`, `submission`) | what-if calculator, hidden-total fallback |
| `GET /api/v1/courses/:id/assignments/:id` | assignment preview |
| `GET /api/v1/users/self/course_nicknames` | course nicknames |

### No build step

Every file is a classic script that attaches to one `CanvasMax` global. There is no bundler, no transpiler, no `node_modules`. What you read in this repository is byte-for-byte what runs in the browser — which matters for an extension that reads your grades, because you can audit it without trusting a build pipeline.

The same files load three ways: ordered `js` arrays for content scripts, `<script>` tags for the options and popup pages, and `importScripts()` in the service worker.

### Layout

```
manifest.json                     MV3 manifest
src/
  lib/
    util.js                       DOM, color, and date helpers
    storage.js                    settings schema, deep-merge, migrations
    canvas-api.js                 REST client: pagination, caching, CSRF
    themes.js                     palettes, CSS-variable compiler, contrast audit
    grades.js                     weighted/unweighted grade math, what-if solving
    gpa.js                        GPA scales and computation
  content/
    early.js                      document_start, flash-free theme application
    boot.js                       page detection and feature dispatch
    theme.css                     Canvas restyling, entirely variable-driven
    overlay.css                   styles for CanvasMax's own injected UI
    features/                     one file per feature, each self-registering
  background/
    service-worker.js             alarms, reminders, badge, dynamic registration
  options/                        settings page and theme editor
  popup/                          toolbar popup
tools/
  make-icons.js                   generates the PNG icons (no dependencies)
  check.js                        static checks
  package.js                      builds the store zip
tests/                            132 unit tests, node:test
```

### Feature modules

Each file in `src/content/features/` pushes a descriptor onto `CanvasMax.features`:

```js
CanvasMax.features.push({
  id: 'card-grades',
  matches: (page) => page.type === 'dashboard',
  async init(ctx) { /* first run on this page */ },
  update(ctx) { /* settings changed */ },
});
```

`boot.js` classifies the URL, runs the features that apply, and re-runs them when settings change or Canvas navigates client-side. A feature that throws is logged and skipped — one broken feature never takes down the rest.

---

## Privacy

- **No network requests to anywhere but your own Canvas site.** There is no CanvasMax server.
- **No analytics, telemetry, or error reporting.**
- **No account.** Nothing to sign up for.
- Settings live in `chrome.storage.sync` (your Chrome profile, which is how they follow you between devices for free). Notes and caches live in `chrome.storage.local` and never leave the device.
- Grades, assignments and course data are fetched on demand, held in memory for the page's lifetime, and never written anywhere persistent.

**Permissions, and why each is needed:**

| Permission | Why |
| --- | --- |
| `storage` | saving your settings |
| `alarms` | the 30-minute reminder check |
| `notifications` | due-date reminders |
| `scripting` | registering content scripts for custom Canvas domains |
| `*://*.instructure.com/*` | the Canvas sites the extension is for |
| `optional_host_permissions` | self-hosted Canvas domains, requested one at a time, only when you ask |

CanvasMax never requests broad host access up front. The optional permission exists so you can grant `canvas.yourschool.edu` specifically.

---

## Development

```bash
npm test              # 132 unit tests (node:test, no dependencies)
npm run check         # syntax, manifest integrity, CSS variable coverage
npm run icons         # regenerate icons/*.png
npm run package       # check, then build dist/canvasmax-<version>.zip
```

There is nothing to install — the test suite uses Node's built-in runner, and the extension has no dependencies.

The tests cover the pure logic, which is where the bugs that matter live: grade computation (weighted, unweighted, excused, omitted, what-if, target-solving), GPA across all three scales, theme validation and contrast, `Link`-header pagination, the API client's caching and request de-duplication, settings merge and migration, planner normalisation and grouping, and URL classification.

`npm run check` additionally catches things unit tests cannot: a syntax error in a file nothing imports, a manifest entry pointing at a renamed file, a CSS variable no theme defines, and drift between the manifest's content-script list and the service worker's dynamic-registration copy of it.

### Adding a feature

1. Create `src/content/features/your-feature.js` and push a descriptor onto `CanvasMax.features`.
2. Add the path to `manifest.json` **and** to `CONTENT_SCRIPTS` in `src/background/service-worker.js` — `npm run check` fails if you forget the second one.
3. Add settings to `DEFAULTS` in `src/lib/storage.js`.
4. Add a UI entry to `SECTIONS` in `src/options/options.js`.

### The icon

The mark is an artist's palette in pixel art — a nod to "Canvas", and to the
unlimited custom themes that are the headline free feature. `tools/make-icons.js`
draws it and writes all four PNGs.

It is drawn as **two masters**, because Chrome's four sizes do not share one
clean scale factor:

| Master | Ships as |
| --- | --- |
| `paletteLarge()` — 32×32 | 32 (1×) and 128 (4×) |
| `paletteSmall()` — 16×16 | 16 (1×) and 48 (3×) |

Every size is an integer upscale of a master, so nothing is ever resampled and
the pixels stay hard-edged. If you change the art, change both masters: pixel
art has to be redrawn at each size rather than resized, since detail that reads
at 32px turns to mud at 16px. That is also why the small master's body is
written out row by row while the large one is rasterised from an ellipse — an
ellipse rasterised at 16px comes out visibly lumpy.

### Adding a theme

Add an entry to `BUILTIN_THEMES` in `src/lib/themes.js` with the nine required colors. The contrast test will tell you if any pairing is unreadable before it ships.

---

## Status and limitations

- **Not yet verified against a live Canvas instance.** The logic is unit-tested and the endpoints are taken from Canvas's own API documentation, but the DOM selectors in `theme.css` and the dashboard features have not been exercised against a running Canvas. Expect to need selector adjustments on your institution's version — Canvas installs vary, and Instructure is migrating components to InstUI, whose generated class names are not stable.
- **Firefox is not supported yet.** The code is close — Firefox supports MV3 — but `chrome.*` calls need a `browser.*` polyfill and the manifest needs a `browser_specific_settings` key.
- **Reminders require Chrome to be running.** They are driven by `chrome.alarms`, not a push service.
- **The hidden-grade fallback is capped** at eight courses per dashboard load, to avoid hammering Canvas.

## Contributing

Issues and pull requests are welcome. Two rules:

1. **No code from other Canvas extensions.** BetterCanvas is AGPL with additional non-commercial and no-redistribution restrictions. CanvasMax is a clean-room MIT implementation and must stay that way — contribute your own work only.
2. **No telemetry, no accounts, no paid tiers.** That is the point.

## License

MIT — see [LICENSE](LICENSE).

CanvasMax is not affiliated with, endorsed by, or connected to Instructure, Canvas LMS, Better Canvas, or BetterCampus. "Canvas" and "Instructure" are trademarks of Instructure, Inc.
