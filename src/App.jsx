import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { buildAgendaHash, humanizeAgendaId, normalizeAgendaId, parseAgendaHash } from './lib/hashAgenda';
import { advanceSessionBySeconds } from './lib/session';
import {
  buildInitialState,
  deleteSavedAgenda,
  listSavedAgendas,
  loadInitialState,
  loadSavedAgenda,
  saveState,
} from './lib/storage';
import {
  DEFAULT_TOPICS,
  TEMPLATE_PRESETS,
  TOPIC_DURATION_OPTIONS,
  TOPIC_TAGS,
  createTopicFromMinutes,
  instantiateTopics,
  makeEntityId,
  reorderTopics,
} from './lib/topics';
import {
  clampIndex,
  formatClock,
  formatMinuteSecond,
  formatShortDuration,
  parseLooseDuration,
} from './lib/time';
import {
  formatAgendaMarkdown,
  formatTopicMarkdown,
  writeTextToClipboard,
} from './lib/agendaMarkdown';
import { getTopicFaviconHref, setDocumentFavicon } from './lib/favicon';
import { mergeWidgetChanges } from './lib/widget';
import './styles.css';
import './thin-line.css';

const TODO_PATTERN = /^\s*(?:-\s*)?\[\s*([xX]?)\s*\]\s*(.+)$/;
const URL_PATTERN = /https?:\/\/[^\s]+/g;
const THEME_STORAGE_KEY = 'agnda:visual-theme:v2';
const MINI_MODE_MAX_WIDTH = 820;
const MINI_MODE_MAX_HEIGHT = 680;
const MOBILE_LAYOUT_MAX_WIDTH = 720;
const THEME_OPTIONS = [
  {
    id: 'thin-line',
    name: 'Thin-Line',
    icon: '▦',
    description: 'Monochrome tools with one orange accent for active progress.',
  },
  {
    id: 'vibrant',
    name: 'Vibrant Design',
    icon: '✦',
    description: 'Rich aesthetics with heavy progress language and circular visuals.',
  },
  {
    id: 'minimal',
    name: 'Minimal Focus',
    icon: '·',
    description: 'Clean, pixel-thin lines and subtle wayfinding.',
  },
];

function resolveThemeId(candidate) {
  return THEME_OPTIONS.some((theme) => theme.id === candidate)
    ? candidate
    : THEME_OPTIONS[0].id;
}

function detectMiniMode(viewport = globalThis.window) {
  if (!viewport) {
    return false;
  }

  const width = Number(viewport.innerWidth);
  const height = Number(viewport.innerHeight);

  return (
    (Number.isFinite(width) && width > 0 && width <= MINI_MODE_MAX_WIDTH) ||
    (Number.isFinite(height) && height > 0 && height <= MINI_MODE_MAX_HEIGHT)
  );
}

function detectMobileViewport(viewport = globalThis.window) {
  if (!viewport) {
    return false;
  }

  const width = Number(viewport.innerWidth);
  return Number.isFinite(width) && width > 0 && width <= MOBILE_LAYOUT_MAX_WIDTH;
}

function getVisualViewportInset(viewport = globalThis.window) {
  if (!viewport) {
    return 0;
  }

  const layoutHeight = Number(viewport.innerHeight);
  const visualViewport = viewport.visualViewport;
  if (!Number.isFinite(layoutHeight) || !visualViewport) {
    return 0;
  }

  const visualHeight = Number(visualViewport.height);
  const visualTop = Number(visualViewport.offsetTop);
  if (!Number.isFinite(visualHeight) || !Number.isFinite(visualTop)) {
    return 0;
  }

  return Math.max(0, Math.round(layoutHeight - visualHeight - visualTop));
}

function formatLongDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function formatMonthDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function formatEstimatedCompletion(date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function getTopicProgress(topic) {
  if (!topic || topic.seconds <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (topic.elapsed / topic.seconds) * 100));
}

function getNoteMarkerOffset(topic, note) {
  if (!topic || topic.seconds <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (note.offsetSeconds / topic.seconds) * 100));
}

function getTagMeta(tagId) {
  return TOPIC_TAGS.find((tag) => tag.id === tagId) ?? null;
}

function parseActionItems(notes) {
  if (!Array.isArray(notes)) {
    return [];
  }

  return notes.flatMap((note) => {
    const match = typeof note?.text === 'string' ? note.text.match(TODO_PATTERN) : null;
    if (!match) {
      return [];
    }

    return [
      {
        noteId: note.id,
        checked: match[1].toLowerCase() === 'x',
        label: match[2].trim(),
      },
    ];
  });
}

function buildActionGroups(topics) {
  if (!Array.isArray(topics)) {
    return [];
  }

  return topics
    .map((topic) => {
      const items = parseActionItems(topic?.notes);
      if (!items.length) {
        return null;
      }

      return {
        topicId: topic.id,
        topicName: topic.name,
        items,
      };
    })
    .filter(Boolean);
}

function toggleActionText(text, checked) {
  const match = typeof text === 'string' ? text.match(TODO_PATTERN) : null;
  if (!match) {
    return text;
  }

  return `- [${checked ? 'x' : ' '}] ${match[2].trim()}`;
}

function splitTrailingPunctuation(candidate) {
  if (typeof candidate !== 'string') {
    return { url: '', trailing: '' };
  }

  const match = candidate.match(/^(.*?)([.,!?;:)\]]*)$/);
  if (!match) {
    return { url: candidate, trailing: '' };
  }

  return {
    url: match[1],
    trailing: match[2],
  };
}

function renderNoteText(text) {
  if (typeof text !== 'string' || !text.length) {
    return text;
  }

  const parts = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const rawUrl = match[0];
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex));
    }

    const { url, trailing } = splitTrailingPunctuation(rawUrl);

    if (url) {
      parts.push(
        <a
          key={`${url}-${matchIndex}`}
          className="note-link"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          {url}
        </a>,
      );
    }

    if (trailing) {
      parts.push(trailing);
    }

    lastIndex = matchIndex + rawUrl.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length ? parts : text;
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function hasMeaningfulDocumentSelection(
  viewport = globalThis.window,
  documentRef = globalThis.document,
) {
  if (!documentRef) {
    return false;
  }

  const activeElement = documentRef.activeElement;
  if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
    const { selectionStart, selectionEnd } = activeElement;
    if (
      Number.isInteger(selectionStart) &&
      Number.isInteger(selectionEnd) &&
      selectionEnd > selectionStart
    ) {
      return true;
    }
  }

  const selection = viewport?.getSelection?.() ?? documentRef.getSelection?.();
  return Boolean(selection?.toString());
}

function activateTopicInState(previous, topicId) {
  const nextIndex = previous.topics.findIndex((topic) => topic.id === topicId);
  if (nextIndex < 0) {
    return previous;
  }

  // If this topic is already active as the secondary topic, clear it from secondary track
  const nextSecondaryIndex = nextIndex === previous.secondaryIndex ? -1 : previous.secondaryIndex;
  const nextSecondaryTopicId = nextIndex === previous.secondaryIndex ? null : previous.secondaryTopicId;

  return {
    ...previous,
    currentIndex: nextIndex,
    selectedTopicId: topicId,
    secondaryIndex: nextSecondaryIndex,
    secondaryTopicId: nextSecondaryTopicId,
    isRunning: true,
    topics: previous.topics.map((topic) =>
      topic.id === topicId ? { ...topic, addressed: false } : topic,
    ),
  };
}

function activateSecondaryTopicInState(previous, topicId) {
  const nextSecondaryIndex = previous.topics.findIndex((topic) => topic.id === topicId);
  if (nextSecondaryIndex < 0) {
    return previous;
  }

  // If this topic is currently the primary topic, we can't also make it secondary. 
  // We'll just do nothing, or maybe swap them? Just return previous.
  if (nextSecondaryIndex === previous.currentIndex) {
    return previous;
  }

  return {
    ...previous,
    secondaryIndex: nextSecondaryIndex,
    secondaryTopicId: topicId,
    isRunning: true,
    topics: previous.topics.map((topic) =>
      topic.id === topicId ? { ...topic, addressed: false } : topic,
    ),
  };
}

function activateTopicManually(previous, topicId) {
  const nextState = activateTopicInState(previous, topicId);
  if (nextState === previous) {
    return previous;
  }

  return {
    ...nextState,
    autoAdvance: false,
  };
}

function activateSecondaryTopicManually(previous, topicId) {
  const nextState = activateSecondaryTopicInState(previous, topicId);
  if (nextState === previous) {
    return previous;
  }

  return {
    ...nextState,
    autoAdvance: false,
  };
}

function findNextOpenTopicIndex(topics, startIndex) {
  if (!Array.isArray(topics) || !topics.length) {
    return -1;
  }

  for (let index = startIndex + 1; index < topics.length; index += 1) {
    if (!topics[index]?.addressed) {
      return index;
    }
  }

  return -1;
}

function appendTopicWithoutInterrupting(previous, nextTopic) {
  const nextTopics = [...previous.topics, nextTopic];

  if (previous.isRunning) {
    return {
      ...previous,
      topics: nextTopics,
    };
  }

  return {
    ...previous,
    topics: nextTopics,
    currentIndex: previous.topics.length,
    selectedTopicId: nextTopic.id,
  };
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 20h4.5L19 9.5 14.5 5 4 15.5V20zm12-16 4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 7h14m-9 0V4h4v3m-7 0 1 12h8l1-12M10 11v5m4-5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon({ expanded = false }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={expanded ? 'M7 14l5-5 5 5' : 'M7 10l5 5 5-5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EllipsisIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="18" cy="12" r="1.7" fill="currentColor" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowIcon({ direction = 'right' }) {
  const path = direction === 'left' ? 'M14 6l-6 6 6 6' : 'M10 6l6 6-6 6';

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayPauseIcon({ isRunning }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {isRunning ? (
        <path
          d="M8 6v12M16 6v12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path d="M9 7.5 17 12l-8 4.5z" fill="currentColor" />
      )}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 12.5 10 17l9-10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 7l10 10M17 7 7 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 8.1h.01M10.9 11.4H12v4.5h1.1M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 15.5h12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4.2 8.1a8 8 0 1 1-1.2 7.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 4.5V8.5H7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TaskListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 7h10M9 12h10M9 17h10M4.5 7h.01M4.5 12h.01M4.5 17h.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MobileCopyMenu({
  buttonRef,
  menuRef,
  copied = false,
  isOpen = false,
  menuId,
  buttonLabel,
  actionLabel,
  onToggle,
  onAction,
}) {
  return (
    <div className="mobile-copy-menu">
      {copied ? (
        <span className="mobile-copy-menu__feedback" role="status" aria-live="polite">
          Copied
        </span>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        className="mobile-copy-menu__button"
        aria-label={buttonLabel}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={isOpen ? menuId : undefined}
        title={buttonLabel}
        onClick={onToggle}
      >
        <EllipsisIcon />
      </button>
      {isOpen ? (
        <div ref={menuRef} id={menuId} className="mobile-copy-menu__popover" role="menu">
          <button
            type="button"
            className="mobile-copy-menu__item"
            role="menuitem"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AgendaActionsPanel({
  actionGroups,
  completedActionItemCount,
  isExpanded,
  onSelectTopic,
  onToggleActionItemForTopic,
  onToggleExpanded,
  openActionItemCount,
  totalActionItemCount,
}) {
  return (
    <section
      className={`panel agenda-actions-panel${isExpanded ? ' is-expanded' : ''}`}
      aria-label="Agenda action items"
    >
      <div className="section-header section-header--compact agenda-actions-panel__header">
        <div>
          <p>Action Items</p>
          <h2>Agenda queue</h2>
        </div>
        <div className="agenda-actions-panel__header-controls">
          <strong>{totalActionItemCount}</strong>
          <button
            type="button"
            className="agenda-actions-toggle"
            aria-expanded={isExpanded}
            aria-controls="agenda-actions-content"
            aria-label={isExpanded ? 'Collapse action items' : 'Expand action items'}
            onClick={onToggleExpanded}
          >
            <ChevronIcon expanded={isExpanded} />
          </button>
        </div>
      </div>

      <p className="agenda-actions-summary">
        {openActionItemCount} open / {completedActionItemCount} done
      </p>

      {isExpanded ? (
        actionGroups.length ? (
          <div id="agenda-actions-content" className="agenda-action-groups">
            {actionGroups.map((group) => (
              <section key={group.topicId} className="agenda-action-group">
                <button
                  type="button"
                  className="agenda-action-group__topic"
                  onClick={() => onSelectTopic(group.topicId)}
                >
                  {group.topicName}
                </button>
                <div className="agenda-action-group__items">
                  {group.items.map((action) => (
                    <label key={action.noteId} className="action-item">
                      <input
                        type="checkbox"
                        checked={action.checked}
                        onChange={(event) =>
                          onToggleActionItemForTopic(
                            group.topicId,
                            action.noteId,
                            event.target.checked,
                          )
                        }
                      />
                      <span>{action.label}</span>
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <p id="agenda-actions-content" className="empty-copy">
            No action items yet across this agenda.
          </p>
        )
      ) : null}
    </section>
  );
}

function ProgressVisual({ percent, themeId, type = 'bar', size = 48 }) {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  if (type === 'circular') {
    return (
      <div className={`progress-circular theme-${themeId}`} style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            className="progress-circular__track"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth="3"
          />
          <circle
            className="progress-circular__fill"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
      </div>
    );
  }

  return (
    <div className={`progress-bar theme-${themeId}`}>
      <div className="progress-bar__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

function TopicProgressTrack({
  topic,
  notes = null,
  themeId,
  hoveredNoteId,
  onHoverNote,
  onLeaveNote,
  previewedNoteId = null,
  justSavedNoteId = null,
  isActive = false,
  isRunning = false,
  activeElapsed = 0,
  className = 'topic-card__progress',
  hideNotes = false,
  showTooltips = true,
}) {
  if (!topic) {
    return null;
  }

  const noteList = Array.isArray(notes) ? notes : topic.notes;

  const aboveLevels = [];
  const belowLevels = [];
  
  const stackedNotes = noteList.map((note, noteIndex) => {
    const offset = getNoteMarkerOffset(topic, note);
    const side = noteIndex % 2 === 0 ? 'above' : 'below';

    const isPassing =
      isActive &&
      isRunning &&
      activeElapsed >= note.offsetSeconds &&
      activeElapsed < note.offsetSeconds + 8;
    const isHighlighted =
      hoveredNoteId === note.id || previewedNoteId === note.id || isPassing;
    const isJustSaved = justSavedNoteId === note.id;

    const isVisibleTooltip = isHighlighted || isJustSaved;
    
    let stackLevel = 0;
    if (isVisibleTooltip) {
      const levels = side === 'above' ? aboveLevels : belowLevels;
      while (
        stackLevel < levels.length &&
        levels[stackLevel] !== undefined &&
        Math.abs(offset - levels[stackLevel]) < 3.5
      ) {
        stackLevel++;
      }
      levels[stackLevel] = offset;
    }

    return { note, noteIndex, offset, side, stackLevel, isPassing, isHighlighted, isJustSaved };
  });

  return (
    <div className={className} aria-hidden="true">
      {!hideNotes ? (
        <span className="topic-card__progress-notes">
          {stackedNotes.map(({ note, noteIndex, offset, side, stackLevel, isPassing, isHighlighted, isJustSaved }) => {
            const noteEdge = offset <= 16 ? 'start' : offset >= 84 ? 'end' : 'center';
            const stackOffset = side === 'above' ? stackLevel * -42 : stackLevel * 42;

            return (
              <span
                key={note.id}
                className={`topic-card__progress-note${isHighlighted ? ' is-highlighted' : ''}${isPassing ? ' is-passing' : ''}${isJustSaved ? ' is-just-saved' : ''
                  }`}
                data-note-side={side}
                data-note-edge={noteEdge}
                style={{ left: `${offset}%`, '--stack-offset': `${stackOffset}px` }}
                onMouseEnter={() => onHoverNote(note.id)}
                onMouseLeave={() => onLeaveNote(note.id)}
              >
                <span className="topic-card__progress-note-number">{noteIndex + 1}</span>
                {showTooltips ? <span className="topic-card__progress-tooltip">{note.text}</span> : null}
              </span>
            );
          })}
        </span>
      ) : null}
      <ProgressVisual percent={getTopicProgress(topic)} themeId={themeId} type="bar" />
    </div>
  );
}

function FocusAgendaRing({
  topics,
  currentIndex,
  sessionProgressPercent,
  remainingSessionSeconds,
  totalSeconds,
  isRunning,
  isMiniMode = false,
  compact = false,
  progressOutside = false,
  className = 'focus-agenda-ring',
}) {
  const size = 164;
  const radius = 70;
  const outerRadius = radius;
  const innerRadius = radius - 11;
  const segmentRadius = progressOutside ? innerRadius : outerRadius;
  const progressRadius = progressOutside ? outerRadius : innerRadius;
  const segmentStrokeWidth = progressOutside ? 4.5 : 6;
  const progressStrokeWidth = progressOutside ? 6 : 2.5;
  const trackStrokeWidth = progressOutside ? 6 : 6;
  const circumference = 2 * Math.PI * segmentRadius;
  const gap = topics.length > 1 ? 7 : 0;
  const isCondensed = compact || isMiniMode;
  const totalDuration = Math.max(
    1,
    topics.reduce((sum, topic) => sum + Math.max(1, topic.seconds), 0),
  );
  const statusLabel = isCondensed
    ? isRunning
      ? 'Live'
      : 'Paused'
    : isRunning
      ? 'Agnda live'
      : 'Agnda paused';
  const detailLabel = isCondensed
    ? `${topics.length} topics`
    : `${formatShortDuration(totalSeconds)} total`;
  const usableCircumference = Math.max(circumference - gap * topics.length, circumference * 0.66);
  let consumed = 0;

  const segments = topics.map((topic, index) => {
    const rawLength = usableCircumference * (Math.max(1, topic.seconds) / totalDuration);
    const segmentLength = Math.max(rawLength, 10);
    const segment = {
      id: topic.id,
      className:
        index === currentIndex
          ? 'is-active'
          : topic.addressed || index < currentIndex
            ? 'is-complete'
            : 'is-upcoming',
      dasharray: `${segmentLength} ${circumference - segmentLength}`,
      dashoffset: -consumed,
    };

    consumed += segmentLength + gap;
    return segment;
  });

  return (
    <div
      className={`${className}${isCondensed ? ' is-condensed' : ''}`}
      role="img"
      aria-label={`Agenda progress ${Math.round(sessionProgressPercent)} percent complete`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="focus-agenda-ring__track"
          cx={size / 2}
          cy={size / 2}
          r={progressRadius}
          fill="none"
          strokeWidth={trackStrokeWidth}
        />
        <circle
          className="focus-agenda-ring__progress"
          cx={size / 2}
          cy={size / 2}
          r={progressRadius}
          fill="none"
          strokeWidth={progressStrokeWidth}
          strokeDasharray={2 * Math.PI * progressRadius}
          strokeDashoffset={2 * Math.PI * progressRadius - (sessionProgressPercent / 100) * 2 * Math.PI * progressRadius}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {segments.map((segment) => (
          <circle
            key={segment.id}
            className={`focus-agenda-ring__segment ${segment.className}`}
            cx={size / 2}
            cy={size / 2}
            r={segmentRadius}
            fill="none"
            strokeWidth={segmentStrokeWidth}
            strokeLinecap="round"
            strokeDasharray={segment.dasharray}
            strokeDashoffset={segment.dashoffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ))}
      </svg>
      <div className="focus-agenda-ring__center">
        <span>{statusLabel}</span>
        <strong>{formatShortDuration(remainingSessionSeconds)}</strong>
        <small>{detailLabel}</small>
      </div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState(() => loadInitialState());
  const [themeId, setThemeId] = useState(() => {
    if (!globalThis.window) {
      return THEME_OPTIONS[0].id;
    }

    return resolveThemeId(window.localStorage.getItem(THEME_STORAGE_KEY));
  });
  const [savedAgendas, setSavedAgendas] = useState(() => listSavedAgendas());
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isAgendaActionsExpanded, setIsAgendaActionsExpanded] = useState(false);
  const [isAgendaInfoOpen, setIsAgendaInfoOpen] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [durationDraft, setDurationDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [isFocusNoteComposerOpen, setIsFocusNoteComposerOpen] = useState(false);
  const [previewedNoteId, setPreviewedNoteId] = useState(null);
  const [hoveredNoteId, setHoveredNoteId] = useState(null);
  const [justSavedNoteId, setJustSavedNoteId] = useState(null);
  const [dragState, setDragState] = useState(null);

  useEffect(() => {
    if (!justSavedNoteId) {
      return;
    }

    const timeout = setTimeout(() => {
      setJustSavedNoteId(null);
    }, 1000);

    return () => clearTimeout(timeout);
  }, [justSavedNoteId]);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isFocusTaskPanelOpen, setIsFocusTaskPanelOpen] = useState(false);
  const [isFocusControlsAuxVisible, setIsFocusControlsAuxVisible] = useState(false);
  const [isMiniMode, setIsMiniMode] = useState(() => detectMiniMode());
  const [isMobileViewport, setIsMobileViewport] = useState(() => detectMobileViewport());
  const [isMiniModeDismissed, setIsMiniModeDismissed] = useState(false);
  const [isSessionPanelMinimized, setIsSessionPanelMinimized] = useState(false);
  const [isFocusNoteInputFocused, setIsFocusNoteInputFocused] = useState(false);
  const [focusNoteKeyboardInset, setFocusNoteKeyboardInset] = useState(0);
  const [openMobileCopyMenu, setOpenMobileCopyMenu] = useState(null);
  const [copiedMobileCopyScope, setCopiedMobileCopyScope] = useState(null);

  const appShellRef = useRef(null);
  const tickerRef = useRef({ intervalId: null, lastTickMs: Date.now() });
  const renamedAgendaIdRef = useRef('');
  const agendaInfoButtonRef = useRef(null);
  const agendaInfoPopoverRef = useRef(null);
  const topicsCopyButtonRef = useRef(null);
  const topicsCopyMenuRef = useRef(null);
  const detailCopyButtonRef = useRef(null);
  const detailCopyMenuRef = useRef(null);
  const agendaTitleInputRef = useRef(null);
  const addTopicInputRef = useRef(null);
  const noteInputRef = useRef(null);
  const detailHeaderRef = useRef(null);
  const notePreviewTimeoutRef = useRef(null);
  const focusControlsHideTimeoutRef = useRef(null);
  const mobileCopyFeedbackTimeoutRef = useRef(null);
  const noteDraftRef = useRef('');
  const draftNoteIdRef = useRef(null);
  const noteDraftOffsetRef = useRef(null);
  const pendingNoteCaptureRef = useRef(null);
  const pendingDetailScrollTopicIdRef = useRef(null);
  const shouldAutoScrollRestoredRunningRef = useRef(state.isRunning);

  const topics = state.topics;
  const currentIndex = clampIndex(state.currentIndex, topics.length);
  const activeTopic = topics[currentIndex] ?? null;
  const selectedTopic =
    topics.find((topic) => topic.id === state.selectedTopicId) ?? activeTopic ?? null;
  const totalSeconds = topics.reduce((sum, topic) => sum + topic.seconds, 0);
  const totalElapsed = topics.reduce((sum, topic) => sum + topic.elapsed, 0);
  const remainingSessionSeconds = Math.max(0, totalSeconds - totalElapsed);
  const estimatedCompletionSeconds = topics.reduce((sum, topic) => {
    if (topic.addressed) {
      return sum;
    }

    return sum + Math.max(0, topic.seconds - topic.elapsed);
  }, 0);
  const estimatedCompletionLabel = formatEstimatedCompletion(
    new Date(Date.now() + estimatedCompletionSeconds * 1000),
  );
  const actionItems = parseActionItems(selectedTopic?.notes);
  const actionGroups = buildActionGroups(topics);
  const totalActionItemCount = actionGroups.reduce((sum, group) => sum + group.items.length, 0);
  const completedActionItemCount = actionGroups.reduce(
    (sum, group) => sum + group.items.filter((item) => item.checked).length,
    0,
  );
  const openActionItemCount = totalActionItemCount - completedActionItemCount;
  const todayLabel = formatLongDate();
  const notePlaceholderDate = formatMonthDay();
  const agendaDisplayName = state.title.trim() || humanizeAgendaId(state.agendaId);
  const currentAgendaIdentity = state.sourceHash || buildAgendaHash(state.agendaId);
  const currentAgendaCard = {
    agendaId: state.agendaId,
    hash: currentAgendaIdentity,
    target: currentAgendaIdentity,
    firstTopic: topics[0]?.name ?? state.title,
  };
  const previousSavedAgendas = savedAgendas.filter((agenda) => {
    const agendaIdentity =
      agenda.identityKey ?? agenda.sourceHash ?? agenda.target ?? agenda.hash ?? agenda.agendaId;

    return !(agenda.agendaId === state.agendaId && agendaIdentity === currentAgendaIdentity);
  });
  const durationOptions =
    selectedTopic && !TOPIC_DURATION_OPTIONS.some((option) => option.seconds === selectedTopic.seconds)
      ? [{ label: formatShortDuration(selectedTopic.seconds), seconds: selectedTopic.seconds }].concat(
        TOPIC_DURATION_OPTIONS,
      )
      : TOPIC_DURATION_OPTIONS;
  const isSelectedTopicCounting = Boolean(
    selectedTopic && state.isRunning && selectedTopic.id === activeTopic?.id,
  );
  const selectedTopicVisitLabel =
    selectedTopic && selectedTopic.elapsed > 0 ? 'Revisit' : 'Start topic';
  const selectedTopicStatusLabel =
    selectedTopic && selectedTopic.id === activeTopic?.id ? 'In focus' : 'Viewing';
  const isEditingNote = Boolean(editingNoteId);
  const selectedTopicIndex = selectedTopic
    ? topics.findIndex((topic) => topic.id === selectedTopic.id)
    : -1;
  const nextTopic =
    selectedTopicIndex >= 0 && selectedTopicIndex + 1 < topics.length
      ? topics[selectedTopicIndex + 1]
      : null;
  const selectedTopicRemainingSeconds = selectedTopic
    ? Math.max(0, selectedTopic.seconds - selectedTopic.elapsed)
    : 0;
  const sessionTopic = activeTopic ?? selectedTopic;
  const sessionTopicRemainingSeconds = sessionTopic
    ? Math.max(0, sessionTopic.seconds - sessionTopic.elapsed)
    : 0;
  const focusTopic = activeTopic;
  const secondaryFocusTopic = state.secondaryIndex >= 0 ? topics[state.secondaryIndex] : null;
  const activeFocusTopics = [focusTopic, secondaryFocusTopic].filter(Boolean);
  
  const focusNextTopic = currentIndex + 1 < topics.length && currentIndex + 1 !== state.secondaryIndex 
    ? topics[currentIndex + 1] 
    : (currentIndex + 2 < topics.length ? topics[currentIndex + 2] : null);
  const focusQueuedTopics = topics.slice(Math.max(currentIndex, state.secondaryIndex) + 1).filter((t) => !t.addressed && t.id !== focusTopic?.id && t.id !== secondaryFocusTopic?.id);
  
  const focusTopicRemainingSeconds = focusTopic
    ? Math.max(0, focusTopic.seconds - focusTopic.elapsed)
    : 0;
  const focusTopicProgressPercent = focusTopic ? getTopicProgress(focusTopic) : 0;
  const focusActionItems = parseActionItems(focusTopic?.notes).concat(parseActionItems(secondaryFocusTopic?.notes));
  const renderedSelectedTopicNotes = getRenderableTopicNotes(selectedTopic);
  const renderedFocusTopicNotes = getRenderableTopicNotes(focusTopic);
  const renderedSecondaryFocusTopicNotes = getRenderableTopicNotes(secondaryFocusTopic);
  const isMiniModeActive = isMiniMode && !isMiniModeDismissed;
  const usesFocusLayout = isFocusMode || isMiniModeActive;
  const usesMiniVariant = isMiniMode && usesFocusLayout;
  const isFocusNoteMode = Boolean(
    usesFocusLayout && (noteDraft || editingNoteId || isFocusNoteComposerOpen),
  );
  const isMiniFocusKeyboardActive = Boolean(
    usesMiniVariant && isFocusNoteMode && isFocusNoteInputFocused,
  );
  const showFocusControlsAux = usesMiniVariant || isFocusControlsAuxVisible;
  const shouldHideTopicCardProgressNotes = Boolean(isAgendaInfoOpen && isMobileViewport);
  const durationSuggestions = durationOptions.map((option) => option.label);
  const isTopicsMobileCopyMenuOpen = openMobileCopyMenu === 'topics';
  const isDetailMobileCopyMenuOpen = openMobileCopyMenu === 'detail';
  const selectedTopicMarkdown = selectedTopic ? formatTopicMarkdown(selectedTopic) : '';
  const agendaMarkdown = formatAgendaMarkdown(topics);
  const isEndingSoon = Boolean(
    isSelectedTopicCounting && selectedTopicRemainingSeconds > 0 && selectedTopicRemainingSeconds <= 10,
  );
  const didTopicEnd = Boolean(isSelectedTopicCounting && selectedTopicRemainingSeconds <= 0);
  const sessionProgressPercent =
    totalSeconds > 0 ? Math.min(100, Math.max(0, (totalElapsed / totalSeconds) * 100)) : 0;
  const agendaActionsPanelProps = {
    actionGroups,
    completedActionItemCount,
    isExpanded: isAgendaActionsExpanded,
    onSelectTopic: selectTopic,
    onToggleActionItemForTopic: toggleActionItemForTopic,
    onToggleExpanded: () => setIsAgendaActionsExpanded((previous) => !previous),
    openActionItemCount,
    totalActionItemCount,
  };

  useEffect(() => {
    const safeIndex = clampIndex(state.currentIndex, topics.length);
    const hasSelectedTopic = topics.some((topic) => topic.id === state.selectedTopicId);
    const needsSelectionRepair = topics.length
      ? !hasSelectedTopic
      : state.selectedTopicId !== null;

    if (safeIndex !== state.currentIndex || needsSelectionRepair) {
      setState((previous) => ({
        ...previous,
        currentIndex: safeIndex,
        selectedTopicId: topics.length && hasSelectedTopic
          ? previous.selectedTopicId
          : previous.topics[safeIndex]?.id ?? null,
      }));
    }
  }, [state.currentIndex, state.selectedTopicId, topics]);

  useEffect(() => {
    saveState(state, window.localStorage, {
      previousAgendaId: renamedAgendaIdRef.current,
    });

    renamedAgendaIdRef.current = '';
    setSavedAgendas(listSavedAgendas(window.localStorage));
  }, [state]);

  useEffect(() => {
    const key = parseAgendaHash(state.sourceHash).kind === 'share'
      ? state.sourceHash
      : `agnda:agenda:${state.agendaId}`;
    function receiveSavedAgenda(event) {
      if (event.key !== key || !event.newValue) return;
      try {
        const incoming = JSON.parse(event.newValue);
        if (incoming.schemaVersion === 3) {
          setState((current) => mergeWidgetChanges(current, incoming));
        }
      } catch {
        // Ignore unrelated or incomplete storage writes.
      }
    }
    window.addEventListener('storage', receiveSavedAgenda);
    return () => window.removeEventListener('storage', receiveSavedAgenda);
  }, [state.agendaId, state.sourceHash]);

  useEffect(() => {
    if (!globalThis.window) {
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, themeId);
  }, [themeId]);

  useEffect(() => {
    const desiredHash = state.sourceHash?.trim() || buildAgendaHash(state.agendaId);
    if (!globalThis.window || window.location.hash === desiredHash) {
      return;
    }

    const url = new URL(window.location.href);
    url.hash = desiredHash;
    window.history.replaceState(null, '', url);
  }, [state.agendaId, state.sourceHash]);

  useEffect(() => {
    function handleHashChange() {
      setState(loadInitialState(window.localStorage, window.location.hash));
      setSavedAgendas(listSavedAgendas(window.localStorage));
      resetTransientUi();
    }

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    if (!globalThis.document) {
      return;
    }

    const currentTopicName =
      typeof activeTopic?.name === 'string' && activeTopic.name.trim() ? activeTopic.name.trim() : '';

    document.title = `${currentTopicName || agendaDisplayName} | AGNDA`;
    setDocumentFavicon(getTopicFaviconHref(activeTopic, state.isRunning));
  }, [
    activeTopic?.elapsed,
    activeTopic?.id,
    activeTopic?.name,
    activeTopic?.seconds,
    agendaDisplayName,
    state.isRunning,
  ]);

  useEffect(() => {
    if (!state.isRunning) {
      if (tickerRef.current.intervalId) {
        window.clearInterval(tickerRef.current.intervalId);
        tickerRef.current.intervalId = null;
      }
      return;
    }

    tickerRef.current.lastTickMs = Date.now();

    tickerRef.current.intervalId = window.setInterval(() => {
      const now = Date.now();
      const deltaSeconds = Math.floor((now - tickerRef.current.lastTickMs) / 1000);
      if (deltaSeconds < 1) {
        return;
      }

      tickerRef.current.lastTickMs += deltaSeconds * 1000;
      setState((previous) => advanceSessionBySeconds(previous, deltaSeconds));
    }, 250);

    return () => {
      if (tickerRef.current.intervalId) {
        window.clearInterval(tickerRef.current.intervalId);
        tickerRef.current.intervalId = null;
      }
    };
  }, [state.isRunning]);

  useEffect(() => {
    const pendingTopicId = pendingDetailScrollTopicIdRef.current;
    if (!pendingTopicId || selectedTopic?.id !== pendingTopicId) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (pendingDetailScrollTopicIdRef.current !== pendingTopicId) {
        return;
      }

      detailHeaderRef.current?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      });
      pendingDetailScrollTopicIdRef.current = null;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [selectedTopic?.id]);

  useEffect(() => {
    if (
      !shouldAutoScrollRestoredRunningRef.current ||
      !state.isRunning ||
      !activeTopic?.id
    ) {
      return;
    }

    shouldAutoScrollRestoredRunningRef.current = false;
    queueDetailScroll(activeTopic.id);
  }, [activeTopic?.id, state.isRunning]);

  useEffect(() => {
    if (!globalThis.window) {
      return undefined;
    }

    function handleResize() {
      const detectedMiniMode = detectMiniMode(window);
      setIsMiniMode(detectedMiniMode);
      setIsMobileViewport(detectMobileViewport(window));

      if (!detectedMiniMode) {
        setIsMiniModeDismissed(false);
      }
    }

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isMiniModeActive) {
      return;
    }

    setIsDrawerOpen(false);

    const currentTopicId = topics[currentIndex]?.id ?? null;
    if (!currentTopicId || state.selectedTopicId === currentTopicId) {
      return;
    }

    setState((previous) => {
      const nextTopicId =
        previous.topics[clampIndex(previous.currentIndex, previous.topics.length)]?.id;
      if (!nextTopicId || previous.selectedTopicId === nextTopicId) {
        return previous;
      }

      return {
        ...previous,
        selectedTopicId: nextTopicId,
      };
    });
  }, [currentIndex, isMiniModeActive, state.selectedTopicId, topics]);

  useEffect(() => {
    if (!usesFocusLayout && topics.length === 0) {
      setIsAgendaInfoOpen(true);
    }
  }, [topics.length, usesFocusLayout]);

  useEffect(() => {
    return () => {
      if (focusControlsHideTimeoutRef.current) {
        window.clearTimeout(focusControlsHideTimeoutRef.current);
      }

      if (notePreviewTimeoutRef.current) {
        window.clearTimeout(notePreviewTimeoutRef.current);
      }

      if (mobileCopyFeedbackTimeoutRef.current) {
        window.clearTimeout(mobileCopyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (usesFocusLayout) {
      return;
    }

    if (focusControlsHideTimeoutRef.current) {
      window.clearTimeout(focusControlsHideTimeoutRef.current);
      focusControlsHideTimeoutRef.current = null;
    }

    setIsFocusControlsAuxVisible(false);
  }, [usesFocusLayout]);

  useEffect(() => {
    if (!isAgendaInfoOpen || usesFocusLayout || !globalThis.window) {
      return undefined;
    }

    const preferredInput = addTopicInputRef.current;

    preferredInput?.focus();

    const frameId = window.requestAnimationFrame(() => {
      preferredInput?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isAgendaInfoOpen, usesFocusLayout]);

  useEffect(() => {
    if (!isAgendaInfoOpen || usesFocusLayout || !globalThis.document) {
      return undefined;
    }

    function handlePointerDown(event) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (agendaInfoButtonRef.current?.contains(target)) {
        return;
      }

      if (agendaInfoPopoverRef.current?.contains(target)) {
        return;
      }

      setIsAgendaInfoOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isAgendaInfoOpen, usesFocusLayout]);

  useEffect(() => {
    if (usesFocusLayout || !isMobileViewport) {
      setOpenMobileCopyMenu(null);
    }
  }, [isMobileViewport, usesFocusLayout]);

  useEffect(() => {
    if (!openMobileCopyMenu || !globalThis.document) {
      return undefined;
    }

    const activeButtonRef =
      openMobileCopyMenu === 'topics' ? topicsCopyButtonRef : detailCopyButtonRef;
    const activeMenuRef = openMobileCopyMenu === 'topics' ? topicsCopyMenuRef : detailCopyMenuRef;

    function handlePointerDown(event) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (activeButtonRef.current?.contains(target) || activeMenuRef.current?.contains(target)) {
        return;
      }

      setOpenMobileCopyMenu(null);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [openMobileCopyMenu]);

  useEffect(() => {
    if (!globalThis.document) {
      return undefined;
    }

    function handleFullscreenChange() {
      if (isFocusMode && !document.fullscreenElement) {
        setIsFocusMode(false);
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isFocusMode]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === 'Escape') {
        if (openMobileCopyMenu && !usesFocusLayout) {
          event.preventDefault();
          setOpenMobileCopyMenu(null);
          return;
        }

        if (isFocusMode) {
          event.preventDefault();
          exitFocusMode();
          return;
        }

        if (isAgendaInfoOpen && !usesFocusLayout) {
          event.preventDefault();
          setIsAgendaInfoOpen(false);
          return;
        }

        setIsDrawerOpen(false);
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      const lowerKey = event.key.toLowerCase();

      if ((event.metaKey || event.ctrlKey) && !event.altKey && lowerKey === 'c') {
        const hasSelection = hasMeaningfulDocumentSelection(window, document);
        const copyScope = event.shiftKey ? 'agenda' : 'topic';
        const hasCopySource = copyScope === 'agenda' ? Boolean(agendaMarkdown) : Boolean(selectedTopicMarkdown);

        if (hasSelection || !hasCopySource) {
          return;
        }

        event.preventDefault();
        void copyMarkdown(copyScope);
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        toggleTimer();
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && usesFocusLayout && lowerKey === 'j') {
        event.preventDefault();
        moveTopicBy(1);
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && usesFocusLayout && lowerKey === 'k') {
        event.preventDefault();
        moveTopicBy(-1);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && lowerKey === 'n') {
        event.preventDefault();
        const nextTopic = createTopicFromMinutes('New topic', 5);
        setState((previous) => appendTopicWithoutInterrupting(previous, nextTopic));
        return;
      }

      if (
        !isDrawerOpen &&
        selectedTopic &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.length === 1 &&
        !/^\s$/.test(event.key)
      ) {
        event.preventDefault();
        beginNoteCapture(event.key);
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeTopic,
    isAgendaInfoOpen,
    agendaMarkdown,
    isDrawerOpen,
    isFocusMode,
    openMobileCopyMenu,
    selectedTopicMarkdown,
    topics,
    usesFocusLayout,
  ]);

  useEffect(() => {
    const pendingCapture = pendingNoteCaptureRef.current;
    if (pendingCapture && pendingCapture.topicId === state.selectedTopicId) {
      setEditingNoteId(null);
      draftNoteIdRef.current = null;
      updateNoteDraft(pendingCapture.initialValue, {
        topicId: pendingCapture.topicId,
        offsetSeconds: pendingCapture.offsetSeconds,
      });
      pendingNoteCaptureRef.current = null;
      focusNoteInput();
      return;
    }

    previewNote(null);
    setEditingNoteId(null);
    setIsFocusNoteComposerOpen(false);
    setNoteDraft('');
    noteDraftRef.current = '';
    draftNoteIdRef.current = null;
    noteDraftOffsetRef.current = null;
  }, [state.selectedTopicId]);

  useEffect(() => {
    setHoveredNoteId(null);
  }, [state.selectedTopicId]);

  useEffect(() => {
    setDurationDraft(selectedTopic ? formatShortDuration(selectedTopic.seconds) : '');
  }, [selectedTopic?.id, selectedTopic?.seconds]);

  useEffect(() => {
    if (!usesFocusLayout) {
      setIsFocusTaskPanelOpen(false);
      setIsFocusNoteComposerOpen(false);
    }
  }, [usesFocusLayout]);

  useEffect(() => {
    if (!usesMiniVariant || !isFocusNoteMode || !isFocusNoteInputFocused || !globalThis.window) {
      setFocusNoteKeyboardInset(0);
      return undefined;
    }

    function updateKeyboardInset() {
      setFocusNoteKeyboardInset(getVisualViewportInset(window));
    }

    updateKeyboardInset();

    const visualViewport = window.visualViewport;
    if (!visualViewport) {
      return undefined;
    }

    visualViewport.addEventListener('resize', updateKeyboardInset);
    visualViewport.addEventListener('scroll', updateKeyboardInset);

    return () => {
      visualViewport.removeEventListener('resize', updateKeyboardInset);
      visualViewport.removeEventListener('scroll', updateKeyboardInset);
    };
  }, [isFocusNoteInputFocused, isFocusNoteMode, usesMiniVariant]);

  useEffect(() => {
    if (!isFocusNoteMode) {
      setIsFocusNoteInputFocused(false);
      setFocusNoteKeyboardInset(0);
    }
  }, [isFocusNoteMode]);

  function previewNote(noteId) {
    if (notePreviewTimeoutRef.current) {
      window.clearTimeout(notePreviewTimeoutRef.current);
      notePreviewTimeoutRef.current = null;
    }

    if (!noteId) {
      setPreviewedNoteId(null);
      return;
    }

    setPreviewedNoteId(noteId);
    notePreviewTimeoutRef.current = window.setTimeout(() => {
      setPreviewedNoteId((previous) => (previous === noteId ? null : previous));
      notePreviewTimeoutRef.current = null;
    }, 8000);
  }

  function requestAppFullscreen() {
    if (!globalThis.document) {
      return;
    }

    const target = appShellRef.current;
    if (!target || typeof target.requestFullscreen !== 'function') {
      return;
    }

    if (document.fullscreenElement === target) {
      return;
    }

    const request = target.requestFullscreen();
    if (request && typeof request.catch === 'function') {
      request.catch(() => {
        // Ignore browsers that reject fullscreen outside a direct user gesture.
      });
    }
  }

  function leaveAppFullscreen() {
    if (!globalThis.document || typeof document.exitFullscreen !== 'function') {
      return;
    }

    if (!document.fullscreenElement) {
      return;
    }

    const exit = document.exitFullscreen();
    if (exit && typeof exit.catch === 'function') {
      exit.catch(() => {
        // Ignore unsupported or already-exiting fullscreen states.
      });
    }
  }

  function enterFocusMode() {
    const currentTopicId = topics[currentIndex]?.id ?? selectedTopic?.id ?? null;

    if (currentTopicId) {
      setState((previous) => ({
        ...previous,
        selectedTopicId: currentTopicId,
      }));
    }

    setIsDrawerOpen(false);
    setIsAgendaInfoOpen(false);
    setIsFocusMode(true);
    requestAppFullscreen();
  }

  function exitFocusMode() {
    cancelNoteComposer();
    setIsFocusTaskPanelOpen(false);
    clearFocusControlsHideTimeout();
    setIsFocusControlsAuxVisible(false);
    setIsFocusMode(false);
    leaveAppFullscreen();
  }

  function dismissMiniMode() {
    cancelNoteComposer();
    setIsFocusTaskPanelOpen(false);
    clearFocusControlsHideTimeout();
    setIsFocusControlsAuxVisible(false);
    setIsMiniModeDismissed(true);
    setIsFocusMode(false);
    leaveAppFullscreen();
  }

  function clearFocusControlsHideTimeout() {
    if (!focusControlsHideTimeoutRef.current) {
      return;
    }

    window.clearTimeout(focusControlsHideTimeoutRef.current);
    focusControlsHideTimeoutRef.current = null;
  }

  function revealFocusControlsAux(options = {}) {
    const { autoHide = false, delay = 2200 } = options;

    clearFocusControlsHideTimeout();
    setIsFocusControlsAuxVisible(true);

    if (!autoHide) {
      return;
    }

    focusControlsHideTimeoutRef.current = window.setTimeout(() => {
      setIsFocusControlsAuxVisible(false);
      focusControlsHideTimeoutRef.current = null;
    }, delay);
  }

  function activateTopicFromFocus(topicId) {
    if (!topicId) {
      return;
    }

    setState((previous) => {
      const nextIndex = previous.topics.findIndex((topic) => topic.id === topicId);
      if (nextIndex < 0) {
        return previous;
      }

      return {
        ...previous,
        currentIndex: nextIndex,
        selectedTopicId: topicId,
        autoAdvance: false,
        topics: previous.topics.map((topic, index) =>
          index === nextIndex ? { ...topic, addressed: false } : topic,
        ),
      };
    });
  }

  function moveTopicBy(delta) {
    setState((previous) => {
      if (!previous.topics.length) {
        return previous;
      }

      const nextIndex = Math.max(
        0,
        Math.min(
          previous.topics.length - 1,
          clampIndex(previous.currentIndex, previous.topics.length) + delta,
        ),
      );
      const nextTopicId = previous.topics[nextIndex]?.id ?? previous.selectedTopicId;

      if (nextIndex === previous.currentIndex || !nextTopicId) {
        return previous;
      }

      return {
        ...previous,
        currentIndex: nextIndex,
        selectedTopicId: nextTopicId,
        autoAdvance: false,
        topics: previous.topics.map((topic, index) =>
          index === nextIndex ? { ...topic, addressed: false } : topic,
        ),
      };
    });
  }

  function updateTopic(topicId, updateFn) {
    setState((previous) => {
      const nextTopics = previous.topics.map((topic) =>
        topic.id === topicId ? updateFn(topic) : topic,
      );

      return {
        ...previous,
        topics: nextTopics,
      };
    });
  }

  function clearNoteComposer() {
    setEditingNoteId(null);
    setIsFocusNoteComposerOpen(false);
    setIsFocusNoteInputFocused(false);
    setFocusNoteKeyboardInset(0);
    setNoteDraft('');
    noteDraftRef.current = '';
    draftNoteIdRef.current = null;
    noteDraftOffsetRef.current = null;
  }

  function cancelNoteComposer() {
    clearNoteComposer();
    previewNote(null);
  }

  function handleNoteInputKeyDown(event) {
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.blur();
    cancelNoteComposer();
  }

  function focusNoteInput(options = {}) {
    const { sync = false } = options;

    function applyFocus() {
      const input = noteInputRef.current;
      if (!input) {
        return;
      }

      try {
        input.focus({ preventScroll: true });
      } catch {
        input.focus();
      }

      if (typeof input.setSelectionRange === 'function') {
        const cursorPosition = input.value.length;
        input.setSelectionRange(cursorPosition, cursorPosition);
      }
    }

    if (sync) {
      applyFocus();
      return;
    }

    window.requestAnimationFrame(applyFocus);
  }

  function closeMiniFocusTaskPanel() {
    if (usesMiniVariant) {
      setIsFocusTaskPanelOpen(false);
    }
  }

  function handleFocusNoteInputFocus() {
    closeMiniFocusTaskPanel();
    setIsFocusNoteInputFocused(true);
  }

  function handleFocusNoteInputBlur() {
    setIsFocusNoteInputFocused(false);
  }

  function handleFocusChecklistShortcutPointerDown(event) {
    event.preventDefault();
  }

  function showMobileCopyFeedback(scope) {
    if (mobileCopyFeedbackTimeoutRef.current) {
      window.clearTimeout(mobileCopyFeedbackTimeoutRef.current);
    }

    setCopiedMobileCopyScope(scope);
    mobileCopyFeedbackTimeoutRef.current = window.setTimeout(() => {
      setCopiedMobileCopyScope((previous) => (previous === scope ? null : previous));
      mobileCopyFeedbackTimeoutRef.current = null;
    }, 1800);
  }

  async function copyMarkdown(scope, options = {}) {
    const { feedbackScope = null } = options;
    const markdown = scope === 'agenda' ? agendaMarkdown : selectedTopicMarkdown;

    if (!markdown) {
      return false;
    }

    const didCopy = await writeTextToClipboard(markdown, {
      navigatorRef: globalThis.window?.navigator ?? globalThis.navigator,
      documentRef: globalThis.document,
    });
    if (!didCopy) {
      return false;
    }

    if (feedbackScope) {
      showMobileCopyFeedback(feedbackScope);
    }

    return true;
  }

  function toggleMobileCopyMenu(scope) {
    if (scope === 'topics') {
      setIsAgendaInfoOpen(false);
    }

    setOpenMobileCopyMenu((previous) => (previous === scope ? null : scope));
  }

  async function handleMobileCopyAction(scope, feedbackScope) {
    setOpenMobileCopyMenu(null);
    await copyMarkdown(scope, { feedbackScope });
  }

  function openFocusNoteComposer() {
    const targetTopic = focusTopic ?? selectedTopic;
    if (!targetTopic) {
      return;
    }

    closeMiniFocusTaskPanel();

    if (selectedTopic?.id !== targetTopic.id) {
      pendingNoteCaptureRef.current = {
        topicId: targetTopic.id,
        initialValue: '',
        offsetSeconds: noteDraftOffsetRef.current ?? targetTopic.elapsed,
      };
      flushSync(() => {
        setIsFocusNoteComposerOpen(true);
        setState((previous) => ({
          ...previous,
          selectedTopicId: targetTopic.id,
        }));
      });
      focusNoteInput({ sync: true });
      focusNoteInput();
      return;
    }

    flushSync(() => {
      setIsFocusNoteComposerOpen(true);
    });

    if (
      !editingNoteId &&
      !noteDraftRef.current &&
      noteDraftOffsetRef.current === null &&
      targetTopic
    ) {
      noteDraftOffsetRef.current = targetTopic.elapsed;
    }

    focusNoteInput({ sync: true });
    focusNoteInput();
  }

  function insertFocusChecklistMarker() {
    const targetTopic = focusTopic ?? selectedTopic;
    if (!targetTopic) {
      return;
    }

    const input = noteInputRef.current;
    const currentValue = noteDraftRef.current;
    const checklistPrefix = '- [ ] ';
    const hasChecklistPrefix = currentValue.startsWith(checklistPrefix);
    const selectionStart =
      typeof input?.selectionStart === 'number' ? input.selectionStart : currentValue.length;
    const selectionEnd =
      typeof input?.selectionEnd === 'number' ? input.selectionEnd : selectionStart;
    const nextValue = hasChecklistPrefix
      ? currentValue.slice(checklistPrefix.length)
      : `${checklistPrefix}${currentValue}`;
    const cursorOffset = hasChecklistPrefix ? -checklistPrefix.length : checklistPrefix.length;
    const nextSelectionStart = Math.max(0, selectionStart + cursorOffset);
    const nextSelectionEnd = Math.max(0, selectionEnd + cursorOffset);

    closeMiniFocusTaskPanel();

    if (!editingNoteId && noteDraftOffsetRef.current === null) {
      noteDraftOffsetRef.current = targetTopic.elapsed;
    }

    updateNoteDraft(nextValue, {
      topicId: targetTopic.id,
      offsetSeconds: noteDraftOffsetRef.current ?? targetTopic.elapsed,
    });

    window.requestAnimationFrame(() => {
      focusNoteInput({ sync: true });
      noteInputRef.current?.setSelectionRange(nextSelectionStart, nextSelectionEnd);
    });
  }

  function resetTransientUi() {
    exitFocusMode();
    setIsDrawerOpen(false);
    setIsAgendaInfoOpen(false);
    setOpenMobileCopyMenu(null);
    setCopiedMobileCopyScope(null);
    setNewTopicName('');
    clearNoteComposer();
    previewNote(null);
    setHoveredNoteId(null);
    setDragState(null);
    pendingDetailScrollTopicIdRef.current = null;
    pendingNoteCaptureRef.current = null;
  }

  function queueDetailScroll(topicId) {
    if (!topicId) {
      return;
    }

    pendingDetailScrollTopicIdRef.current = topicId;

    if (selectedTopic?.id !== topicId) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (pendingDetailScrollTopicIdRef.current !== topicId) {
        return;
      }

      detailHeaderRef.current?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      });
      pendingDetailScrollTopicIdRef.current = null;
    });
  }

  function replaceHash(hash) {
    if (!globalThis.window || typeof hash !== 'string' || !hash.trim()) {
      return;
    }

    if (window.location.hash === hash) {
      return;
    }

    const url = new URL(window.location.href);
    url.hash = hash;
    window.history.replaceState(null, '', url);
  }

  function reorderTopicList(sourceTopicId, targetTopicId, placement) {
    setState((previous) => {
      const activeTopicId = previous.topics[clampIndex(previous.currentIndex, previous.topics.length)]?.id;
      const nextTopics = reorderTopics(previous.topics, sourceTopicId, targetTopicId, placement);

      if (nextTopics === previous.topics) {
        return previous;
      }

      const nextCurrentIndex = activeTopicId
        ? Math.max(0, nextTopics.findIndex((topic) => topic.id === activeTopicId))
        : clampIndex(previous.currentIndex, nextTopics.length);
      const nextSelectedTopicId = nextTopics.some((topic) => topic.id === previous.selectedTopicId)
        ? previous.selectedTopicId
        : nextTopics[nextCurrentIndex]?.id ?? nextTopics[0]?.id ?? null;

      return {
        ...previous,
        topics: nextTopics,
        currentIndex: nextCurrentIndex,
        selectedTopicId: nextSelectedTopicId,
      };
    });
  }

  function getDropPlacement(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY - bounds.top >= bounds.height / 2 ? 'after' : 'before';
  }

  function handleTopicDragStart(event, topicId) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', topicId);
    setDragState({
      draggedId: topicId,
      overId: topicId,
      placement: 'before',
    });
  }

  function handleTopicDragOver(event, topicId) {
    event.preventDefault();

    const draggedId = dragState?.draggedId ?? event.dataTransfer.getData('text/plain');
    if (!draggedId) {
      return;
    }

    const placement = getDropPlacement(event);
    event.dataTransfer.dropEffect = 'move';

    setDragState((previous) => {
      if (
        previous?.draggedId === draggedId &&
        previous?.overId === topicId &&
        previous?.placement === placement
      ) {
        return previous;
      }

      return {
        draggedId,
        overId: topicId,
        placement,
      };
    });
  }

  function handleTopicDrop(event, topicId) {
    event.preventDefault();

    const sourceTopicId = dragState?.draggedId ?? event.dataTransfer.getData('text/plain');
    if (!sourceTopicId) {
      setDragState(null);
      return;
    }

    reorderTopicList(sourceTopicId, topicId, getDropPlacement(event));
    setDragState(null);
  }

  function handleTopicDragEnd() {
    setDragState(null);
  }

  function beginNoteCapture(initialValue = '') {
    const targetTopic = activeTopic ?? selectedTopic;
    if (!targetTopic) {
      return;
    }

    if (selectedTopic?.id !== targetTopic.id) {
      pendingNoteCaptureRef.current = {
        topicId: targetTopic.id,
        initialValue,
        offsetSeconds: targetTopic.elapsed,
      };
      setState((previous) => ({
        ...previous,
        selectedTopicId: targetTopic.id,
      }));
      return;
    }

    focusNoteInput({ sync: true });
    focusNoteInput();
    if (!noteDraftRef.current) {
      noteDraftOffsetRef.current = targetTopic.elapsed;
    }

    if (initialValue) {
      updateNoteDraft(`${noteDraftRef.current}${initialValue}`, {
        topicId: targetTopic.id,
        offsetSeconds: noteDraftOffsetRef.current ?? targetTopic.elapsed,
      });
    }
  }

  function updateNoteDraft(value, options = {}) {
    const topicId = options.topicId ?? selectedTopic?.id ?? null;
    const offsetSeconds = options.offsetSeconds ?? noteDraftOffsetRef.current ?? selectedTopic?.elapsed;
    const hasMeaningfulText = value.trim().length > 0;

    noteDraftRef.current = value;
    setNoteDraft(value);

    if (editingNoteId) {
      previewNote(editingNoteId);
      return;
    }

    if (hasMeaningfulText && noteDraftOffsetRef.current === null && Number.isFinite(offsetSeconds)) {
      noteDraftOffsetRef.current = offsetSeconds;
    }

    if (!hasMeaningfulText) {
      previewNote(null);
      draftNoteIdRef.current = null;
      noteDraftOffsetRef.current = null;
      return;
    }

    if (!draftNoteIdRef.current) {
      draftNoteIdRef.current = makeEntityId('note');
    }

    if (!topicId) {
      return;
    }

    previewNote(draftNoteIdRef.current);
  }

  function getRenderableTopicNotes(topic) {
    if (!topic) {
      return [];
    }

    const notes = Array.isArray(topic.notes) ? topic.notes : [];
    if (topic.id !== selectedTopic?.id) {
      return notes;
    }

    if (editingNoteId) {
      return notes.map((note) =>
        note.id === editingNoteId
          ? {
            ...note,
            text: noteDraft,
          }
          : note,
      );
    }

    if (!noteDraft.trim() || !draftNoteIdRef.current) {
      return notes;
    }

    return notes.concat({
      id: draftNoteIdRef.current,
      text: noteDraft,
      offsetSeconds:
        Number.isFinite(noteDraftOffsetRef.current) && noteDraftOffsetRef.current !== null
          ? noteDraftOffsetRef.current
          : topic.elapsed,
    });
  }

  function selectTopic(topicId) {
    queueDetailScroll(topicId);

    setState((previous) => {
      const nextIndex = previous.topics.findIndex((topic) => topic.id === topicId);
      if (nextIndex < 0) {
        return previous;
      }

      const isSameSelection = previous.selectedTopicId === topicId;
      const isCurrentlyCounting = previous.isRunning && nextIndex === previous.currentIndex;
      const shouldAutoRevisit =
        previous.autoRevisitOnSelect &&
        (!previous.isRunning || nextIndex !== previous.currentIndex);

      if (shouldAutoRevisit || (isSameSelection && !isCurrentlyCounting)) {
        return activateTopicInState(previous, topicId);
      }

      return {
        ...previous,
        selectedTopicId: topicId,
      };
    });
  }

  function addTopic(name = newTopicName.trim() || 'New topic') {
    const nextTopic = createTopicFromMinutes(name, 5);

    setState((previous) => appendTopicWithoutInterrupting(previous, nextTopic));

    setNewTopicName('');
    setIsAgendaInfoOpen(false);
  }

  function handleAddTopic(event) {
    event.preventDefault();
    addTopic();
  }

  function updateTitle(value) {
    setState((previous) => {
      const nextAgendaId = normalizeAgendaId(value, previous.agendaId);
      if (nextAgendaId !== previous.agendaId) {
        renamedAgendaIdRef.current = previous.agendaId;
      }

      const previousSlugHash = buildAgendaHash(previous.agendaId);
      const nextSourceHash =
        previous.sourceHash === previousSlugHash
          ? buildAgendaHash(nextAgendaId)
          : previous.sourceHash;

      return {
        ...previous,
        title: value,
        agendaId: nextAgendaId,
        sourceHash: nextSourceHash,
      };
    });
  }

  function normalizeTitleOnBlur() {
    setState((previous) => ({
      ...previous,
      title: previous.title.trim() || humanizeAgendaId(previous.agendaId),
    }));
  }

  function toggleTimer() {
    const targetTopicId = activeTopic?.id ?? selectedTopic?.id ?? null;
    queueDetailScroll(targetTopicId);

    setState((previous) => {
      const nextIsRunning = !previous.isRunning;
      const nextSelectedTopicId = nextIsRunning
        ? previous.topics[clampIndex(previous.currentIndex, previous.topics.length)]?.id ??
        previous.selectedTopicId
        : previous.selectedTopicId;

      return {
        ...previous,
        isRunning: nextIsRunning,
        selectedTopicId: nextSelectedTopicId,
      };
    });
  }

  function toggleAutoAdvance() {
    setState((previous) => ({
      ...previous,
      autoAdvance: !previous.autoAdvance,
    }));
  }

  function toggleAutoRevisitOnSelect() {
    setState((previous) => ({
      ...previous,
      autoRevisitOnSelect: !previous.autoRevisitOnSelect,
    }));
  }

  function applyTemplate(templateId) {
    const template = TEMPLATE_PRESETS.find((preset) => preset.id === templateId);
    if (!template) {
      return;
    }

    const nextTopics = instantiateTopics(template.topics);

    setState((previous) => ({
      ...previous,
      topics: nextTopics,
      currentIndex: 0,
      selectedTopicId: nextTopics[0]?.id ?? null,
      isRunning: false,
    }));
  }

  function updateSelectedTopicName(value) {
    if (!selectedTopic) {
      return;
    }

    updateTopic(selectedTopic.id, (topic) => ({
      ...topic,
      name: value,
    }));
  }

  function updateSelectedTopicNameOnBlur() {
    if (!selectedTopic) {
      return;
    }

    updateTopic(selectedTopic.id, (topic) => ({
      ...topic,
      name: topic.name.trim() || 'New topic',
    }));
  }

  function updateSelectedTopicTag(value) {
    if (!selectedTopic) {
      return;
    }

    updateTopic(selectedTopic.id, (topic) => ({
      ...topic,
      tag: value,
    }));
  }

  function updateSelectedTopicDuration(value) {
    if (!selectedTopic) {
      return;
    }

    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 30) {
      return;
    }

    updateTopic(selectedTopic.id, (topic) => ({
      ...topic,
      seconds,
    }));
  }

  function handleDurationDraftChange(value) {
    setDurationDraft(value);

    const presetMatch = durationOptions.find(
      (option) => option.label.toLowerCase() === value.trim().toLowerCase(),
    );
    if (presetMatch) {
      updateSelectedTopicDuration(presetMatch.seconds);
    }
  }

  function commitDurationDraft() {
    if (!selectedTopic) {
      return;
    }

    const parsedSeconds = parseLooseDuration(durationDraft);
    if (!Number.isFinite(parsedSeconds) || parsedSeconds < 30) {
      setDurationDraft(formatShortDuration(selectedTopic.seconds));
      return;
    }

    updateSelectedTopicDuration(parsedSeconds);
  }

  function addNote(event) {
    event.preventDefault();

    if (!selectedTopic) {
      return;
    }

    const text = noteDraft.trim();
    if (!text) {
      return;
    }

    const draftNoteId = draftNoteIdRef.current;
    const previewNoteTargetId = editingNoteId ?? draftNoteId ?? makeEntityId('note');

    setJustSavedNoteId(previewNoteTargetId);

    updateTopic(selectedTopic.id, (topic) => {
      if (editingNoteId) {
        return {
          ...topic,
          notes: topic.notes.map((note) =>
            note.id === editingNoteId
              ? {
                ...note,
                text,
              }
              : note,
          ),
        };
      }

      if (!draftNoteId) {
        return {
          ...topic,
          notes: [
            ...topic.notes,
            {
              id: previewNoteTargetId,
              text,
              offsetSeconds: noteDraftOffsetRef.current ?? topic.elapsed,
            },
          ],
        };
      }

      if (!topic.notes.some((note) => note.id === draftNoteId)) {
        return {
          ...topic,
          notes: [
            ...topic.notes,
            {
              id: draftNoteId,
              text,
              offsetSeconds: noteDraftOffsetRef.current ?? topic.elapsed,
            },
          ],
        };
      }

      return {
        ...topic,
        notes: topic.notes.map((note) =>
          note.id === draftNoteId
            ? {
              ...note,
              text,
            }
            : note,
        ),
      };
    });

    previewNote(previewNoteTargetId);
    clearNoteComposer();
  }

  function editNote(noteId) {
    if (!selectedTopic) {
      return;
    }

    const note = selectedTopic.notes.find((candidate) => candidate.id === noteId);
    if (!note) {
      return;
    }

    setEditingNoteId(note.id);
    noteDraftRef.current = note.text;
    draftNoteIdRef.current = null;
    noteDraftOffsetRef.current = note.offsetSeconds;
    setNoteDraft(note.text);
    focusNoteInput();
  }

  function deleteNote(noteId) {
    if (!selectedTopic) {
      return;
    }

    if (editingNoteId === noteId) {
      clearNoteComposer();
    }

    updateTopic(selectedTopic.id, (topic) => ({
      ...topic,
      notes: topic.notes.filter((note) => note.id !== noteId),
    }));

    if (previewedNoteId === noteId) {
      previewNote(null);
    }
  }

  function toggleActionItemForTopic(topicId, noteId, checked) {
    if (!topicId) {
      return;
    }

    const isActive = topicId === activeTopic?.id;
    updateTopic(topicId, (topic) => ({
      ...topic,
      notes: topic.notes.map((note) =>
        note.id === noteId
          ? {
            ...note,
            text: toggleActionText(note.text, checked),
            offsetSeconds: checked && isActive ? activeTopic.elapsed : note.offsetSeconds,
          }
          : note,
      ),
    }));
  }

  function toggleActionItem(noteId, checked) {
    if (!selectedTopic) {
      return;
    }

    toggleActionItemForTopic(selectedTopic.id, noteId, checked);
  }

  function revisitTopic() {
    if (!selectedTopic) {
      return;
    }

    setState((previous) => activateTopicManually(previous, selectedTopic.id));
  }

  function revisitSecondaryTopic() {
    if (!selectedTopic) {
      return;
    }

    setState((previous) => activateSecondaryTopicManually(previous, selectedTopic.id));
  }

  function markAddressed() {
    if (!selectedTopic) {
      return;
    }

    setState((previous) => {
      const selectedIndex = previous.topics.findIndex((topic) => topic.id === selectedTopic.id);
      if (selectedIndex < 0) {
        return previous;
      }

      const isActive = selectedIndex === previous.currentIndex;
      const nextTopics = previous.topics.map((topic, index) =>
        index === selectedIndex
          ? {
            ...topic,
            addressed: true,
            seconds: isActive ? topic.elapsed : topic.seconds,
          }
          : topic,
      );

      const isSelectedTopicActive = selectedIndex === previous.currentIndex;
      if (!isSelectedTopicActive) {
        return {
          ...previous,
          topics: nextTopics,
        };
      }

      const nextOpenIndex = findNextOpenTopicIndex(nextTopics, selectedIndex);
      if (nextOpenIndex < 0) {
        return {
          ...previous,
          topics: nextTopics,
          isRunning: false,
        };
      }

      return {
        ...previous,
        topics: nextTopics,
        currentIndex: nextOpenIndex,
        selectedTopicId: nextTopics[nextOpenIndex]?.id ?? previous.selectedTopicId,
      };
    });
  }

  function goToAgenda(hash) {
    if (!hash) {
      return;
    }

    if (/^https?:\/\//i.test(hash)) {
      window.location.assign(hash);
      return;
    }

    window.location.hash = hash;
  }

  function openSavedAgenda(agenda) {
    const loadedAgenda = loadSavedAgenda(window.localStorage, agenda);
    if (!loadedAgenda) {
      resetTransientUi();
      goToAgenda(agenda?.target ?? agenda?.hash);
      return;
    }

    renamedAgendaIdRef.current = '';
    resetTransientUi();
    setState(loadedAgenda);
    setSavedAgendas(listSavedAgendas(window.localStorage));
    replaceHash(loadedAgenda.sourceHash || agenda?.hash || buildAgendaHash(loadedAgenda.agendaId));
  }

  function createNewAgenda() {
    const usedAgendaIds = new Set(
      savedAgendas.map((agenda) => agenda.agendaId).concat(state.agendaId),
    );
    let counter = 1;
    let agendaId = 'new-agnda';

    while (usedAgendaIds.has(agendaId)) {
      counter += 1;
      agendaId = `new-agnda-${counter}`;
    }

    const nextState = buildInitialState([], {
      agendaId,
      title: humanizeAgendaId(agendaId),
      allowEmptyTopics: true,
    });

    renamedAgendaIdRef.current = '';
    resetTransientUi();
    setState(nextState);
    replaceHash(nextState.sourceHash || buildAgendaHash(agendaId));
  }

  function removeSavedAgenda(agenda) {
    if (!agenda || !window.confirm(`Delete "${agenda.title}" from saved agndas?`)) {
      return;
    }

    deleteSavedAgenda(window.localStorage, agenda);
    setSavedAgendas(listSavedAgendas(window.localStorage));
  }

  function resetSelectedTopic() {
    if (!selectedTopic) {
      return;
    }

    updateTopic(selectedTopic.id, (topic) => ({
      ...topic,
      elapsed: 0,
      addressed: false,
    }));
  }

  function removeSelectedTopic() {
    if (!selectedTopic || !window.confirm(`Delete "${selectedTopic.name}" from this agnda?`)) {
      return;
    }

    setState((previous) => {
      if (previous.topics.length <= 1) {
        const replacementTopic = createTopicFromMinutes('New topic', 5);
        return {
          ...previous,
          topics: [replacementTopic],
          currentIndex: 0,
          selectedTopicId: replacementTopic.id,
          isRunning: false,
        };
      }

      const nextTopics = previous.topics.filter((topic) => topic.id !== selectedTopic.id);
      const nextIndex = clampIndex(previous.currentIndex, nextTopics.length);
      const removedCurrentTopic =
        previous.isRunning && previous.topics[previous.currentIndex]?.id === selectedTopic.id;

      return {
        ...previous,
        topics: nextTopics,
        currentIndex: nextIndex,
        selectedTopicId: nextTopics[nextIndex]?.id ?? nextTopics[0]?.id ?? null,
        isRunning: removedCurrentTopic ? false : previous.isRunning,
      };
    });
  }

  return (
    <main
      ref={appShellRef}
      className={`app-shell theme-${themeId}${usesFocusLayout ? ' is-focus-mode' : ''}${usesMiniVariant ? ' is-mini-mode' : ''}`}
    >
      {usesFocusLayout ? (
        <section
          className={`focus-mode${usesMiniVariant ? ' is-mini' : ''}${isMiniFocusKeyboardActive ? ' is-keyboard-active' : ''}`}
          style={{ '--mini-focus-keyboard-inset': `${focusNoteKeyboardInset}px` }}
        >
          <FocusAgendaRing
            topics={topics}
            currentIndex={currentIndex}
            sessionProgressPercent={sessionProgressPercent}
            remainingSessionSeconds={remainingSessionSeconds}
            totalSeconds={totalSeconds}
            isRunning={state.isRunning}
            progressOutside
            isMiniMode={usesMiniVariant}
          />

          <section className="focus-mode__hero">
            {activeFocusTopics.length > 0 ? (
              <div className="focus-mode__topic-shell">
                {activeFocusTopics.map((topic, _idx, arr) => {
                  const isPrimary = topic.id === focusTopic?.id;
                  const remainingSecs = Math.max(0, topic.seconds - topic.elapsed);
                  const trackNotes = isPrimary ? renderedFocusTopicNotes : renderedSecondaryFocusTopicNotes;
                  const previewNote =
                    trackNotes.find((note) => note.id === hoveredNoteId) ??
                    trackNotes.find((note) => note.id === previewedNoteId) ??
                    trackNotes.find((note) => note.id === justSavedNoteId) ??
                    (state.isRunning
                      ? trackNotes.find((note) => topic.elapsed >= note.offsetSeconds && topic.elapsed < note.offsetSeconds + 8)
                      : null);
                  const previewNoteIndex = previewNote
                    ? trackNotes.findIndex((note) => note.id === previewNote.id) + 1
                    : 0;
                  return (
                    <div key={topic.id} className={`focus-mode__topic-layer${arr.length > 1 ? ' is-dual' : ''}`} style={{ marginBottom: arr.length > 1 && isPrimary ? '2rem' : '0' }}>
                      <div className="focus-mode__topic-copy">
                        <p className="focus-mode__eyebrow">
                          {usesMiniVariant ? 'Mini mode' : 'Focus mode'}
                        </p>
                        <h1>{topic.name}</h1>
                        <div className="focus-mode__time-row">
                          <strong>{formatClock(remainingSecs)}</strong>
                          <span>
                            {state.isRunning ? 'Live topic' : 'Paused topic'}
                            {usesMiniVariant ? '' : ` · ${formatShortDuration(topic.seconds)}`}
                          </span>
                        </div>
                      </div>

                      <div className="focus-mode__progress-wrap">
                        <TopicProgressTrack
                          topic={topic}
                          notes={trackNotes}
                          themeId={themeId}
                          hoveredNoteId={hoveredNoteId}
                          onHoverNote={setHoveredNoteId}
                          onLeaveNote={(noteId) =>
                            setHoveredNoteId((previous) => (previous === noteId ? null : previous))
                          }
                          previewedNoteId={previewedNoteId}
                          justSavedNoteId={justSavedNoteId}
                          isActive
                          isRunning={state.isRunning}
                          activeElapsed={topic.elapsed}
                          className="focus-mode__topic-progress"
                          showTooltips={false}
                        />
                        <button
                          type="button"
                          className={`focus-mode__note-trigger${state.isRunning ? ' is-breathing' : ''}${usesMiniVariant || isFocusNoteMode ? ' is-visible' : ''}`}
                          onClick={() => {
                            if (topic.id !== selectedTopic?.id) {
                              selectTopic(topic.id);
                            }
                            openFocusNoteComposer();
                          }}
                          style={{ '--focus-progress-percent': `${getTopicProgress(topic)}` }}
                          aria-label={`Add note to ${topic.name}`}
                          title={`Add note to ${topic.name}`}
                        >
                          <svg
                            className="focus-mode__note-trigger-shape"
                            viewBox="0 0 48 48"
                            aria-hidden="true"
                          >
                            <path d="M24 2C18.2 8.1 12 13.7 12 28A12 12 0 0 0 36 28C36 13.7 29.8 8.1 24 2Z" />
                          </svg>
                          <span className="focus-mode__note-trigger-icon" aria-hidden="true">
                            <PlusIcon />
                          </span>
                        </button>
                      </div>
                      <div className="focus-mode__note-preview" aria-live="polite" aria-atomic="true">
                        <span className="focus-mode__note-preview-label">
                          {previewNote ? `Note ${String(previewNoteIndex).padStart(2, '0')}` : `${String(trackNotes.length).padStart(2, '0')} notes`}
                        </span>
                        <span className="focus-mode__note-preview-text" title={previewNote?.text}>
                          {previewNote ? previewNote.text : 'Notes appear here as the session progresses.'}
                        </span>
                        {previewNote ? (
                          <span className="focus-mode__note-preview-time">
                            {formatMinuteSecond(previewNote.offsetSeconds)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                
                <div className="focus-mode__note-layer">
                  <form
                    className={`focus-mode__note-composer${isFocusNoteMode ? ' is-active' : ''}`}
                    onSubmit={addNote}
                    autoComplete="off"
                  >
                    <label className="sr-only" htmlFor="focus-note-input">
                      Focus note
                    </label>
                    <div className="focus-mode__note-input-shell" style={{ position: 'relative' }}>
                      {usesMiniVariant && isFocusNoteMode ? (
                        <button
                          type="button"
                          className="focus-mode__note-shortcut"
                          aria-label="Insert checklist item"
                          title="Insert checklist item"
                          onPointerDown={handleFocusChecklistShortcutPointerDown}
                          onClick={insertFocusChecklistMarker}
                        >
                          <code>[ ]</code>
                        </button>
                      ) : null}
                      <input
                        id="focus-note-input"
                        ref={noteInputRef}
                        className={`focus-mode__note-input${isFocusNoteMode ? ' is-visible' : ' is-hidden'}${usesMiniVariant && isFocusNoteMode ? ' has-shortcut' : ''
                          }`}
                        type="text"
                        autoComplete="off"
                        value={noteDraft}
                        onChange={(event) => updateNoteDraft(event.target.value)}
                        onKeyDown={handleNoteInputKeyDown}
                        onFocus={handleFocusNoteInputFocus}
                        onBlur={handleFocusNoteInputBlur}
                        placeholder={isEditingNote ? 'Edit note' : 'Capture a focus note'}
                      />
                    </div>
                    {isFocusNoteMode ? (
                      <>
                        <button
                          type="submit"
                          className={`focus-mode__note-submit${usesMiniVariant ? ' is-icon-only' : ''}`}
                          aria-label="Save note"
                          title="Save note"
                        >
                          {usesMiniVariant ? <CheckIcon /> : 'Save note'}
                        </button>
                      </>
                    ) : null}
                  </form>

                  {!isFocusNoteMode ? (
                    <p className="focus-mode__hint">
                      {usesMiniVariant
                        ? 'Type for notes. Space toggles play. J/K move topics.'
                        : 'Type to capture a note. Space plays or pauses. J and K move between topics. Esc exits focus mode.'}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="focus-mode__empty">
                <p>No topic selected</p>
                <strong>Add a topic to start focus mode.</strong>
              </div>
            )}
          </section>

          {focusTopic ? (
            <aside
              className={`focus-task-panel${isFocusTaskPanelOpen ? ' is-open' : ''}`}
              aria-label="Current topic tasks"
            >
              <div
                id="focus-task-panel-sheet"
                className="focus-task-panel__sheet"
                aria-hidden={!isFocusTaskPanelOpen}
              >
                <div className="focus-task-panel__header">
                  <p>Topic tasks</p>
                  <strong>{focusTopic.name}</strong>
                </div>

                {focusActionItems.length ? (
                  <div className="focus-task-panel__items">
                    {focusActionItems.map((action) => (
                      <label key={action.noteId} className="action-item">
                        <input
                          type="checkbox"
                          checked={action.checked}
                          onChange={(event) =>
                            toggleActionItemForTopic(
                              focusTopic.id,
                              action.noteId,
                              event.target.checked,
                            )
                          }
                        />
                        <span>{action.label}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="empty-copy">
                    Add markdown todos like <code>- [ ] Follow up</code> in notes to reveal
                    checkboxes here.
                  </p>
                )}
              </div>

              <button
                type="button"
                className="focus-task-panel__toggle"
                aria-expanded={isFocusTaskPanelOpen}
                aria-controls="focus-task-panel-sheet"
                aria-label={isFocusTaskPanelOpen ? 'Hide topic tasks' : 'Show topic tasks'}
                title="Topic tasks"
                onClick={() => setIsFocusTaskPanelOpen((previous) => !previous)}
              >
                <TaskListIcon />
                <span>{focusActionItems.length}</span>
              </button>
            </aside>
          ) : null}

          <div
            className={`focus-mode__floating-controls${showFocusControlsAux ? ' is-aux-visible' : ''}`}
            role="toolbar"
            aria-label="Focus mode controls"
            onMouseEnter={() => revealFocusControlsAux()}
            onMouseLeave={() => {
              clearFocusControlsHideTimeout();
              setIsFocusControlsAuxVisible(false);
            }}
            onFocusCapture={() => revealFocusControlsAux()}
            onBlurCapture={(event) => {
              const nextTarget = event.relatedTarget;
              if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
                return;
              }

              clearFocusControlsHideTimeout();
              setIsFocusControlsAuxVisible(false);
            }}
            onPointerDown={(event) => {
              if (event.pointerType !== 'mouse' && !usesMiniVariant) {
                revealFocusControlsAux({ autoHide: true, delay: 3200 });
              }
            }}
          >
            <button
              type="button"
              className="focus-mode__control"
              onClick={() => moveTopicBy(-1)}
              disabled={currentIndex <= 0}
              aria-label="Go to previous topic"
              title="Previous topic (K)"
            >
              <ArrowIcon direction="left" />
            </button>
            <button
              type="button"
              className="focus-mode__control"
              onClick={resetSelectedTopic}
              disabled={!focusTopic || focusTopic.elapsed <= 0}
              aria-label="Reset current topic"
              title="Reset topic"
            >
              <ResetIcon />
            </button>
            <button
              type="button"
              className={`focus-mode__control focus-mode__control--primary${state.isRunning ? ' is-running' : ''}`}
              onClick={toggleTimer}
              aria-label={state.isRunning ? 'Pause session' : 'Start session'}
              title={state.isRunning ? 'Pause session (Space)' : 'Start session (Space)'}
            >
              <PlayPauseIcon isRunning={state.isRunning} />
            </button>
            <button
              type="button"
              className="focus-mode__control focus-mode__control--success"
              onClick={markAddressed}
              disabled={!focusTopic}
              aria-label="Mark current topic addressed"
              title="Mark topic addressed"
            >
              <CheckIcon />
            </button>
            <button
              type="button"
              className="focus-mode__control"
              onClick={() => moveTopicBy(1)}
              disabled={!topics.length || currentIndex >= topics.length - 1}
              aria-label="Go to next topic"
              title="Next topic (J)"
            >
              <ArrowIcon direction="right" />
            </button>
            {showFocusControlsAux ? (
              <label className="focus-mode__auto-next-toggle">
                <input
                  type="checkbox"
                  checked={state.autoAdvance}
                  onChange={(event) =>
                    setState((previous) => ({ ...previous, autoAdvance: event.target.checked }))
                  }
                  aria-label="Auto Next Topic"
                />
                <span>Auto next</span>
              </label>
            ) : null}
          </div>

          <section className="focus-mode__dock" aria-label="Upcoming topics">
            <div className="focus-mode__dock-inner">
              {focusNextTopic ? (
                <button
                  type="button"
                  className="focus-topic-card focus-topic-card--next"
                  onClick={() => activateTopicFromFocus(focusNextTopic.id)}
                >
                  <span className="focus-topic-card__eyebrow">{usesMiniVariant ? 'Next' : 'Up next'}</span>
                  <strong>{focusNextTopic.name}</strong>
                  <span className="focus-topic-card__meta">
                    {usesMiniVariant
                      ? `T${currentIndex + 2} · ${formatShortDuration(focusNextTopic.seconds)}`
                      : `${formatShortDuration(focusNextTopic.seconds)} · Topic ${currentIndex + 2}`}
                  </span>
                </button>
              ) : (
                <div className="focus-topic-card focus-topic-card--next is-empty">
                  <span className="focus-topic-card__eyebrow">{usesMiniVariant ? 'Next' : 'Up next'}</span>
                  <strong>No more queued topics</strong>
                  <span className="focus-topic-card__meta">You’ve reached the end of this agnda.</span>
                </div>
              )}

              {!usesMiniVariant && focusQueuedTopics.length ? (
                <div className="focus-mode__queue">
                  {focusQueuedTopics.map((topic, index) => (
                    <button
                      key={topic.id}
                      type="button"
                      className="focus-topic-card focus-topic-card--queued"
                      onClick={() => activateTopicFromFocus(topic.id)}
                    >
                      <span className="focus-topic-card__eyebrow">Later</span>
                      <strong>{topic.name}</strong>
                      <span className="focus-topic-card__meta">
                        {usesMiniVariant
                          ? `T${currentIndex + index + 3} · ${formatShortDuration(topic.seconds)}`
                          : `${formatShortDuration(topic.seconds)} · Topic ${currentIndex + index + 3}`}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          {usesMiniVariant ? (
            <button
              type="button"
              className="mini-mode-dismiss"
              onClick={dismissMiniMode}
              aria-label="Exit mini mode"
              title="Exit mini mode"
            >
              <CloseIcon />
            </button>
          ) : null}
        </section>
      ) : (
        <>
      <button
        type="button"
        className="menu-toggle"
        onClick={() => setIsDrawerOpen((previous) => !previous)}
        aria-expanded={isDrawerOpen}
        aria-controls="agenda-drawer"
        aria-label="Open saved agendas"
      >
        <span />
        <span />
        <span />
      </button>

      <aside
        id="agenda-drawer"
        className={`agenda-drawer${isDrawerOpen ? ' is-open' : ''}`}
        aria-hidden={!isDrawerOpen}
      >
        <div className="agenda-drawer__header">
          <p>Agendas</p>
          <div className="agenda-drawer__header-actions">
            <button
              type="button"
              className="drawer-icon-button"
              onClick={createNewAgenda}
              aria-label="Create new agnda"
              title="Create new agnda"
            >
              <PlusIcon />
            </button>
            <button type="button" onClick={() => setIsDrawerOpen(false)}>
              Close
            </button>
          </div>
        </div>

        <div className="agenda-drawer__presets">
          <p>Preset times</p>
          <div className="preset-time-grid">
            {TOPIC_DURATION_OPTIONS.map((option) => (
              <button
                key={option.seconds}
                type="button"
                className={`preset-time-button${selectedTopic?.seconds === option.seconds ? ' is-selected' : ''
                  }`}
                onClick={() => updateSelectedTopicDuration(option.seconds)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="toggle-row drawer-toggle-row">
            <input
              type="checkbox"
              checked={state.autoRevisitOnSelect}
              onChange={toggleAutoRevisitOnSelect}
            />
            <span>Auto revisit on topic tap</span>
          </label>
        </div>

        <div className="agenda-drawer__cards">
          <p>Today</p>
          <button
            type="button"
            className="saved-agenda-card is-current"
            onClick={() => goToAgenda(currentAgendaCard.target)}
          >
            <small>{currentAgendaCard.hash}</small>
            <strong>{currentAgendaCard.firstTopic || currentAgendaCard.hash}</strong>
          </button>
        </div>

        <div className="agenda-drawer__cards">
          <p>Saved agndas</p>
          {previousSavedAgendas.length ? (
            previousSavedAgendas.map((agenda) => (
              <div key={agenda.agendaId} className="saved-agenda-card-wrap">
                <button
                  type="button"
                  className="saved-agenda-card"
                  onClick={() => openSavedAgenda(agenda)}
                >
                  <small>{agenda.hash}</small>
                  <strong>{agenda.firstTopic || agenda.hash}</strong>
                </button>
                <button
                  type="button"
                  className="saved-agenda-card__delete"
                  aria-label={`Delete ${agenda.title}`}
                  title="Delete agnda"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeSavedAgenda(agenda);
                  }}
                >
                  <TrashIcon />
                </button>
              </div>
            ))
          ) : (
            <p className="drawer-empty-copy">No previous agndas yet.</p>
          )}
        </div>
        <div className="agenda-drawer__templates">
          <p>Templates</p>
          <div className="template-button-grid">
            {TEMPLATE_PRESETS.map((template) => (
              <button
                key={template.id}
                type="button"
                className="template-button"
                onClick={() => applyTemplate(template.id)}
              >
                {template.label}
              </button>
            ))}
          </div>
        </div>


        <div className="agenda-drawer__themes">
          <p>Theme style</p>
          <div className="theme-picker" role="tablist" aria-label="Visual theme styles">
            {THEME_OPTIONS.map((theme) => (
              <button
                key={theme.id}
                type="button"
                role="tab"
                aria-selected={themeId === theme.id}
                className={`theme-option${themeId === theme.id ? ' is-active' : ''}`}
                onClick={() => setThemeId(theme.id)}
              >
                <span className="theme-option__icon" aria-hidden="true">
                  {theme.icon}
                </span>
                <span className="theme-option__name">{theme.name}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {
        isDrawerOpen ? (
          <button
            type="button"
            className="drawer-scrim"
            onClick={() => setIsDrawerOpen(false)}
            aria-label="Close saved agendas"
          />
        ) : null
      }

      <section className="workspace">
        <section className="workspace-main">
          <section className="column column-topics">
            <div className="panel topics-panel">
              <div className="section-header topics-panel__header">
                <div className="topics-panel__branding">
                  <p className="topics-panel__kicker">Agnda</p>
                  <div className="topics-panel__identity-row">
                    <h2>{agendaDisplayName}</h2>

                    <div className="topics-panel__info-anchor">
                      <button
                        ref={agendaInfoButtonRef}
                        type="button"
                        className="topics-panel__info-button"
                        aria-expanded={isAgendaInfoOpen}
                        aria-controls="agenda-info-popover"
                        aria-label={isAgendaInfoOpen ? 'Hide agenda info' : 'Show agenda info'}
                        title="Agenda info"
                        onClick={() => {
                          setOpenMobileCopyMenu(null);
                          setIsAgendaInfoOpen((previous) => !previous);
                        }}
                      >
                        <InfoIcon />
                      </button>

                      {isAgendaInfoOpen ? (
                        <div
                          ref={agendaInfoPopoverRef}
                          id="agenda-info-popover"
                          className="topics-panel__info-popover"
                          role="dialog"
                          aria-labelledby="agenda-info-title"
                        >
                          <div className="topics-panel__info-header">
                            <div className="topics-panel__info-copy">
                              <p className="topics-panel__info-date">{todayLabel}</p>
                              <h3 id="agenda-info-title">Agenda info</h3>
                            </div>
                            <button
                              type="button"
                              className="topics-panel__info-close"
                              onClick={() => setIsAgendaInfoOpen(false)}
                              aria-label="Close agenda info"
                              title="Close agenda info"
                            >
                              <CloseIcon />
                            </button>
                          </div>

                          <label className="title-field">
                            <span className="sr-only">Agenda title</span>
                            <input
                              ref={agendaTitleInputRef}
                              type="text"
                              value={state.title}
                              onChange={(event) => updateTitle(event.target.value)}
                              onBlur={normalizeTitleOnBlur}
                              placeholder="Name this agnda"
                            />
                          </label>

                          <form className="add-topic-form" onSubmit={handleAddTopic}>
                            <input
                              ref={addTopicInputRef}
                              type="text"
                              value={newTopicName}
                              onChange={(event) => setNewTopicName(event.target.value)}
                              placeholder="Add a topic"
                            />
                            <button type="submit">Add</button>
                          </form>
                        </div>
                      ) : null}
                    </div>

                    <span className="topics-panel__label">• Topics</span>
                  </div>
                </div>
                <div className="topics-panel__header-controls">
                  <strong>{topics.length}</strong>
                  {isMobileViewport ? (
                    <MobileCopyMenu
                      buttonRef={topicsCopyButtonRef}
                      menuRef={topicsCopyMenuRef}
                      copied={copiedMobileCopyScope === 'topics'}
                      isOpen={isTopicsMobileCopyMenuOpen}
                      menuId="topics-copy-menu"
                      buttonLabel="Show agenda copy actions"
                      actionLabel="Copy all topics markdown"
                      onToggle={() => toggleMobileCopyMenu('topics')}
                      onAction={() => handleMobileCopyAction('agenda', 'topics')}
                    />
                  ) : null}
                </div>
              </div>

              <div className="topics-panel__body">
                <div className="topic-list" role="list" aria-label="Agenda topics">
                  {topics.map((topic) => {
                    const tag = getTagMeta(topic.tag);
                    const isSelected = topic.id === selectedTopic?.id;
                    const isActive = topic.id === activeTopic?.id;
                    const isCounting = isActive && state.isRunning;
                    const isDragging = dragState?.draggedId === topic.id;
                    const dropPlacement =
                      dragState?.draggedId &&
                        dragState.draggedId !== topic.id &&
                        dragState.overId === topic.id
                        ? dragState.placement
                        : '';

                    return (
                      <button
                        key={topic.id}
                        type="button"
                        role="listitem"
                        draggable={topics.length > 1}
                        className={`topic-card${isSelected ? ' is-selected' : ''}${topic.addressed ? ' is-addressed' : ''
                          }${isActive ? ' is-active' : ''}${isCounting ? ' is-counting' : ''}${isDragging ? ' is-dragging' : ''
                          }${dropPlacement === 'before' ? ' is-drop-before' : ''}${dropPlacement === 'after' ? ' is-drop-after' : ''
                          }`}
                        onClick={() => selectTopic(topic.id)}
                        onDragStart={(event) => handleTopicDragStart(event, topic.id)}
                        onDragOver={(event) => handleTopicDragOver(event, topic.id)}
                        onDrop={(event) => handleTopicDrop(event, topic.id)}
                        onDragEnd={handleTopicDragEnd}
                      >
                        <span className={`topic-card__rail topic-card__rail--${tag?.tone ?? 'neutral'}`} />
                        <span className="topic-card__content">
                          <span className="topic-card__meta">
                            <span
                              className={`topic-chip topic-chip--${tag?.tone ?? 'neutral'}${topic.tag ? '' : ' is-empty'
                                }`}
                            >
                              {tag?.label ?? 'Select tag'}
                            </span>
                            <span>{formatShortDuration(topic.seconds)}</span>
                          </span>
                          <span className="topic-card__title">{topic.name}</span>
                          <TopicProgressTrack
                            topic={topic}
                            notes={getRenderableTopicNotes(topic)}
                            themeId={themeId}
                            hoveredNoteId={hoveredNoteId}
                            onHoverNote={setHoveredNoteId}
                            onLeaveNote={(noteId) =>
                              setHoveredNoteId((previous) => (previous === noteId ? null : previous))
                            }
                            previewedNoteId={previewedNoteId}
                            isActive={isActive}
                            isRunning={state.isRunning}
                            activeElapsed={activeTopic?.elapsed ?? 0}
                            hideNotes={shouldHideTopicCardProgressNotes}
                          />
                        </span>
                      </button>
                    );
                  })}
                </div>

                <p className="topics-estimate">EST COMPLETION BY {estimatedCompletionLabel}</p>
              </div>
            </div>
          </section>

          {isMobileViewport ? (
            <section className="column column-actions-mobile">
              <AgendaActionsPanel {...agendaActionsPanelProps} />
            </section>
          ) : null}

          <section className="column column-detail">
            <div className="panel detail-panel">
              {selectedTopic ? (
                <>
                  <div className="section-header">
                    <div ref={detailHeaderRef}>
                      <p>Selected topic</p>
                      <h2>{selectedTopicStatusLabel}</h2>
                    </div>
                    <div className="detail-panel__header-controls">
                      <strong>{formatClock(selectedTopicRemainingSeconds)}</strong>
                      {isMobileViewport ? (
                        <MobileCopyMenu
                          buttonRef={detailCopyButtonRef}
                          menuRef={detailCopyMenuRef}
                          copied={copiedMobileCopyScope === 'detail'}
                          isOpen={isDetailMobileCopyMenuOpen}
                          menuId="detail-copy-menu"
                          buttonLabel="Show topic copy actions"
                          actionLabel="Copy topic markdown"
                          onToggle={() => toggleMobileCopyMenu('detail')}
                          onAction={() => handleMobileCopyAction('topic', 'detail')}
                        />
                      ) : null}
                    </div>
                  </div>

                  {nextTopic ? (
                    <div className="next-topic-card">
                      <p>Next topic context</p>
                      <strong>Up next: {nextTopic.name}</strong>
                      <span>{formatShortDuration(nextTopic.seconds)}</span>
                    </div>
                  ) : (
                    <div className="next-topic-card is-empty">
                      <p>Next topic context</p>
                      <strong>No pending topics</strong>
                    </div>
                  )}

                  <label className="detail-title-field">
                    <span className="sr-only">Topic title</span>
                    <input
                      type="text"
                      value={selectedTopic.name}
                      onChange={(event) => updateSelectedTopicName(event.target.value)}
                      onBlur={updateSelectedTopicNameOnBlur}
                    />
                  </label>

                  <div className="detail-meta-row">
                    <label className="select-pill">
                      <span className="sr-only">Topic tag</span>
                      <select
                        value={selectedTopic.tag}
                        onChange={(event) => updateSelectedTopicTag(event.target.value)}
                      >
                        <option value="">Select a tag</option>
                        {TOPIC_TAGS.map((tag) => (
                          <option key={tag.id} value={tag.id}>
                            {tag.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="select-pill">
                      <span className="sr-only">Topic duration</span>
                      <input
                        type="text"
                        value={durationDraft}
                        className="duration-input"
                        role="combobox"
                        aria-label="Topic duration"
                        list="topic-duration-options"
                        placeholder="1:30 or 1m 30s"
                        onChange={(event) => handleDurationDraftChange(event.target.value)}
                        onBlur={commitDurationDraft}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') {
                            return;
                          }

                          event.preventDefault();
                          commitDurationDraft();
                        }}
                      />
                      <datalist id="topic-duration-options">
                        {durationSuggestions.map((label) => (
                          <option key={label} value={label} />
                        ))}
                      </datalist>
                    </label>
                  </div>

                  <div className="detail-stats">
                    <div>
                      <span>Elapsed</span>
                      <strong>{formatShortDuration(selectedTopic.elapsed)}</strong>
                    </div>
                    <div>
                      <span>Remaining</span>
                      <strong>{formatShortDuration(selectedTopicRemainingSeconds)}</strong>
                    </div>
                  </div>

                  <section className="notes-section">
                    <div className="section-header section-header--compact">
                      <div>
                        <p>Notes</p>
                      </div>
                    </div>

                    <form className="note-form" onSubmit={addNote} autoComplete="off">
                      <input
                        ref={noteInputRef}
                        type="text"
                        autoComplete="off"
                        value={noteDraft}
                        onChange={(event) => updateNoteDraft(event.target.value)}
                        onKeyDown={handleNoteInputKeyDown}
                        placeholder={
                          isEditingNote
                            ? 'Edit note'
                            : `Capture agnda notes for ${notePlaceholderDate}`
                        }
                      />
                      {isEditingNote ? (
                        <button
                          type="button"
                          className="note-form__cancel"
                          onClick={cancelNoteComposer}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </form>

                    <div className="note-list">
                      {renderedSelectedTopicNotes.map((note, noteIndex) => (
                        <article
                          key={note.id}
                          className={`note-bubble${hoveredNoteId === note.id ? ' is-highlighted' : ''}`}
                          onMouseEnter={() => setHoveredNoteId(note.id)}
                          onMouseLeave={() =>
                            setHoveredNoteId((previous) => (previous === note.id ? null : previous))
                          }
                        >
                          <span className="note-bubble__stamp">{noteIndex + 1}</span>
                          <div className="note-bubble__body">
                            <p>
                              <span className="note-bubble__time">
                                {formatMinuteSecond(note.offsetSeconds)}
                              </span>
                              <span>{renderNoteText(note.text)}</span>
                            </p>
                            <div className="note-bubble__actions">
                              <button
                                type="button"
                                className="note-icon-button"
                                aria-label={`Edit note ${noteIndex + 1}`}
                                title="Edit note"
                                onClick={() => editNote(note.id)}
                              >
                                <EditIcon />
                              </button>
                              <button
                                type="button"
                                className="note-icon-button"
                                aria-label={`Delete note ${noteIndex + 1}`}
                                title="Delete note"
                                onClick={() => deleteNote(note.id)}
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>

                  <section className="actions-section">
                    <div className="section-header section-header--compact">
                      <div>
                        <p>Action Items</p>
                      </div>
                    </div>

                    <div className="action-list">
                      {actionItems.length ? (
                        actionItems.map((action) => (
                          <label key={action.noteId} className="action-item">
                            <input
                              type="checkbox"
                              checked={action.checked}
                              onChange={(event) =>
                                toggleActionItem(action.noteId, event.target.checked)
                              }
                            />
                            <span>{action.label}</span>
                          </label>
                        ))
                      ) : (
                        <p className="empty-copy">
                          Add markdown todos like <code>- [ ] Follow up</code> in notes to surface
                          them here.
                        </p>
                      )}
                    </div>
                  </section>

                  <div className="detail-actions">
                    {selectedTopic.elapsed > 0 ? (
                      <button type="button" onClick={resetSelectedTopic}>
                        Reset topic
                      </button>
                    ) : null}
                    {!isSelectedTopicCounting ? (
                      <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                        <button type="button" onClick={revisitTopic} style={{ flex: 1 }}>
                          {selectedTopicVisitLabel}
                        </button>
                        <button type="button" onClick={revisitSecondaryTopic} title="Start as a secondary concurrent topic" style={{ flex: 1, background: 'var(--panel-float)', color: 'var(--ink)' }}>
                          Side-by-side
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={revisitSecondaryTopic} title="Start as a secondary concurrent topic" style={{ background: 'var(--panel-float)', color: 'var(--ink)' }}>
                        Side-by-side
                      </button>
                    )}
                    <button type="button" className="danger-button" onClick={removeSelectedTopic}>
                      Remove topic
                    </button>
                    {!selectedTopic.addressed ? (
                      <button type="button" className="primary-button" onClick={markAddressed}>
                        ✔ Mark as addressed
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <button type="button" className="empty-state-button">
                  Select a topic
                </button>
              )}
            </div>
          </section>

          <section className="column column-side">
            {!isSessionPanelMinimized ? (
              <div
                className={`panel session-panel top-card time-card${isEndingSoon ? ' is-ending-soon' : ''}${didTopicEnd ? ' is-ended' : ''
                  }`}
              >
                <div className="section-header section-header--compact session-panel__header">
                  <div>
                    <p>Session clock</p>
                    <h2>Time so far</h2>
                  </div>
                  <div className="session-panel__header-controls">
                    <strong>{formatShortDuration(totalElapsed)}</strong>
                    <button
                      type="button"
                      className="session-panel__minimize"
                      aria-label="Minimize session clock"
                      title="Minimize session clock"
                      onClick={() => setIsSessionPanelMinimized(true)}
                    >
                      <MinimizeIcon />
                    </button>
                  </div>
                </div>

                {sessionTopic ? (
                  <button
                    type="button"
                    className="time-card__focus time-card__focus-button"
                    aria-label={`Go to current topic ${sessionTopic.name}`}
                    onClick={() => selectTopic(sessionTopic.id)}
                  >
                    <span>Current topic remaining</span>
                    <strong>{formatClock(sessionTopicRemainingSeconds)}</strong>
                  </button>
                ) : (
                  <div className="time-card__focus">
                    <span>No topic selected</span>
                    <strong>--:--</strong>
                  </div>
                )}

                <ProgressVisual
                  percent={sessionProgressPercent}
                  themeId={themeId}
                  type={themeId === 'vibrant' ? 'circular' : 'bar'}
                  size={120}
                />

                <div className="metric-row">
                  <span>Total</span>
                  <strong>{formatShortDuration(totalSeconds)}</strong>
                </div>
                <div className="metric-row">
                  <span>Remaining</span>
                  <strong>{formatShortDuration(remainingSessionSeconds)}</strong>
                </div>
                <div className="session-controls">
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={state.autoAdvance}
                      onChange={(event) =>
                        setState((previous) => ({ ...previous, autoAdvance: event.target.checked }))
                      }
                    />
                    <span>Auto-advance topic</span>
                  </label>
                  <button type="button" className={`primary-button${state.isRunning ? ' is-running' : ''}`} onClick={toggleTimer}>
                    {state.isRunning ? 'Pause session' : 'Start session'}
                  </button>
                  <button type="button" className="secondary-button" onClick={enterFocusMode}>
                    Focus mode
                  </button>
                </div>
              </div>
            ) : null}
            {!isMobileViewport ? <AgendaActionsPanel {...agendaActionsPanelProps} /> : null}
          </section>
        </section>

        {isSessionPanelMinimized ? (
          <section className="panel session-float" role="region" aria-label="Floating session clock">
            <div className="session-float__header">
              <p>Session clock</p>
              <button
                type="button"
                className="session-float__expand"
                aria-label="Expand session clock"
                title="Expand session clock"
                onClick={() => setIsSessionPanelMinimized(false)}
              >
                <ExpandIcon />
              </button>
            </div>

            <div className="session-float__body">
              <div className="session-float__clock-shell">
                {sessionTopic ? (
                  <button
                    type="button"
                    className="session-float__ring-button"
                    aria-label={`Go to current topic ${sessionTopic.name}`}
                    onClick={() => selectTopic(sessionTopic.id)}
                  >
                    <FocusAgendaRing
                      topics={topics}
                      currentIndex={currentIndex}
                      sessionProgressPercent={sessionProgressPercent}
                    remainingSessionSeconds={remainingSessionSeconds}
                    totalSeconds={totalSeconds}
                    isRunning={state.isRunning}
                    compact
                    progressOutside
                    className="focus-agenda-ring session-float__ring"
                  />
                </button>
              ) : (
                  <FocusAgendaRing
                    topics={topics}
                    currentIndex={currentIndex}
                    sessionProgressPercent={sessionProgressPercent}
                    remainingSessionSeconds={remainingSessionSeconds}
                    totalSeconds={totalSeconds}
                    isRunning={state.isRunning}
                    compact
                    progressOutside
                    className="focus-agenda-ring session-float__ring"
                  />
                )}
              </div>
              {sessionTopic ? (
                <div className="session-float__copy" aria-hidden="true">
                  <span>{sessionTopic.name}</span>
                </div>
              ) : (
                <div className="session-float__copy">
                  <span>No topic selected</span>
                  <small>{formatShortDuration(totalElapsed)} elapsed</small>
                </div>
              )}
            </div>

            <div className="session-float__actions">
              <button
                type="button"
                className="session-float__icon-button"
                aria-label={state.isRunning ? 'Pause session' : 'Start session'}
                title={state.isRunning ? 'Pause session' : 'Start session'}
                onClick={toggleTimer}
              >
                <PlayPauseIcon isRunning={state.isRunning} />
              </button>
              <button
                type="button"
                className="session-float__focus-button"
                onClick={enterFocusMode}
              >
                Focus mode
              </button>
            </div>
          </section>
        ) : null}
      </section>

        </>
      )}
    </main>
  );
}
