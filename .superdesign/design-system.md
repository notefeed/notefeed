# notefeed design system

## Product context

notefeed: markdown notes and RSS. A **feed** is a named list of markdown notes. Anyone who knows a feed's name can read and post to it (the name is the secret); there are **no user accounts**. Each feed has a public **read link** (`/r/<readId>`) and an RSS feed that show the notes but never the feed's name. Notes can carry a title, tags, images, and optionally who posted them. A feed can have a title, a description and a title image (used as its avatar). A licensed feed can have a password.

Jobs to be done:
- Post a quick note (text, link, image) to one of *my* feeds, from anywhere: the web, a phone's share sheet, a script.
- Read a feed as a timeline; filter by tag; open a single note.
- Share a feed read-only (read link, RSS) without revealing its name.
- Manage a feed: title, description, image, read link, password, license, delete.

Key screens: feed page (composer + timeline), single note (view/edit/delete), feed settings, read-only feed view, home (open or create a feed), license page.

## Information architecture (redesign)

- **Feed switcher**: feeds the user has opened are remembered on the device (no accounts). Shown as the current feed's avatar + name with a chevron; opens a list of remembered feeds with avatars, "Open another feed" and "Create feed". This is the main navigation.
- **Composer as a sheet**: posting is a standalone composer that can open from anywhere (a floating "new note" button, the feed page's inline prompt, and later the phone's share sheet with text/link/images prefilled). It contains: target feed (switchable), optional title, markdown body with Write/Preview, image attachments as thumbnails, tags as chips, Post button. On the feed page a compact "What's new?" prompt opens it.
- **Timeline**: notes as cards, newest first, grouped by day with sticky day labels.
- **Settings**: grouped list sections (iOS/Android settings style) instead of one long form: Profile (image, title, description), Sharing (read link, RSS, post from a script), Privacy & access (password, show who posted, lock this browser), License, Danger zone. Each row has an icon, a label, a value/summary and opens a detail sheet or inline editor.
- Header actions are icon buttons (with accessible labels and tooltips): read-only view, RSS, share, settings. Text labels only where an icon would be ambiguous.

## Brand & styling

Keep the identity, modernize the feel: warm, calm, paper-like, but with the depth and density of a modern social app.

### Logo
`app/icon.svg`: two stacked sheets (back sheet `#d9c08a`, front sheet white with ink lines) on a rounded square. Always the real logo; never a monogram or invented mark.

### Colors (light / dark via prefers-color-scheme)
| Token | Light | Dark | Use |
|---|---|---|---|
| paper | #f2f3f0 | #15161b | app background |
| surface | #ffffff | #1d1f26 | cards, sheets, nav bars |
| surface-2 | #e9eae6 | #262832 | inputs, chips, hover, segmented controls |
| ink | #1e2130 | #e4e5eb | primary text, icons |
| muted | #686d7a | #9a9eab | secondary text, inactive icons |
| rule | #d6d9df | #2a2c35 | hairline borders, dividers |
| carbon | #7a5a1a | #e3cb94 | the one accent: primary buttons, active states, links, feed name, focus ring |
| carbon-soft | carbon at 12% | carbon at 16% | selected chips, active tab background, new-note tint |
| on-carbon | #ffffff | #15161b | text/icons on carbon |
| error | #b3261e | #ff8a80 | errors, danger zone |

No other hues. No gradients except a very subtle carbon-soft wash.

### Typography
- Font: **Atkinson Hyperlegible Next** for all UI; **Atkinson Hyperlegible Mono** for code, read ids, keys, curl.
- Scale: 28/34 bold (screen titles), 20/28 bold (feed name), 17/24 semibold (note title), 15/22 regular (body), 13/18 (meta: time, sender, tags), 11/14 semibold uppercase tracking-wide (section labels).

### Shape, depth, spacing
- Radius: cards and sheets 16px; inputs and list groups 12px; buttons and chips full pill; avatars full circle (feed image) or 12px (logo).
- Shadows: cards `0 1px 2px rgb(0 0 0 / .04), 0 2px 8px rgb(0 0 0 / .04)`; sheets/FAB `0 8px 24px rgb(0 0 0 / .12)`. Dark mode: no shadows, use surface + rule borders.
- Spacing: 4px base; card padding 16px; gap between cards 12px; screen gutter 16px (mobile), content max width 640px.
- Hit targets ≥ 44px. Icon buttons 40px circles with 20px icons.

### Icons
lucide icons only, 1.75 stroke: Rss, Eye, Share2, Settings, Plus/PenSquare (new note), Image, Tag, Send, Hash, Link2, Terminal, KeyRound, Lock, BadgeCheck, Trash2, ChevronDown, ChevronRight, X, Copy, Check, MoreHorizontal, LogOut. Icon-only buttons always have an accessible label.

### Components
- **Note card**: surface card; header row = feed avatar (or sender initial) · sender/feed name · time (relative, e.g. "2h") · overflow menu (MoreHorizontal: edit, delete, copy link, report); optional bold title; markdown body (clamped with "more"); images edge-to-edge inside the card with 12px radius; tag chips (Hash icon, pill, surface-2) at the bottom.
- **Composer prompt**: surface card with avatar + "What's new?" placeholder + image and tag icon buttons; tap opens the composer sheet.
- **Composer sheet**: bottom sheet (mobile) / centered dialog (desktop); top bar = X close · feed switcher pill · Post (carbon pill). Body textarea grows; toolbar above keyboard with icon buttons: Image, Tag, Title (Heading icon), Preview (Eye) toggle, markdown help.
- **Settings group**: uppercase section label, then a 12px-radius surface group of rows separated by hairlines; row = 32px icon tile (carbon-soft bg, carbon icon) · label · value (muted) · ChevronRight.
- **Buttons**: primary carbon pill; secondary surface-2 pill; destructive error-outlined pill; icon button 40px circle, hover surface-2.
- **Chips**: pill, surface-2, 13px; selected = carbon-soft + carbon text.
- **Empty states**: centered icon in a carbon-soft circle, one line, one action (e.g. curl snippet in a mono code block with copy).

### Motion
- New note arrives with a carbon-soft tint fading over 1.5s.
- Sheets slide up 220ms ease-out; switcher list fades/scales 150ms.
- Respect prefers-reduced-motion (no motion).

## Constraints
- Accessibility first (the font choice is deliberate): WCAG AA contrast, visible focus ring (2px carbon), labels on every icon-only control.
- Read-only pages must never show the feed's name.
- Forms keep working without JavaScript on the server-rendered pages; sheets are progressive enhancement.
- Mobile-first; content column max 640px on desktop.
