# Pages — dependency trees

Every page also uses `app/layout.tsx` and `app/globals.css`. `@/backend`, `@/shared/*` and `app/_lib/*` are logic (no UI) and are omitted.

## /[feed] (Feed page — posting and reading)
Entry: app/[feed]/page.tsx
Dependencies:
- components/Header.tsx
- components/Compose.tsx
  - components/MarkdownInput.tsx
    - components/NoteView.tsx
    - components/pendingFiles.ts (logic)
  - components/usePendingImages.ts (logic)
- components/NoteList.tsx (NoteList, TagFilter)
  - components/NoteView.tsx
- components/UnlockForm.tsx (locked branch)
- components/Removed.tsx (removed branch)

## /[feed]/settings (Feed settings)
Entry: app/[feed]/settings/page.tsx
Dependencies:
- components/Header.tsx
- components/styles.ts
- components/FeedDetails.tsx
- components/CopyButton.tsx
- components/LicenseSection.tsx
- components/FeedSettings.tsx

## /[feed]/[id] (Single note, writable)
Entry: app/[feed]/[id]/page.tsx
Dependencies:
- components/Header.tsx
- components/NoteList.tsx (NoteArticle)
  - components/NoteView.tsx
- components/NoteActions.tsx
  - components/MarkdownInput.tsx
    - components/NoteView.tsx

## / (Home)
Entry: app/page.tsx
Dependencies:
- components/Header.tsx
- components/OpenFeed.tsx
- components/NoteView.tsx

## /r/[readId] (Read-only feed)
Entry: app/r/[readId]/page.tsx
Dependencies:
- components/Header.tsx
- components/NoteList.tsx
  - components/NoteView.tsx
- components/Removed.tsx

## /license
Entry: app/license/page.tsx
Dependencies:
- components/BuyLicense.tsx
  - components/CopyButton.tsx
