import { useEffect, useRef, useState } from 'react';
import { buildAgendaHash, humanizeAgendaId, normalizeAgendaId } from './lib/hashAgenda';
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
import './styles.css';

const TODO_PATTERN = /^\s*(?:-\s*)?\[\s*([xX]?)\s*\]\s*(.+)$/;
const URL_PATTERN = /https?:\/\/[^\s]+/g;
const THEME_STORAGE_KEY = 'agnda:visual-theme:v1';
const THEME_OPTIONS = [
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

function activateTopicInState(previous, topicId) {
  const nextIndex = previous.topics.findIndex((topic) => topic.id === topicId);
  if (nextIndex < 0) {
    return previous;
  }

  return {
    ...previous,
    currentIndex: nextIndex,
    selectedTopicId: topicId,
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

function ProgressVisual({ percent, themeId, type = 'bar', size = 48 }) {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  if (themeId === 'vibrant' && type === 'circular') {
    return (
      <div className="progress-circular" style={{ width: size, height: size }}>
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
  const [newTopicName, setNewTopicName] = useState('');
  const [durationDraft, setDurationDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [hoveredNoteId, setHoveredNoteId] = useState(null);
  const [dragState, setDragState] = useState(null);

  const tickerRef = useRef({ intervalId: null, lastTickMs: Date.now() });
  const renamedAgendaIdRef = useRef('');
  const noteInputRef = useRef(null);
  const detailHeaderRef = useRef(null);
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
  const currentAgendaCard = {
    agendaId: state.agendaId,
    hash: buildAgendaHash(state.agendaId),
    target: buildAgendaHash(state.agendaId),
    firstTopic: topics[0]?.name ?? state.title,
  };
  const previousSavedAgendas = savedAgendas.filter((agenda) => agenda.agendaId !== state.agendaId);
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
  const isEndingSoon = Boolean(
    isSelectedTopicCounting && selectedTopicRemainingSeconds > 0 && selectedTopicRemainingSeconds <= 10,
  );
  const didTopicEnd = Boolean(isSelectedTopicCounting && selectedTopicRemainingSeconds <= 0);
  const sessionProgressPercent =
    totalSeconds > 0 ? Math.min(100, Math.max(0, (totalElapsed / totalSeconds) * 100)) : 0;
  const activeTheme = THEME_OPTIONS.find((theme) => theme.id === themeId) ?? THEME_OPTIONS[0];

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
    if (!globalThis.window) {
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, themeId);
  }, [themeId]);

  useEffect(() => {
    const desiredHash = buildAgendaHash(state.agendaId);
    if (!globalThis.window || window.location.hash === desiredHash) {
      return;
    }

    const url = new URL(window.location.href);
    url.hash = desiredHash;
    window.history.replaceState(null, '', url);
  }, [state.agendaId]);

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
    const title = state.title.trim() || humanizeAgendaId(state.agendaId);
    document.title = `${title} | AGNDA`;
  }, [state.agendaId, state.title]);

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
    function handleKeyDown(event) {
      if (isEditableTarget(event.target)) {
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

      if (event.code === 'Space') {
        event.preventDefault();
        toggleTimer();
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        const nextTopic = createTopicFromMinutes('New topic', 5);
        setState((previous) => appendTopicWithoutInterrupting(previous, nextTopic));
      }

      if (event.key === 'Escape') {
        setIsDrawerOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawerOpen, selectedTopic]);

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
      window.requestAnimationFrame(() => noteInputRef.current?.focus());
      return;
    }

    setEditingNoteId(null);
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
    setNoteDraft('');
    noteDraftRef.current = '';
    draftNoteIdRef.current = null;
    noteDraftOffsetRef.current = null;
  }

  function resetTransientUi() {
    setIsDrawerOpen(false);
    setNewTopicName('');
    clearNoteComposer();
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

    noteInputRef.current?.focus();
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
      return;
    }

    if (hasMeaningfulText && noteDraftOffsetRef.current === null && Number.isFinite(offsetSeconds)) {
      noteDraftOffsetRef.current = offsetSeconds;
    }

    if (!topicId) {
      if (!hasMeaningfulText) {
        noteDraftOffsetRef.current = null;
      }
      return;
    }

    if (!hasMeaningfulText) {
      if (draftNoteIdRef.current) {
        const draftNoteId = draftNoteIdRef.current;
        updateTopic(topicId, (topic) => ({
          ...topic,
          notes: topic.notes.filter((note) => note.id !== draftNoteId),
        }));
        draftNoteIdRef.current = null;
      }

      noteDraftOffsetRef.current = null;
      return;
    }

    if (!draftNoteIdRef.current) {
      const noteId = makeEntityId('note');
      draftNoteIdRef.current = noteId;
      updateTopic(topicId, (topic) => ({
        ...topic,
        notes: [
          ...topic.notes,
          {
            id: noteId,
            text: value,
            offsetSeconds: Number.isFinite(offsetSeconds) ? offsetSeconds : topic.elapsed,
          },
        ],
      }));
      return;
    }

    const draftNoteId = draftNoteIdRef.current;
    updateTopic(topicId, (topic) => ({
      ...topic,
      notes: topic.notes.map((note) =>
        note.id === draftNoteId
          ? {
            ...note,
            text: value,
          }
          : note,
      ),
    }));
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

      return {
        ...previous,
        title: value,
        agendaId: nextAgendaId,
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
              id: makeEntityId('note'),
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
    window.requestAnimationFrame(() => noteInputRef.current?.focus());
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
    replaceHash(agenda?.hash || buildAgendaHash(loadedAgenda.agendaId));
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
    replaceHash(buildAgendaHash(agendaId));
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
    <main className={`app-shell theme-${themeId}`}>
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
        <section className="workspace-top">
          <div className="panel brand-panel top-card title-card">
            <p className="brand-kicker">AGNDA</p>
            <p className="brand-date">{todayLabel}</p>
            <label className="title-field">
              <span className="sr-only">Agenda title</span>
              <input
                type="text"
                value={state.title}
                onChange={(event) => updateTitle(event.target.value)}
                onBlur={normalizeTitleOnBlur}
                placeholder="Name this agnda"
              />
            </label>

            <form className="add-topic-form" onSubmit={handleAddTopic}>
              <input
                type="text"
                value={newTopicName}
                onChange={(event) => setNewTopicName(event.target.value)}
                placeholder="Add a topic"
              />
              <button type="submit">Add</button>
            </form>
          </div>

          <div
            className={`panel session-panel top-card time-card${isEndingSoon ? ' is-ending-soon' : ''}${didTopicEnd ? ' is-ended' : ''
              }`}
          >
            <div className="section-header section-header--compact">
              <div>
                <p>Session clock</p>
                <h2>Time so far</h2>
              </div>
              <strong>{formatShortDuration(totalElapsed)}</strong>
            </div>

            <div className="time-card__focus">
              <span>{selectedTopic ? 'Current topic remaining' : 'No topic selected'}</span>
              <strong>{selectedTopic ? formatClock(selectedTopicRemainingSeconds) : '--:--'}</strong>
            </div>

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
              <button type="button" className="primary-button" onClick={toggleTimer}>
                {state.isRunning ? 'Pause session' : 'Start session'}
              </button>
            </div>
          </div>

        </section>

        <section className="workspace-main">
          <section className="column column-topics">
            <div className="panel topics-panel">
              <div className="section-header">
                <div>
                  <p>Topics</p>
                  <h2>Today&apos;s flow</h2>
                </div>
                <strong>{topics.length}</strong>
              </div>

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
                        <span className="topic-card__progress" aria-hidden="true">
                          <span className="topic-card__progress-notes">
                            {topic.notes.map((note, noteIndex) => {
                              const isPassing =
                                isActive &&
                                state.isRunning &&
                                activeTopic.elapsed >= note.offsetSeconds &&
                                activeTopic.elapsed < note.offsetSeconds + 8;

                              return (
                                <span
                                  key={note.id}
                                  className={`topic-card__progress-note${hoveredNoteId === note.id || isPassing ? ' is-highlighted' : ''
                                    }${isPassing ? ' is-passing' : ''}`}
                                  style={{ left: `${getNoteMarkerOffset(topic, note)}%` }}
                                  onMouseEnter={() => setHoveredNoteId(note.id)}
                                  onMouseLeave={() => setHoveredNoteId((previous) =>
                                    previous === note.id ? null : previous,
                                  )}
                                >
                                  <span className="topic-card__progress-note-number">
                                    {noteIndex + 1}
                                  </span>
                                  <span className="topic-card__progress-tooltip">{note.text}</span>
                                </span>
                              );
                            })}
                          </span>
                          <ProgressVisual
                            percent={getTopicProgress(topic)}
                            themeId={themeId}
                            type="bar"
                          />
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <p className="topics-estimate">EST COMPLETION BY {estimatedCompletionLabel}</p>
            </div>
          </section>

          <section className="column column-detail">
            <div className="panel detail-panel">
              {selectedTopic ? (
                <>
                  <div className="section-header">
                    <div ref={detailHeaderRef}>
                      <p>Selected topic</p>
                      <h2>{selectedTopicStatusLabel}</h2>
                    </div>
                    <strong>{formatClock(selectedTopicRemainingSeconds)}</strong>
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
                      <select
                        value={selectedTopic.seconds}
                        onChange={(event) => updateSelectedTopicDuration(event.target.value)}
                      >
                        {durationOptions.map((option) => (
                          <option key={option.seconds} value={option.seconds}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="select-pill">
                      <span className="sr-only">Custom topic duration</span>
                      <input
                        type="text"
                        value={durationDraft}
                        className="duration-input"
                        placeholder="1:30 or 1m 30s"
                        onChange={(event) => setDurationDraft(event.target.value)}
                        onBlur={commitDurationDraft}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') {
                            return;
                          }

                          event.preventDefault();
                          commitDurationDraft();
                        }}
                      />
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

                    <form className="note-form" onSubmit={addNote}>
                      <input
                        ref={noteInputRef}
                        type="text"
                        value={noteDraft}
                        onChange={(event) => updateNoteDraft(event.target.value)}
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
                          onClick={clearNoteComposer}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </form>

                    <div className="note-list">
                      {selectedTopic.notes.map((note, noteIndex) => (
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
                      <button type="button" onClick={revisitTopic}>
                        {selectedTopicVisitLabel}
                      </button>
                    ) : null}
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

          <section className="column column-actions">
            <section className="panel agenda-actions-panel" aria-label="Agenda action items">
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
                    aria-expanded={isAgendaActionsExpanded}
                    aria-controls="agenda-actions-content"
                    aria-label={isAgendaActionsExpanded ? 'Collapse action items' : 'Expand action items'}
                    onClick={() => setIsAgendaActionsExpanded((previous) => !previous)}
                  >
                    <ChevronIcon expanded={isAgendaActionsExpanded} />
                  </button>
                </div>
              </div>

              <p className="agenda-actions-summary">
                {openActionItemCount} open / {completedActionItemCount} done
              </p>

              {isAgendaActionsExpanded ? (
                actionGroups.length ? (
                  <div id="agenda-actions-content" className="agenda-action-groups">
                    {actionGroups.map((group) => (
                      <section key={group.topicId} className="agenda-action-group">
                        <button
                          type="button"
                          className="agenda-action-group__topic"
                          onClick={() => selectTopic(group.topicId)}
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
                                  toggleActionItemForTopic(
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
          </section>
        </section>
      </section>
    </main >
  );
}
