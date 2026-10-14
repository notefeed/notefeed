# Routes

Next.js App Router, file-based. All pages share `app/layout.tsx` (centered 68ch column + footer). Each page renders `components/Header.tsx` itself.

| URL | File | What it renders |
|---|---|---|
| `/` | `app/page.tsx` | Home: Header, optional operator notice, one explanatory paragraph, OpenFeed form (feed name + Open). |
| `/[feed]` | `app/[feed]/page.tsx` | Feed page (writable): Header with Read-only/RSS/Settings/Log out actions, feed title + description, Compose box, optional TagFilter, NoteList grouped by day (or empty state with a curl example). Locked feed → UnlockForm; removed → Removed. |
| `/[feed]/[id]` | `app/[feed]/[id]/page.tsx` | Single note (writable): Header, NoteArticle (time, sender, tags, Report, body), NoteActions (Edit / Delete disclosures). |
| `/[feed]/settings` | `app/[feed]/settings/page.tsx` | Feed settings: Header, "Feed settings" h1, FeedDetails (General form, title image), Read link + copy, Post from a script (curl), LicenseSection, FeedSettings (password), Delete feed. |
| `/r/[readId]` | `app/r/[readId]/page.tsx` | Read-only feed view (public, never shows feed name): Header with RSS only, title/description, NoteList. |
| `/r/[readId]/[id]` | `app/r/[readId]/[id]/page.tsx` | Read-only single note. |
| `/license` | `app/license/page.tsx` | BuyLicense: comparison table, Buy button, key display after purchase, manage subscription by key. |
| `/login` | `app/login/page.tsx` | Instance login (locked instances). |
| `/oauth/authorize` | `app/oauth/authorize/page.tsx` | OAuth consent for MCP clients. |
| `/report` | `app/report/page.tsx` | Report a note form. |
| `/imprint`, `/privacy`, `/terms` | `app/*/page.tsx` → `components/LegalPage.tsx` | Operator markdown. |

Key pages for design: `/[feed]` (posting + reading), `/[feed]/settings`, `/[feed]/[id]`, `/`, `/r/[readId]`, `/license`.

Product concepts: a *feed* is a named list of markdown notes; anyone who knows the name can read and post. The *read link* `/r/<readId>` and its RSS show notes without the name. Optional feed password (licensed feeds), title image, tags, images in notes, sender display. No user accounts.
