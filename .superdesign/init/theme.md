# Theme

## Part 1 — Token summary

"Carbon-copy" palette: paper background, ink text, one warm accent (carbon). Light/dark follow `prefers-color-scheme`; there is no toggle.

| Token (Tailwind color) | Light | Dark | Use |
|---|---|---|---|
| `paper` | `#f2f3f0` | `#15161b` | page background |
| `ink` | `#1e2130` | `#e4e5eb` | text |
| `carbon` | `#7a5a1a` | `#e3cb94` | accent: primary buttons, links, feed name, focus ring, active tab |
| `on-carbon` | `#ffffff` | `#15161b` | text on carbon |
| `rule` | `#d6d9df` | `#2a2c35` | borders, dividers |
| `muted` | `#686d7a` | `#9a9eab` | secondary text |
| `error` | `#b3261e` | `#ff8a80` | errors, danger |

- Fonts: `font-sans` = Atkinson Hyperlegible Next, `font-mono` = Atkinson Hyperlegible Mono (Google fonts via next/font). Body `text-base leading-relaxed`.
- Type scale in use: h1 `text-2xl font-bold tracking-tight`; header brand `text-xl font-bold`; section headings `text-base font-bold`; most UI `text-sm`.
- Radius: `rounded-sm` everywhere (inputs, buttons, chips, images).
- Shadows: none. Borders: 1px `border-rule`, focus `border-carbon`.
- Layout: single column `max-w-[68ch] px-4 py-8 sm:py-12`; Tailwind default breakpoints (`sm` 640px used to show icon labels).
- Buttons: primary `rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon`; secondary `rounded-sm border border-rule px-3 py-1 hover:border-carbon`; header actions `rounded-sm px-2 py-1 text-muted hover:bg-rule/50` with lucide icon `h-4 w-4`.
- Motion: only `.arrived` (new note fades from a 16% carbon tint over 1.5s); respects reduced motion.
- Logo: `app/icon.svg` (two stacked paper sheets, back sheet `#d9c08a`, front white with ink lines, on a `#f2f3f0` rounded square).

## Part 2 — Raw source

### `app/globals.css`
```css
@import "tailwindcss";

/* Carbon-copy palette: see spec "UI design". */
:root {
  --paper: #f2f3f0;
  --ink: #1e2130;
  --carbon: #7a5a1a;
  --rule: #d6d9df;
  --muted: #686d7a;
  --error: #b3261e;
  --on-carbon: #ffffff;
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #15161b;
    --ink: #e4e5eb;
    --carbon: #e3cb94;
    --rule: #2a2c35;
    --muted: #9a9eab;
    --error: #ff8a80;
    --on-carbon: #15161b;
    color-scheme: dark;
  }
}

@theme inline {
  --color-paper: var(--paper);
  --color-ink: var(--ink);
  --color-carbon: var(--carbon);
  --color-rule: var(--rule);
  --color-muted: var(--muted);
  --color-error: var(--error);
  --color-on-carbon: var(--on-carbon);
  --font-sans: var(--font-atkinson);
  --font-mono: var(--font-atkinson-mono);
}

body {
  background: var(--paper);
  color: var(--ink);
}

:focus-visible {
  outline: 2px solid var(--carbon);
  outline-offset: 2px;
}

/* Rendered markdown. Kept quiet so the notes, not the chrome, carry the page. */
.md > * + * { margin-top: 0.6em; }
.md h1, .md h2, .md h3 { font-weight: 700; line-height: 1.3; }
.md h1 { font-size: 1.25rem; }
.md h2 { font-size: 1.125rem; }
.md a { color: var(--carbon); text-decoration: underline; text-underline-offset: 2px; }
.md ul { list-style: disc; padding-left: 1.25em; }
.md ol { list-style: decimal; padding-left: 1.25em; }
.md blockquote { border-left: 2px solid var(--rule); padding-left: 0.75em; color: var(--muted); }
.md code { font-family: var(--font-mono); font-size: 0.9em; }
.md pre { font-family: var(--font-mono); font-size: 0.875rem; overflow-x: auto; padding: 0.75em 0; border-block: 1px solid var(--rule); }
.md table { border-collapse: collapse; }
.md th, .md td { border: 1px solid var(--rule); padding: 0.25em 0.5em; text-align: left; }
.md img { max-width: 100%; height: auto; }
.md hr { border: 0; border-top: 1px solid var(--rule); }

/* The one motion: a just-posted note arrives with a carbon tint that fades. */
@keyframes arrive {
  from { background: color-mix(in srgb, var(--carbon) 16%, transparent); }
  to { background: transparent; }
}
.arrived { animation: arrive 1.5s ease-out; }
@media (prefers-reduced-motion: reduce) {
  .arrived { animation: none; }
}
```

### `postcss.config.mjs`
```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

No tailwind.config (Tailwind v4, CSS-first).
