# AGNDA

AGNDA is a lightweight agenda web app for timed conversations, solo work sessions, and quick meeting capture.

This README is intentionally both product documentation and implementation guidance. Future runs through Codex, Antigravity, Claude, or any other agent should treat this file as the current contract for the app.

## Product Direction

- Simplicity first. The UI should feel direct, bright, and fast.
- Montserrat is the primary font.
- Black text carries the interface; color is used for emphasis, timing, and pastel tags.
- Layout should prefer columns on large screens and collapse cleanly to stacked cards on mobile.
- The interaction model should feel closer to SwiftUI than to a dense admin dashboard.

## Current Shape

The app is organized into three primary areas:

1. Left column
   Shows `AGNDA`, today’s date, the editable agenda title, the add-topic input, and session controls.
2. Middle column
   Shows agenda topic cards with a rounded vertical rail, tag chip, shorthand duration, title, and a progress line.
3. Right column
   Shows the selected topic with editable title, tag selector, duration selector, notes, derived action items, and the `Revisit` / `Mark as addressed` actions.

There is also a persistent menu icon that opens a drawer of saved agenda hashes. Each saved card shows the gray hash first and the first topic beneath it.

## Storage Rules

The modern app persists agendas in local storage and must continue loading older AGNDA saved data.

What must keep working:

- legacy URL-based localStorage entries from earlier AGNDA builds
- older global keys such as `agnda:state`, `agnda-state`, `agenda-state`, and `agnda:state:v2`
- older topic records using fields like `currentNumber` and `autoTopic`

Modern storage behavior:

- current schema version is `3`
- the active agenda is mirrored to `agnda:state:v3`
- each named agenda is also stored under `agnda:agenda:<slug>`
- saved-agenda drawer metadata is stored in `agnda:library:v1`
- notes live inside each topic record so load/save stays immediate and local

## Hash Behavior

Hashes now serve two jobs:

- simple saved agenda ids such as `#weekly-sync`
- imported/shared agendas from old formats like `#25/Intro/Build` and `#v2/...`

When an agenda title changes, the app updates the hash slug so the URL remains memorable on the next visit.

## Notes And Actions

- Notes are captured per topic.
- Pressing Enter on the notes input creates a note bubble stamped with shorthand elapsed time from that topic.
- Action Items are derived from markdown todos found in notes.
- Supported todo shapes include `- [ ]`, `[]`, `-[ ]`, `-[]`, and checked versions with `x`.
- Toggling an action item updates the source note text, not a separate duplicate store.

## Quick Start

```bash
npm install
npm run dev
```

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm run test
```

## Implementation Notes

- Keep the app dependency-light.
- Prefer local-first persistence over remote services.
- If adding new features, preserve the current storage migration path instead of replacing it.
- If the UI changes, keep the menu drawer, column-first structure, bright palette, and note-to-action-item relationship intact unless the product direction here is updated first.
