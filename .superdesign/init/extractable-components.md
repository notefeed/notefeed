# Extractable components

## Layout Components

## Header
- Source: `components/Header.tsx`
- Category: layout
- Description: Top bar with optional feed image, breadcrumb (logo + "notefeed" › feed name) and icon actions (Read-only, RSS, Settings, Log out)
- Extractable props: feedName (string, default: ""), showReadOnly (boolean, default: true), showRss (boolean, default: true), showSettings (boolean, default: true), showLogout (boolean, default: false)
- Hardcoded: logo (/icon.svg → Brand Asset), lucide icons Eye/Rss/Settings/LogOut/ChevronRight, labels, all CSS

## Footer
- Source: `app/layout.tsx` (footer element)
- Category: layout
- Description: Text links: Docs, GitHub, Imprint, Data privacy, Terms, License
- Extractable props: none
- Hardcoded: link labels and URLs, CSS

## Basic Components

## CopyButton
- Source: `components/CopyButton.tsx`
- Category: basic
- Description: Outline button with Copy icon and label
- Extractable props: none

## NoteItem
- Source: `components/NoteList.tsx` (list item)
- Category: basic
- Description: One note in the list: time column, title link, sender, tag chips, Report link, markdown body
- Extractable props: none (content varies per instance)

## MarkdownInput
- Source: `components/MarkdownInput.tsx`
- Category: basic
- Description: Write/Preview tabs, textarea, image chips, toolbar row with Add image
- Extractable props: activeTab (string, default: "write")
