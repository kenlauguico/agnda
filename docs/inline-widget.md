# AGNDA inline widget (provider contract v1)

AGNDA serves the widget from its normal app origin. It reads the user's existing saved agenda and does not edit the embedding page or its markdown.

## URL

Use the root URL with `embed=1` and an encoded saved slug or saved AGNDA URL:

```text
https://agnda.example/?embed=1&agenda=weekly-sync&parentOrigin=https%3A%2F%2Fnotes.example
https://agnda.example/?embed=1&agenda=https%3A%2F%2Fagnda.example%2F%23weekly-sync&parentOrigin=https%3A%2F%2Fnotes.example
```

`agenda` accepts a slug (`weekly-sync`), hash (`#weekly-sync`, `#v2/...`, `#v3/...`, or a legacy slash hash), or a complete saved URL. Encode hashes and URLs as query parameter values. A URL from an older AGNDA host is accepted only when that exact URL is present in the saved library. The embed URL remains stable as the saved agenda changes. AGNDA requires the agenda to exist in its local saved library; a share hash alone is not treated as an already saved agenda.

The default `view` is `capture`. `view=time` and `view=progress` select compact initial views. The parent can cycle `capture → time → progress → capture` with Option-click by sending `set-view`; Option-click inside the widget also cycles. The widget handles its own note capture and duration slider.

## Allowed parent origin

Set the comma-separated build variable before building AGNDA:

```text
VITE_WIDGET_ALLOWED_ORIGINS=https://notes.example,https://notes-staging.example
```

The iframe URL must include `parentOrigin` with **one exact origin from that list**. AGNDA accepts commands only when `event.origin` equals that origin and `event.source` is the immediate parent window. It sends every message using that exact target origin; it never sends to `*`. With no configured match, the widget remains visible but messaging is disabled and it shows a link to open AGNDA.

The widget needs access to the same AGNDA local storage as the saved agenda. Browsers may block or partition storage in an iframe. If storage cannot be written, or the saved agenda is unavailable in that storage context, the widget shows an **Open agenda in AGNDA** link. The parent should preserve that link and offer a normal AGNDA navigation path. There is no server-side data sync in this contract.

AGNDA hosting must permit framing by the configured Notes origin (for example, via an appropriate `frame-ancestors` policy). This repository does not change hosting headers; verify them during the separate deployment step.

## Messages

All messages are plain objects:

```js
{
  channel: 'agnda.widget',
  version: 1,
  type: 'set-view',
  requestId: 'notes-42',
  payload: { view: 'progress' }
}
```

Parent commands:

| `type` | `payload` | Result |
| --- | --- | --- |
| `get-snapshot` | `{}` | Current reconciled timer snapshot |
| `set-view` | `{ view: 'capture' \| 'time' \| 'progress' }` | Changes visible view |
| `adjust-duration` | `{ topicId: string, seconds: integer }` | Saves total duration; elapsed stays unchanged |
| `save-note` | `{ topicId: string, text: string }` | Captures a note at the current clock |

`topicId` must identify one of the current active topics. This is required when two topics are active and prevents ambiguous captures. Duration must be 30 seconds to 24 hours. Note text is trimmed and limited to 4000 characters. Invalid or unknown commands from the trusted parent receive an error response. Messages from other origins or windows are ignored.

Every command receives a response with the **same** `requestId`:

```js
{ channel: 'agnda.widget', version: 1, type: 'response', requestId: 'notes-42', ok: true, payload: { view: 'progress' } }
{ channel: 'agnda.widget', version: 1, type: 'response', requestId: 'notes-43', ok: false, payload: { error: 'invalid_payload' } }
```

AGNDA emits these events with its own `widget-N` request IDs and `ok: true`:

| `type` | `payload` |
| --- | --- |
| `ready` | `{ view, views, agendaId, available, snapshot }` |
| `snapshot` | Timer snapshot; emitted when the clock or active data changes |
| `view-change` | `{ view }` |
| `duration-adjustment` | `{ topicId, seconds, elapsed }` |
| `note-save` | `{ note }` |
| `height-change` | `{ height }` in CSS pixels |

The snapshot contains `agendaId`, `sourceHash`, `title`, `isRunning`, `completed`, `capturedAt` (ISO instant), `primaryTopicId`, `secondaryTopicId`, and a `topics` array. Each topic has `id`, `name`, `seconds`, `elapsed`, `remaining`, `progress` (0–1), `noteCount`, `notes` (each with `id`, `text`, `offsetSeconds`), and `active`. The widget reconciles the saved session against the current clock on load, refresh, and capture. Pausing, resuming, advancing, completion, and simultaneous primary and secondary topics use AGNDA's existing session rules.

Each saved widget note remains inside its v3 topic record and includes `id`, `text`, `agendaId`, `topicId`, `capturedAt` (ISO instant), `timeZone` (local IANA zone), and `offsetSeconds`. Old notes and legacy migrations remain readable. Changing duration updates only `seconds`, leaving `elapsed` and note offsets alone.

## Parent responsibilities

1. Recognize an AGNDA URL and render it as an iframe. Do not ask AGNDA to write to the parent document.
2. Build the iframe URL with the saved agenda target and the parent's exact origin. Set a sensible initial height, then apply `height-change` as note previews, the composer, and two-topic layouts expand.
3. Check `event.origin` against the AGNDA origin, check `event.source === iframe.contentWindow`, and check `channel` and `version` before using any widget message.
4. Generate unique request IDs for commands. Match `response` messages by ID and handle both `ok: true` and `ok: false`.
5. On Option-click, send `set-view` with the next view. Keep the iframe's own Option-click behavior as a fallback.
6. Use `ready` to learn availability and `snapshot` for live state. Preserve the widget's AGNDA link when embedded storage is unavailable.

Example parent command:

```js
iframe.contentWindow.postMessage(
  { channel: 'agnda.widget', version: 1, type: 'set-view', requestId: crypto.randomUUID(), payload: { view: 'time' } },
  'https://agnda.example',
);
```

The widget uses restrained motion and disables transitions and animation under `prefers-reduced-motion: reduce`.
