/**
 * CanvasMax — background service worker.
 *
 * Responsibilities:
 *   - remember which concrete Canvas origins this user actually visits
 *   - register content scripts for self-hosted Canvas domains the user has
 *     granted access to (the manifest can only hard-code *.instructure.com)
 *   - poll for upcoming work and raise reminder notifications
 *   - keep the toolbar badge showing what is due soon
 *
 * MV3 workers are killed aggressively, so nothing is kept in memory across
 * events; every handler reloads what it needs from storage.
 */

/* global importScripts */
importScripts(
  '../lib/util.js',
  '../lib/storage.js',
  '../lib/canvas-api.js',
  '../lib/themes.js',
  '../lib/fonts.js',
  '../lib/grades.js',
  '../lib/gpa.js'
);

const { storage, api } = self.CanvasMax;

const ORIGINS_KEY = 'origins';
const NOTIFIED_KEY = 'notified';
const REMINDER_ALARM = 'cmx:reminders';
const REMINDER_PERIOD_MINUTES = 30;

/** Content scripts registered for user-added domains all share this id prefix. */
const DYNAMIC_SCRIPT_ID = 'cmx-dynamic';

/** Mirrors the manifest's second content_scripts entry. */
const CONTENT_SCRIPTS = [
  'src/lib/util.js',
  'src/lib/storage.js',
  'src/lib/canvas-api.js',
  'src/lib/themes.js',
  'src/lib/fonts.js',
  'src/lib/gpa.js',
  'src/lib/grades.js',
  'src/content/features/theme.js',
  'src/content/features/appearance.js',
  'src/content/features/surface-sweep.js',
  'src/content/features/ui-tweaks.js',
  'src/content/features/dashboard-cards.js',
  'src/content/features/card-grades.js',
  'src/content/features/todo.js',
  'src/content/features/notes.js',
  'src/content/features/gpa-panel.js',
  'src/content/features/grade-calculator.js',
  'src/content/features/assignment-preview.js',
  'src/content/boot.js',
];

const EARLY_SCRIPT = ['src/content/early.js'];
const CONTENT_CSS = ['src/content/theme.css', 'src/content/overlay.css'];

// ------------------------------------------------------------- origins ----

async function rememberOrigin(origin) {
  if (!origin || !/^https?:\/\//.test(origin)) return;
  const origins = await storage.getLocal(ORIGINS_KEY, []);
  if (origins.includes(origin)) return;
  origins.push(origin);
  await storage.setLocal(ORIGINS_KEY, origins.slice(-10));
}

async function knownOrigins() {
  return storage.getLocal(ORIGINS_KEY, []);
}

// ------------------------------------------------- dynamic registration ----

/**
 * Register CanvasMax's content scripts for each custom domain the user has
 * granted host permission to. Existing registrations are replaced wholesale so
 * this stays correct after an update changes the script list.
 */
async function syncDynamicScripts() {
  const settings = await storage.getSettings({ fresh: true });
  const domains = (settings.domains || []).filter(Boolean);

  let existing = [];
  try {
    existing = await chrome.scripting.getRegisteredContentScripts();
  } catch { /* first run */ }

  const ours = existing.filter((script) => script.id.startsWith(DYNAMIC_SCRIPT_ID));
  if (ours.length) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: ours.map((s) => s.id) });
    } catch (err) {
      console.warn('[CanvasMax] could not unregister old scripts', err);
    }
  }

  if (!domains.length) return;

  // Only register for origins we actually hold permission for; asking for a
  // permission we were not granted throws and would drop the whole batch.
  const granted = [];
  for (const domain of domains) {
    const pattern = `*://${domain}/*`;
    try {
      const has = await chrome.permissions.contains({ origins: [pattern] });
      if (has) granted.push(pattern);
    } catch { /* malformed domain */ }
  }
  if (!granted.length) return;

  try {
    await chrome.scripting.registerContentScripts([
      {
        id: `${DYNAMIC_SCRIPT_ID}-early`,
        matches: granted,
        js: EARLY_SCRIPT,
        css: CONTENT_CSS,
        runAt: 'document_start',
        allFrames: false,
      },
      {
        id: `${DYNAMIC_SCRIPT_ID}-main`,
        matches: granted,
        js: CONTENT_SCRIPTS,
        runAt: 'document_idle',
        allFrames: false,
      },
    ]);
  } catch (err) {
    console.error('[CanvasMax] dynamic script registration failed', err);
  }
}

// ----------------------------------------------------------- reminders ----

/**
 * Collect upcoming planner items across every Canvas origin we know about.
 * Requests are cookie-authenticated exactly like the content script's.
 */
async function fetchUpcoming(hoursAhead = 48) {
  const origins = await knownOrigins();
  const now = Date.now();
  const results = [];

  for (const origin of origins) {
    const client = new api.CanvasApi(origin);
    try {
      const items = await client.plannerItems({
        startDate: new Date(now).toISOString(),
        endDate: new Date(now + hoursAhead * 3600000).toISOString(),
        ttl: 0,
      });
      for (const item of items) {
        const dateValue = item.plannable_date || item.plannable?.due_at;
        if (!dateValue) continue;
        const submissions = item.submissions || {};
        const done = Boolean(
          item.planner_override?.marked_complete
          || submissions.submitted || submissions.graded || submissions.excused
        );
        if (done) continue;
        if (item.plannable_type === 'calendar_event') continue;

        results.push({
          key: `${origin}|${item.plannable_type}|${item.plannable_id}`,
          origin,
          title: item.plannable?.title || item.plannable?.name || 'Assignment',
          context: item.context_name || '',
          due: new Date(dateValue).getTime(),
          url: item.html_url ? `${origin}${item.html_url}` : origin,
        });
      }
    } catch (err) {
      // A signed-out origin is normal; don't spam the console.
      if (!(err?.isAuthError)) console.warn('[CanvasMax] planner poll failed for', origin, err);
    }
  }

  return results.sort((a, b) => a.due - b.due);
}

/**
 * Decide which items deserve a notification right now.
 *
 * An item fires once per configured lead time, and only while the deadline is
 * inside that window but has not yet slipped past the next-shorter window —
 * so a 24h and a 2h reminder are two distinct notifications, not four.
 */
function dueNotifications(items, leadMinutes, now, alreadyNotified) {
  const leads = [...leadMinutes].map(Number).filter(Number.isFinite).sort((a, b) => b - a);
  const out = [];

  for (const item of items) {
    const minutesLeft = (item.due - now) / 60000;
    if (minutesLeft < 0) continue;

    for (let i = 0; i < leads.length; i += 1) {
      const lead = leads[i];
      const nextShorter = leads[i + 1] ?? 0;
      if (minutesLeft > lead || minutesLeft <= nextShorter) continue;

      const stamp = `${item.key}@${lead}`;
      if (alreadyNotified.includes(stamp)) break;
      out.push({ ...item, lead, stamp, minutesLeft });
      break; // one notification per item per run
    }
  }

  return out;
}

function describeLead(minutes) {
  if (minutes >= 1440) {
    const days = Math.round(minutes / 1440);
    return `due in ${days} day${days === 1 ? '' : 's'}`;
  }
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return `due in ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `due in ${Math.max(1, Math.round(minutes))} minutes`;
}

async function runReminders() {
  const settings = await storage.getSettings({ fresh: true });
  if (!settings.enabled) return;

  let items = [];
  try {
    items = await fetchUpcoming(72);
  } catch (err) {
    console.warn('[CanvasMax] reminder poll failed', err);
    return;
  }

  await updateBadge(items);

  if (!settings.reminders.enabled) return;

  const now = Date.now();
  const notified = await storage.getLocal(NOTIFIED_KEY, []);
  const pending = dueNotifications(items, settings.reminders.leadMinutes || [], now, notified);

  for (const item of pending.slice(0, 5)) {
    try {
      await chrome.notifications.create(item.stamp, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: item.title,
        message: `${item.context ? `${item.context} · ` : ''}${describeLead(item.minutesLeft)}`,
        priority: item.minutesLeft <= 120 ? 2 : 0,
      });
      notified.push(item.stamp);
    } catch (err) {
      console.warn('[CanvasMax] notification failed', err);
    }
  }

  // Keep the dedupe list from growing without bound.
  await storage.setLocal(NOTIFIED_KEY, notified.slice(-300));
  await storage.setLocal('notificationTargets', Object.fromEntries(
    pending.map((item) => [item.stamp, item.url])
  ));
}

/** Badge shows how many things are due in the next 24 hours. */
async function updateBadge(items) {
  const cutoff = Date.now() + 86400000;
  const count = items.filter((item) => item.due <= cutoff).length;
  try {
    await chrome.action.setBadgeText({ text: count ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: count ? '#c0392b' : '#00000000' });
    await chrome.action.setTitle({
      title: count ? `CanvasMax — ${count} due in the next 24 hours` : 'CanvasMax',
    });
  } catch { /* action API unavailable during teardown */ }
}

// -------------------------------------------------------- google fonts ----

/** Refuse to cache a family that would bloat storage.local. */
const MAX_FONT_BYTES = 3 * 1024 * 1024;

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked so a large font cannot blow the argument limit on String.fromCharCode.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Fetch a Google Fonts family and rewrite it into a self-contained stylesheet
 * with every woff2 inlined as a data URI.
 *
 * Doing the download here rather than in the page is deliberate. The page
 * never contacts Google, so the extension keeps its promise that nothing about
 * the user's browsing leaves their machine, and the resulting CSS is immune to
 * whatever content security policy the school's Canvas sets.
 */
async function importGoogleFont(family) {
  const { fonts } = self.CanvasMax;
  if (!fonts.isValidFamilyName(family)) {
    return { ok: false, error: 'That does not look like a font family name.' };
  }

  const url = fonts.googleFontsUrl([family]);
  if (!url) return { ok: false, error: 'Could not build a request for that family.' };

  let css;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        ok: false,
        error: response.status === 400
          ? `Google Fonts has no family called "${family}".`
          : `Google Fonts returned ${response.status}.`,
      };
    }
    css = await response.text();
  } catch (err) {
    return { ok: false, error: `Could not reach Google Fonts: ${err.message}` };
  }

  const fontUrls = fonts.extractFontUrls(css);
  if (!fontUrls.length) return { ok: false, error: 'That family returned no usable font files.' };

  let total = 0;
  for (const fontUrl of fontUrls) {
    try {
      const response = await fetch(fontUrl);
      if (!response.ok) continue;
      const buffer = await response.arrayBuffer();
      total += buffer.byteLength;
      if (total > MAX_FONT_BYTES) {
        return { ok: false, error: 'That family is too large to cache. Try one with fewer styles.' };
      }
      const mime = fontUrl.endsWith('.woff2') ? 'font/woff2' : 'font/woff';
      css = css.split(fontUrl).join(`data:${mime};base64,${toBase64(buffer)}`);
    } catch {
      // A style that fails to download simply falls back to another weight.
    }
  }

  await storage.setLocal(`googleFont:${family}`, css);
  return { ok: true, family, bytes: total, faces: fontUrls.length };
}

async function removeGoogleFont(family) {
  await storage.removeLocal(`googleFont:${family}`);
  return { ok: true };
}

// -------------------------------------------------------------- events ----

chrome.runtime.onInstalled.addListener(async (details) => {
  await storage.getSettings();
  await syncDynamicScripts();
  chrome.alarms.create(REMINDER_ALARM, { periodInMinutes: REMINDER_PERIOD_MINUTES, delayInMinutes: 1 });

  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html?welcome=1') });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await syncDynamicScripts();
  chrome.alarms.create(REMINDER_ALARM, { periodInMinutes: REMINDER_PERIOD_MINUTES, delayInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REMINDER_ALARM) runReminders();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'cmx:hello':
        await rememberOrigin(message.origin || new URL(sender.tab?.url || '').origin);
        sendResponse({ ok: true });
        break;

      case 'cmx:sync-scripts':
        await syncDynamicScripts();
        sendResponse({ ok: true });
        break;

      case 'cmx:run-reminders':
        await runReminders();
        sendResponse({ ok: true });
        break;

      case 'cmx:upcoming': {
        const items = await fetchUpcoming(message.hours || 48);
        sendResponse({ ok: true, items });
        break;
      }

      case 'cmx:import-font':
        sendResponse(await importGoogleFont(message.family));
        break;

      case 'cmx:remove-font':
        sendResponse(await removeGoogleFont(message.family));
        break;

      case 'cmx:origins':
        sendResponse({ ok: true, origins: await knownOrigins() });
        break;

      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
  })().catch((err) => {
    console.error('[CanvasMax] worker message failed', err);
    sendResponse({ ok: false, error: String(err?.message || err) });
  });

  return true; // responses are always async
});

chrome.notifications.onClicked.addListener(async (id) => {
  const targets = await storage.getLocal('notificationTargets', {});
  const url = targets[id];
  if (url) chrome.tabs.create({ url });
  chrome.notifications.clear(id);
});

// Re-register content scripts whenever the domain list changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' && area !== 'local') return;
  if (!changes.settings) return;
  const before = changes.settings.oldValue?.domains || [];
  const after = changes.settings.newValue?.domains || [];
  if (JSON.stringify(before) !== JSON.stringify(after)) syncDynamicScripts();
});

// Exposed for tests.
self.CanvasMax.worker = { dueNotifications, describeLead };
