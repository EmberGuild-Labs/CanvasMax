# Theme format

A CanvasMax theme is a JSON object. Export one from **Settings → Appearance → Export my themes**, or write one by hand and import it.

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "dark": true,
  "radius": 10,
  "colors": {
    "bg":        "#0f1419",
    "surface":   "#171d26",
    "border":    "#2a3340",
    "text":      "#e5eaf0",
    "textMuted": "#94a3b4",
    "accent":    "#4f8cff",
    "navBg":     "#0b0f14",
    "navText":   "#c8d2de",
    "link":      "#6ea8ff"
  }
}
```

## Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Shown in the theme picker. |
| `colors` | yes | The nine colors below. Any you omit are inherited from the matching built-in base. |
| `dark` | no (default `true`) | Whether this theme is offered for the dark slot or the light slot. |
| `radius` | no | Corner radius in pixels, 0–24. |
| `id` | no | Generated from the name on import; collisions get a numeric suffix. |

All colors must be hex — `#rgb`, `#rrggbb` or `#rrggbbaa`. Named CSS colors are rejected.

## The nine colors

| Key | Used for |
| --- | --- |
| `bg` | The page background behind everything. |
| `surface` | Cards, panels, dialogs, menus. |
| `border` | Dividers and outlines. |
| `text` | Body text and headings. |
| `textMuted` | Secondary text: metadata, labels, timestamps. |
| `accent` | Primary buttons, active nav, badges, focus rings. |
| `navBg` | The global navigation rail. |
| `navText` | Text and icons on that rail. |
| `link` | Hyperlinks in content. |

## What gets derived

You do not set hover states, elevated surfaces, shadows or overlays. `themeVariables()` in `src/lib/themes.js` computes them, which is why nine values produce a coherent interface:

- `--cmx-surface-hover` / `--cmx-surface-active` — `surface` lightened (dark themes) or darkened (light themes)
- `--cmx-bg-sunken` — a recessed shade of `bg` for table headers and breadcrumbs
- `--cmx-border-strong` — a higher-contrast `border` for inputs and buttons
- `--cmx-accent-hover`, `--cmx-accent-soft` — accent variants for hover and tinted backgrounds
- `--cmx-accent-text`, `--cmx-text-inverse` — black or white, whichever is readable on that background
- `--cmx-shadow`, `--cmx-shadow-lg`, `--cmx-overlay` — depth appropriate to a light or dark ground
- `--cmx-success`, `--cmx-warning`, `--cmx-danger` — status colors tuned per mode

## Contrast

The editor audits five pairings live and flags any that fail:

| Pairing | Minimum ratio |
| --- | --- |
| Body text on background | 4.5:1 |
| Body text on surface | 4.5:1 |
| Muted text on surface | 3:1 |
| Links on surface | 3:1 |
| Nav text on nav background | 4.5:1 |

You can save a theme that fails — it is your browser. But every theme shipped with CanvasMax passes, and a test enforces it.

## Sharing

Themes are files. Export, send, import. No gallery, no account, no server.

To share several at once, export them together — the importer accepts either a single theme object or an array of them.

## Using theme colors in custom CSS

**Settings → Advanced → Custom CSS** is applied after the theme. Reference the variables so your rules follow whichever theme is active:

```css
.ic-DashboardCard {
  border: 2px solid var(--cmx-accent);
}

#breadcrumbs {
  background: var(--cmx-bg-sunken);
  font-style: italic;
}
```
