import { useEffect, useMemo, useRef, useState } from 'react';
import { buildInitialState, loadInitialState, saveState } from './lib/storage';
import {
  DEFAULT_TOPICS,
  TEMPLATE_PRESETS,
  createTopic,
  createTopicFromMinutes,
  instantiateTopics,
} from './lib/topics';
import { clampIndex, formatClock, minutesFromSeconds } from './lib/time';
import './styles.css';

const RESOLUTION_LEVELS = Object.freeze([
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 },
  { label: '1h', seconds: 3600 },
]);

const DEFAULT_RESOLUTION_INDEX = 1;
const PIXELS_PER_RESOLUTION_STEP = 64;
const LANE_TOP = 26;
const ROW_HEIGHT = 38;
const COMMENT_LANE_SPACING = 26;

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

function createCommentId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSavedUrlEntries() {
  if (!globalThis.window || !window.localStorage) {
    return [];
  }

  const currentUrl = window.location.href;
  const currentPathUrl = `${window.location.origin}${window.location.pathname}`;

  const entries = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !/^https?:\/\//i.test(key)) {
      continue;
    }

    if (key === currentUrl || key === currentPathUrl || key === `${currentPathUrl}/`) {
      continue;
    }

    let topicCount = null;
    try {
      const payload = JSON.parse(window.localStorage.getItem(key) || 'null');
      if (Array.isArray(payload?.topics)) {
        topicCount = payload.topics.length;
      }
    } catch {
      topicCount = null;
    }

    entries.push({ key, topicCount });
  }

  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

function buildLayoutTopics(topics) {
  const rowById = {};
  const rowEndTimes = [];

  const sorted = [...topics].sort((a, b) => {
    const byStart = a.startSeconds - b.startSeconds;
    if (byStart !== 0) {
      return byStart;
    }

    return b.seconds - a.seconds;
  });

  sorted.forEach((topic) => {
    const start = Math.max(0, Number(topic.startSeconds) || 0);
    const end = start + (Number(topic.seconds) || 0);

    let row = 0;
    while ((rowEndTimes[row] ?? -Infinity) > start) {
      row += 1;
    }

    rowById[topic.id] = row;
    rowEndTimes[row] = end;
  });

  return topics.map((topic, index) => ({
    ...topic,
    index,
    row: rowById[topic.id] ?? 0,
    endSeconds: topic.startSeconds + topic.seconds,
  }));
}

function getMaxEndSeconds(topics) {
  return topics.reduce(
    (max, topic) => Math.max(max, (Number(topic.startSeconds) || 0) + (Number(topic.seconds) || 0)),
    0,
  );
}

function snapStartSeconds(rawStartSeconds, movingTopicId, topics, tickSeconds) {
  const raw = Math.max(0, Number(rawStartSeconds) || 0);
  const snappedTick = Math.round(raw / tickSeconds) * tickSeconds;

  let best = snappedTick;
  let bestDistance = Math.abs(raw - snappedTick);
  const maxSnapDistance = Math.max(tickSeconds, 60);

  topics.forEach((topic) => {
    if (topic.id === movingTopicId) {
      return;
    }

    const candidateStarts = [topic.startSeconds, topic.startSeconds + topic.seconds];
    candidateStarts.forEach((candidate) => {
      const distance = Math.abs(raw - candidate);
      if (distance <= maxSnapDistance && distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    });
  });

  return Math.max(0, Math.round(best));
}

function appendWorkHistory(history, fromCursor, toCursor) {
  if (toCursor <= fromCursor) {
    return Array.isArray(history) ? history : [];
  }

  const nextHistory = Array.isArray(history) ? [...history] : [];
  const workedSeconds = toCursor - fromCursor;
  const lastEntry = nextHistory[nextHistory.length - 1];

  if (lastEntry && lastEntry.toCursor === fromCursor) {
    lastEntry.toCursor = toCursor;
    lastEntry.workedSeconds = lastEntry.toCursor - lastEntry.fromCursor;
    return nextHistory;
  }

  nextHistory.push({
    fromCursor,
    toCursor,
    workedSeconds,
  });

  return nextHistory;
}

function advanceBySeconds(previous, deltaSeconds) {
  if (!previous.isRunning || deltaSeconds < 1 || !previous.topics.length) {
    return previous;
  }

  const currentIndex = clampIndex(previous.currentIndex, previous.topics.length);
  const fromCursor = Math.max(0, Math.round(previous.timelineCursorSeconds || 0));
  const toCursor = fromCursor + deltaSeconds;

  const nextTopics = previous.topics.map((topic, index) => {
    if (index !== currentIndex) {
      return topic;
    }

    return {
      ...topic,
      elapsed: topic.elapsed + deltaSeconds,
      lastWorkedCursor: toCursor,
      workHistory: appendWorkHistory(topic.workHistory, fromCursor, toCursor),
    };
  });

  let nextRunning = previous.isRunning;
  let nextIndex = currentIndex;

  if (previous.autoAdvance) {
    const active = nextTopics[currentIndex];
    if (active && active.elapsed >= active.seconds) {
      if (currentIndex < nextTopics.length - 1) {
        nextIndex = currentIndex + 1;
      } else {
        nextRunning = false;
      }
    }
  }

  return {
    ...previous,
    topics: nextTopics,
    currentIndex: nextIndex,
    isRunning: nextRunning,
    timelineCursorSeconds: toCursor,
  };
}

export default function App() {
  const [state, setState] = useState(() => loadInitialState());
  const [resolutionIndex, setResolutionIndex] = useState(DEFAULT_RESOLUTION_INDEX);
  const [selectedTopicId, setSelectedTopicId] = useState(null);
  const [armedSwapTopicId, setArmedSwapTopicId] = useState(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [isCommentComposerOpen, setIsCommentComposerOpen] = useState(false);
  const [openCommentId, setOpenCommentId] = useState(null);
  const [insertStatus, setInsertStatus] = useState('');
  const [timelineFrameWidth, setTimelineFrameWidth] = useState(0);
  const [showUrlMenu, setShowUrlMenu] = useState(false);
  const [savedUrlEntries, setSavedUrlEntries] = useState([]);

  const tickerRef = useRef({ intervalId: null, lastTickMs: Date.now() });
  const timelineFrameRef = useRef(null);
  const commentInputRef = useRef(null);
  const insertStatusTimeoutRef = useRef(null);
  const dragRef = useRef({
    topicId: null,
    startClientX: 0,
    originStartSeconds: 0,
    moved: false,
  });

  const topics = state.topics;
  const currentIndex = clampIndex(state.currentIndex, topics.length);
  const currentTopic = topics[currentIndex];
  const comments = Array.isArray(state.comments) ? state.comments : [];

  const layoutTopics = useMemo(() => buildLayoutTopics(topics), [topics]);

  const selectedTopic = useMemo(() => {
    if (!selectedTopicId) {
      return currentTopic;
    }

    return topics.find((topic) => topic.id === selectedTopicId) || currentTopic;
  }, [selectedTopicId, topics, currentTopic]);

  const selectedTopicIndex = useMemo(
    () => topics.findIndex((topic) => topic.id === selectedTopic?.id),
    [topics, selectedTopic],
  );

  const rowCount = useMemo(
    () => Math.max(1, layoutTopics.reduce((max, topic) => Math.max(max, topic.row + 1), 0)),
    [layoutTopics],
  );

  const totalElapsedSeconds = useMemo(
    () => topics.reduce((sum, topic) => sum + topic.elapsed, 0),
    [topics],
  );

  const timelineCursorSeconds = Math.max(0, Math.round(state.timelineCursorSeconds || 0));
  const resolution = RESOLUTION_LEVELS[resolutionIndex] || RESOLUTION_LEVELS[1];
  const pixelsPerSecond = PIXELS_PER_RESOLUTION_STEP / resolution.seconds;

  const maxEndSeconds = useMemo(
    () => Math.max(getMaxEndSeconds(topics), timelineCursorSeconds + resolution.seconds * 4, resolution.seconds * 6),
    [topics, timelineCursorSeconds, resolution.seconds],
  );

  const trackWidth = Math.max(
    maxEndSeconds * pixelsPerSecond,
    (timelineFrameWidth || 700) + PIXELS_PER_RESOLUTION_STEP * 6,
  );

  const translateX = (timelineFrameWidth || 700) / 2 - timelineCursorSeconds * pixelsPerSecond;

  const tickStepSeconds = resolution.seconds === 3600 ? 3600 : 30;
  const tickLabelEverySeconds = resolution.seconds === 3600 ? 3600 : 60;
  const tickCount = Math.ceil(maxEndSeconds / tickStepSeconds) + 1;

  const ticks = useMemo(
    () =>
      Array.from({ length: tickCount }, (_, index) => {
        const second = index * tickStepSeconds;
        const isMajor = second % tickLabelEverySeconds === 0;

        return {
          second,
          x: second * pixelsPerSecond,
          isMajor,
          label: isMajor ? formatClock(second) : '',
        };
      }),
    [tickCount, tickStepSeconds, tickLabelEverySeconds, pixelsPerSecond],
  );

  const nextUntouchedTopics = useMemo(
    () =>
      [...layoutTopics]
        .filter((topic) => topic.elapsed === 0 && topic.startSeconds >= timelineCursorSeconds)
        .sort((a, b) => a.startSeconds - b.startSeconds),
    [layoutTopics, timelineCursorSeconds],
  );

  const unfinishedTopics = useMemo(
    () =>
      layoutTopics
        .filter(
          (topic) =>
            topic.elapsed > 0 && topic.elapsed < topic.seconds && topic.id !== currentTopic?.id,
        )
        .sort((a, b) => (b.lastWorkedCursor || 0) - (a.lastWorkedCursor || 0)),
    [layoutTopics, currentTopic],
  );

  const sortedComments = useMemo(
    () => [...comments].sort((a, b) => a.atSeconds - b.atSeconds),
    [comments],
  );

  const activeLiveComment = useMemo(() => {
    const passed = sortedComments.filter((comment) => comment.atSeconds <= timelineCursorSeconds);
    return passed.length ? passed[passed.length - 1] : null;
  }, [sortedComments, timelineCursorSeconds]);

  const upcomingLiveComment = useMemo(
    () => sortedComments.find((comment) => comment.atSeconds > timelineCursorSeconds) || null,
    [sortedComments, timelineCursorSeconds],
  );

  useEffect(() => {
    if (!topics.length) {
      setState(buildInitialState(instantiateTopics(DEFAULT_TOPICS)));
      return;
    }

    if (!selectedTopicId) {
      setSelectedTopicId(topics[currentIndex]?.id || null);
      return;
    }

    if (!topics.some((topic) => topic.id === selectedTopicId)) {
      setSelectedTopicId(topics[currentIndex]?.id || null);
      setArmedSwapTopicId(null);
    }
  }, [topics, currentIndex, selectedTopicId]);

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    document.title = `Ganttimer ${formatClock(timelineCursorSeconds)} | AGNDA`;
  }, [timelineCursorSeconds]);

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
      setState((previous) => advanceBySeconds(previous, deltaSeconds));
    }, 250);

    return () => {
      if (tickerRef.current.intervalId) {
        window.clearInterval(tickerRef.current.intervalId);
        tickerRef.current.intervalId = null;
      }
    };
  }, [state.isRunning]);

  useEffect(() => {
    function updateTimelineWidth() {
      setTimelineFrameWidth(timelineFrameRef.current?.clientWidth || 0);
    }

    updateTimelineWidth();
    window.addEventListener('resize', updateTimelineWidth);

    return () => window.removeEventListener('resize', updateTimelineWidth);
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        setState((previous) => ({
          ...previous,
          isRunning: !previous.isRunning,
        }));
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setState((previous) => {
          const nextStart = getMaxEndSeconds(previous.topics);
          const newTopic = createTopicFromMinutes('New topic', 5, 0, { startSeconds: nextStart });
          const nextTopics = [...previous.topics, newTopic];
          return {
            ...previous,
            topics: nextTopics,
            currentIndex: nextTopics.length - 1,
            isRunning: false,
          };
        });
        return;
      }

      const isPrintable =
        event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;

      if (isPrintable) {
        event.preventDefault();
        setIsCommentComposerOpen(true);
        setCommentDraft((previous) => {
          if (!previous.length) {
            return event.key;
          }

          return `${previous}${event.key}`;
        });

        window.requestAnimationFrame(() => {
          commentInputRef.current?.focus();
          const caret = commentInputRef.current?.value.length || 0;
          commentInputRef.current?.setSelectionRange(caret, caret);
        });
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      if (insertStatusTimeoutRef.current) {
        window.clearTimeout(insertStatusTimeoutRef.current);
      }
    };
  }, []);

  function updateTopicById(topicId, updater) {
    setState((previous) => ({
      ...previous,
      topics: previous.topics.map((topic) => (topic.id === topicId ? updater(topic) : topic)),
    }));
  }

  function toggleTimer() {
    setState((previous) => ({
      ...previous,
      isRunning: !previous.isRunning,
    }));
  }

  function toggleAutoAdvance() {
    setState((previous) => ({
      ...previous,
      autoAdvance: !previous.autoAdvance,
    }));
  }

  function addTopic() {
    setState((previous) => {
      const nextStart = getMaxEndSeconds(previous.topics);
      const newTopic = createTopicFromMinutes('New topic', 5, 0, { startSeconds: nextStart });
      const nextTopics = [...previous.topics, newTopic];
      return {
        ...previous,
        topics: nextTopics,
        currentIndex: nextTopics.length - 1,
        isRunning: false,
      };
    });
  }

  function removeCurrentTopic() {
    setState((previous) => {
      if (previous.topics.length <= 1) {
        return buildInitialState([createTopicFromMinutes('New topic', 5)]);
      }

      const nextTopics = previous.topics.filter((_, index) => index !== currentIndex);

      return {
        ...previous,
        topics: nextTopics,
        currentIndex: clampIndex(currentIndex - 1, nextTopics.length),
        isRunning: false,
      };
    });

    setArmedSwapTopicId(null);
  }

  function pressTopic(topicId) {
    if (selectedTopicId !== topicId) {
      setSelectedTopicId(topicId);
      setArmedSwapTopicId(null);
      return;
    }

    if (topicId !== currentTopic?.id) {
      setArmedSwapTopicId((previous) => (previous === topicId ? null : topicId));
    }
  }

  function swapToTopic(topicId) {
    setState((previous) => {
      const nextIndex = previous.topics.findIndex((topic) => topic.id === topicId);
      if (nextIndex < 0) {
        return previous;
      }

      return {
        ...previous,
        currentIndex: nextIndex,
        isRunning: true,
      };
    });

    setSelectedTopicId(topicId);
    setArmedSwapTopicId(null);
  }

  function handleTopicPointerDown(event, topicId) {
    if (event.button !== 0) {
      return;
    }

    if (event.target instanceof HTMLElement && event.target.closest('.topic-play-button')) {
      return;
    }

    const topic = topics.find((candidate) => candidate.id === topicId);
    if (!topic) {
      return;
    }

    event.preventDefault();

    dragRef.current = {
      topicId,
      startClientX: event.clientX,
      originStartSeconds: topic.startSeconds,
      moved: false,
    };

    function handlePointerMove(moveEvent) {
      const drag = dragRef.current;
      if (!drag.topicId) {
        return;
      }

      const deltaPx = moveEvent.clientX - drag.startClientX;
      if (Math.abs(deltaPx) > 3) {
        dragRef.current.moved = true;
      }

      const rawStartSeconds = drag.originStartSeconds + deltaPx / pixelsPerSecond;

      setState((previous) => {
        const movingTopic = previous.topics.find((candidate) => candidate.id === drag.topicId);
        if (!movingTopic) {
          return previous;
        }

        const snappedStart = snapStartSeconds(
          rawStartSeconds,
          drag.topicId,
          previous.topics,
          resolution.seconds,
        );

        if (snappedStart === movingTopic.startSeconds) {
          return previous;
        }

        return {
          ...previous,
          topics: previous.topics.map((candidate) =>
            candidate.id === drag.topicId
              ? { ...candidate, startSeconds: snappedStart }
              : candidate,
          ),
        };
      });
    }

    function handlePointerUp() {
      const drag = dragRef.current;

      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);

      dragRef.current = {
        topicId: null,
        startClientX: 0,
        originStartSeconds: 0,
        moved: false,
      };

      if (!drag.moved && drag.topicId) {
        pressTopic(drag.topicId);
      }
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  function updateSelectedName(value) {
    if (!selectedTopic) {
      return;
    }

    updateTopicById(selectedTopic.id, (topic) => ({
      ...topic,
      name: value,
    }));
  }

  function updateSelectedMinutes(value) {
    if (!selectedTopic) {
      return;
    }

    const minutes = Number(value);
    if (!Number.isFinite(minutes)) {
      return;
    }

    const nextSeconds = Math.max(1, Math.round(minutes)) * 60;

    updateTopicById(selectedTopic.id, (topic) => ({
      ...topic,
      seconds: nextSeconds,
    }));
  }

  function updateSelectedStartMinutes(value) {
    if (!selectedTopic) {
      return;
    }

    const minutes = Number(value);
    if (!Number.isFinite(minutes)) {
      return;
    }

    const nextStart = Math.max(0, Math.round(minutes * 60));

    updateTopicById(selectedTopic.id, (topic) => ({
      ...topic,
      startSeconds: nextStart,
    }));
  }

  function applyTemplate(templateId) {
    const template = TEMPLATE_PRESETS.find((preset) => preset.id === templateId);
    if (!template) {
      return;
    }

    const templatedTopics = instantiateTopics(template.topics).map((topic, index, all) => {
      const startSeconds = all
        .slice(0, index)
        .reduce((sum, candidate) => sum + candidate.seconds, 0);

      return {
        ...topic,
        startSeconds,
      };
    });

    setState((previous) => ({
      ...previous,
      topics: templatedTopics,
      currentIndex: 0,
      timelineCursorSeconds: 0,
      isRunning: false,
    }));

    setSelectedTopicId(templatedTopics[0]?.id || null);
    setArmedSwapTopicId(null);
  }

  function resetAgenda() {
    const base = buildInitialState(instantiateTopics(DEFAULT_TOPICS));

    const sequentialTopics = base.topics.map((topic, index, all) => {
      const startSeconds = all
        .slice(0, index)
        .reduce((sum, candidate) => sum + candidate.seconds, 0);

      return {
        ...topic,
        startSeconds,
      };
    });

    setState({
      ...base,
      topics: sequentialTopics,
      currentIndex: 0,
      timelineCursorSeconds: 0,
    });

    setSelectedTopicId(sequentialTopics[0]?.id || null);
    setArmedSwapTopicId(null);
  }

  function insertTopicAfterCurrent(topic) {
    setState((previous) => {
      const current = previous.topics[clampIndex(previous.currentIndex, previous.topics.length)];
      if (!current) {
        return previous;
      }

      const insertStart = current.startSeconds + current.seconds;

      const inserted = createTopic(topic.name, topic.seconds, 0, {
        startSeconds: insertStart,
      });

      return {
        ...previous,
        topics: [...previous.topics, inserted],
      };
    });

    setInsertStatus(`Inserted ${topic.name} after the active topic.`);
    if (insertStatusTimeoutRef.current) {
      window.clearTimeout(insertStatusTimeoutRef.current);
    }
    insertStatusTimeoutRef.current = window.setTimeout(() => setInsertStatus(''), 2200);
  }

  function openCommentComposer() {
    setIsCommentComposerOpen(true);
    window.requestAnimationFrame(() => commentInputRef.current?.focus());
  }

  function submitComment() {
    const text = commentDraft.trim();

    if (!text) {
      setCommentDraft('');
      setIsCommentComposerOpen(false);
      return;
    }

    const nextComment = {
      id: createCommentId(),
      text,
      atSeconds: timelineCursorSeconds,
    };

    setState((previous) => ({
      ...previous,
      comments: [...(Array.isArray(previous.comments) ? previous.comments : []), nextComment],
    }));

    setCommentDraft('');
    setIsCommentComposerOpen(false);
    setOpenCommentId(nextComment.id);
  }

  function handleCommentInputKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitComment();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setCommentDraft('');
      setIsCommentComposerOpen(false);
    }
  }

  function deleteComment(commentId) {
    setState((previous) => ({
      ...previous,
      comments: (previous.comments || []).filter((comment) => comment.id !== commentId),
    }));

    setOpenCommentId((previous) => (previous === commentId ? null : previous));
  }

  function toggleCommentBubble(commentId) {
    setOpenCommentId((previous) => (previous === commentId ? null : commentId));
  }

  function zoomOut() {
    setResolutionIndex((previous) => Math.min(RESOLUTION_LEVELS.length - 1, previous + 1));
  }

  function zoomIn() {
    setResolutionIndex((previous) => Math.max(0, previous - 1));
  }

  function toggleUrlMenu() {
    setShowUrlMenu((previous) => {
      const next = !previous;
      if (next) {
        setSavedUrlEntries(getSavedUrlEntries());
      }
      return next;
    });
  }

  function navigateToStoredUrl(url) {
    if (!url) {
      return;
    }

    window.location.assign(url);
  }

  if (!currentTopic || !selectedTopic) {
    return null;
  }

  const selectedMinutes = minutesFromSeconds(selectedTopic.seconds);
  const selectedStartMinutes = ((selectedTopic.startSeconds || 0) / 60).toFixed(1);
  const currentRemainingSeconds = Math.max(0, currentTopic.seconds - currentTopic.elapsed);

  const topicLaneHeight = rowCount * ROW_HEIGHT;
  const commentLaneTop = LANE_TOP + topicLaneHeight + COMMENT_LANE_SPACING;
  const trackHeight = commentLaneTop + 44;

  return (
    <main className="ganttimer-app">
      <header className="top-bar">
        <div className="brand-stack">
          <h1>Ganttimer</h1>
          <p>Overlapping rows, drag snap, timed comments</p>
        </div>

        <div className="top-controls">
          <button type="button" onClick={toggleTimer}>
            {state.isRunning ? 'Pause' : 'Start'}
          </button>
          <button type="button" onClick={addTopic}>Add</button>
          <button type="button" onClick={removeCurrentTopic}>Remove</button>
          <button type="button" onClick={openCommentComposer}>Comment</button>
          <button type="button" onClick={toggleUrlMenu}>URLs</button>
        </div>

        {showUrlMenu ? (
          <div className="url-menu">
            {savedUrlEntries.length ? (
              savedUrlEntries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className="url-menu-item"
                  onClick={() => navigateToStoredUrl(entry.key)}
                >
                  <span>{entry.key}</span>
                  <small>{entry.topicCount === null ? 'unknown' : `${entry.topicCount} topics`}</small>
                </button>
              ))
            ) : (
              <p className="muted">No alternate URL entries found.</p>
            )}
          </div>
        ) : null}
      </header>

      <section className="timeline-card">
        <div className="timeline-toolbar">
          <div className="zoom-controls">
            <button type="button" onClick={zoomIn}>+</button>
            <button type="button" onClick={zoomOut}>-</button>
            <span>{resolution.label}</span>
          </div>

          <div className="timeline-meta">
            <span>Cursor {formatClock(timelineCursorSeconds)}</span>
            <span>Worked {formatClock(totalElapsedSeconds)}</span>
            <span>Rows {rowCount}</span>
          </div>
        </div>

        <div className="timeline-frame" ref={timelineFrameRef}>
          <div className="now-line" aria-hidden="true" />

          <div className="timeline-mover" style={{ transform: `translateX(${translateX}px)` }}>
            <div className="timeline-track" style={{ width: `${trackWidth}px`, height: `${trackHeight}px` }}>
              <div className="timeline-ticks" aria-hidden="true">
                {ticks.map((tick) => (
                  <span
                    key={`tick-${tick.second}`}
                    className={`tick${tick.isMajor ? ' major' : ''}`}
                    style={{ left: `${tick.x}px` }}
                  >
                    {tick.label ? <small>{tick.label}</small> : null}
                  </span>
                ))}
              </div>

              <div className="topic-lane" style={{ top: `${LANE_TOP}px`, height: `${topicLaneHeight}px` }}>
                {layoutTopics.map((topic) => {
                  const left = topic.startSeconds * pixelsPerSecond;
                  const width = Math.max(topic.seconds * pixelsPerSecond, 18);
                  const top = topic.row * ROW_HEIGHT;
                  const isCurrent = topic.id === currentTopic.id;
                  const isSelected = topic.id === selectedTopic.id;
                  const isArmed = armedSwapTopicId === topic.id && !isCurrent;

                  return (
                    <div
                      key={topic.id}
                      className={`topic-pill${isCurrent ? ' is-current' : ''}${isSelected ? ' is-selected' : ''}`}
                      style={{ left: `${left}px`, width: `${width}px`, top: `${top}px` }}
                      onPointerDown={(event) => handleTopicPointerDown(event, topic.id)}
                    >
                      <span>{topic.name}</span>

                      {isArmed ? (
                        <button
                          type="button"
                          className="topic-play-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            swapToTopic(topic.id);
                          }}
                        >
                          ▶
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="comment-lane" style={{ top: `${commentLaneTop}px` }}>
                {sortedComments.map((comment) => (
                  <div
                    key={comment.id}
                    className={`comment-marker${openCommentId === comment.id ? ' is-open' : ''}`}
                    style={{ left: `${comment.atSeconds * pixelsPerSecond}px` }}
                  >
                    <button
                      type="button"
                      className="comment-dot"
                      onClick={() => toggleCommentBubble(comment.id)}
                      aria-label={`Comment at ${formatClock(comment.atSeconds)}`}
                    />

                    <div className="comment-bubble">
                      <p>{comment.text}</p>
                      <div className="comment-bubble-foot">
                        <small>{formatClock(comment.atSeconds)}</small>
                        <button
                          type="button"
                          className="comment-delete"
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteComment(comment.id);
                          }}
                          aria-label="Delete comment"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="active-topic-card">
          <p>Active topic</p>
          <strong>{currentTopic.name}</strong>
          <div className="active-topic-times">
            <span>{formatClock(currentTopic.elapsed)} elapsed</span>
            <span>{formatClock(currentRemainingSeconds)} left</span>
          </div>
        </div>
      </section>

      <section className="details-grid">
        <article className="detail-card">
          <h2>Edit selected topic</h2>

          <label className="edit-field">
            <span>Name</span>
            <input
              type="text"
              value={selectedTopic.name}
              onChange={(event) => updateSelectedName(event.target.value)}
            />
          </label>

          <label className="edit-field">
            <span>Duration (minutes)</span>
            <input
              type="number"
              min="1"
              max="180"
              value={selectedMinutes}
              onChange={(event) => updateSelectedMinutes(event.target.value)}
            />
          </label>

          <label className="edit-field">
            <span>Start (minutes)</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={selectedStartMinutes}
              onChange={(event) => updateSelectedStartMinutes(event.target.value)}
            />
          </label>

          <p className="muted">Press once to select/edit. Press same topic again to arm play swap.</p>
        </article>

        <article className="detail-card">
          <h2>Unfinished topics (partial tracking)</h2>
          <div className="chip-button-list">
            {unfinishedTopics.length ? (
              unfinishedTopics.map((topic) => (
                <button
                  key={`unfinished-${topic.id}`}
                  type="button"
                  className="chip-button"
                  onClick={() => insertTopicAfterCurrent(topic)}
                >
                  + {topic.name} · {formatClock(topic.elapsed)} · last {topic.lastWorkedCursor === null
                    ? 'n/a'
                    : formatClock(topic.lastWorkedCursor)}
                </button>
              ))
            ) : (
              <span className="muted">No partially worked topics right now.</span>
            )}
          </div>
          <p className="status-text" aria-live="polite">{insertStatus}</p>

          <h2>Next untouched</h2>
          <div className="chip-list">
            {nextUntouchedTopics.length ? (
              nextUntouchedTopics.map((topic) => (
                <span key={`next-${topic.id}`} className="chip">
                  {topic.name} @ {formatClock(topic.startSeconds)}
                </span>
              ))
            ) : (
              <span className="muted">No untouched upcoming topics.</span>
            )}
          </div>
        </article>

        <article className="detail-card comments-card">
          <h2>Timer comments</h2>

          <div className="live-comment">
            <strong>Visible now</strong>
            <p>{activeLiveComment ? activeLiveComment.text : 'No reached comment yet.'}</p>
            <small>
              {upcomingLiveComment
                ? `Next at ${formatClock(upcomingLiveComment.atSeconds)}`
                : 'No upcoming comment.'}
            </small>
          </div>

          {isCommentComposerOpen ? (
            <label className="comment-input-wrap">
              <span>Typing logs immediately. Press Enter to finish.</span>
              <input
                ref={commentInputRef}
                type="text"
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                onKeyDown={handleCommentInputKeyDown}
                placeholder="Write a timed comment"
                autoComplete="off"
              />
            </label>
          ) : (
            <p className="muted">Start typing anywhere to create a comment.</p>
          )}
        </article>
      </section>

      <section className="footer-controls">
        <label className="toggle-pill">
          <input
            type="checkbox"
            checked={state.autoAdvance}
            onChange={toggleAutoAdvance}
          />
          <span>Auto-advance</span>
        </label>

        <div className="template-buttons">
          {TEMPLATE_PRESETS.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => applyTemplate(template.id)}
            >
              {template.label}
            </button>
          ))}
          <button type="button" onClick={resetAgenda}>Default</button>
        </div>
      </section>
    </main>
  );
}
