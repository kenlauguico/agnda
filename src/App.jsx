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

const ZOOM_LEVELS = Object.freeze([
  { id: '5m', label: '5m', tickSeconds: 5 * 60 },
  { id: '10m', label: '10m', tickSeconds: 10 * 60 },
  { id: '30m', label: '30m', tickSeconds: 30 * 60 },
  { id: '1h', label: '1h', tickSeconds: 60 * 60 },
]);

const DEFAULT_ZOOM_ID = '10m';
const PIXELS_PER_TICK = 72;

function getZoomLevel(zoomId) {
  return ZOOM_LEVELS.find((zoom) => zoom.id === zoomId) || ZOOM_LEVELS[1];
}

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

function buildTimelineSegments(topics) {
  let cursor = 0;

  return topics.map((topic, index) => {
    const start = cursor;
    cursor += topic.seconds;

    return {
      ...topic,
      index,
      start,
      end: cursor,
    };
  });
}

function advanceBySeconds(previous, deltaSeconds) {
  if (!previous.isRunning || deltaSeconds < 1 || !previous.topics.length) {
    return previous;
  }

  const currentIndex = clampIndex(previous.currentIndex, previous.topics.length);

  const nextTopics = previous.topics.map((topic, index) => {
    if (index !== currentIndex) {
      return topic;
    }

    return {
      ...topic,
      elapsed: topic.elapsed + deltaSeconds,
    };
  });

  let nextIndex = currentIndex;
  let nextRunning = previous.isRunning;

  if (previous.autoAdvance) {
    const activeTopic = nextTopics[currentIndex];

    if (activeTopic && activeTopic.elapsed >= activeTopic.seconds) {
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
  };
}

export default function App() {
  const [state, setState] = useState(() => loadInitialState());
  const [zoomId, setZoomId] = useState(DEFAULT_ZOOM_ID);
  const [commentDraft, setCommentDraft] = useState('');
  const [isCommentComposerOpen, setIsCommentComposerOpen] = useState(false);
  const [openCommentId, setOpenCommentId] = useState(null);
  const [insertStatus, setInsertStatus] = useState('');
  const [timelineFrameWidth, setTimelineFrameWidth] = useState(0);

  const tickerRef = useRef({ intervalId: null, lastTickMs: Date.now() });
  const timelineFrameRef = useRef(null);
  const commentInputRef = useRef(null);
  const insertStatusTimeoutRef = useRef(null);

  const topics = state.topics;
  const currentIndex = clampIndex(state.currentIndex, topics.length);
  const currentTopic = topics[currentIndex];
  const comments = Array.isArray(state.comments) ? state.comments : [];

  const totalDurationSeconds = useMemo(
    () => topics.reduce((sum, topic) => sum + topic.seconds, 0),
    [topics],
  );

  const totalElapsedSeconds = useMemo(
    () => topics.reduce((sum, topic) => sum + topic.elapsed, 0),
    [topics],
  );

  const timelineSegments = useMemo(() => buildTimelineSegments(topics), [topics]);

  const nextUntouchedTopics = useMemo(
    () => topics.slice(currentIndex + 1).filter((topic) => topic.elapsed === 0),
    [topics, currentIndex],
  );

  const unfinishedTopics = useMemo(
    () =>
      topics.filter(
        (topic, index) =>
          index !== currentIndex && topic.elapsed < topic.seconds,
      ),
    [topics, currentIndex],
  );

  const sortedComments = useMemo(
    () => [...comments].sort((a, b) => a.atSeconds - b.atSeconds),
    [comments],
  );

  const activeLiveComment = useMemo(() => {
    const passed = sortedComments.filter((comment) => comment.atSeconds <= totalElapsedSeconds);
    return passed.length ? passed[passed.length - 1] : null;
  }, [sortedComments, totalElapsedSeconds]);

  const upcomingLiveComment = useMemo(
    () => sortedComments.find((comment) => comment.atSeconds > totalElapsedSeconds) || null,
    [sortedComments, totalElapsedSeconds],
  );

  const zoomLevel = getZoomLevel(zoomId);
  const pixelsPerSecond = PIXELS_PER_TICK / zoomLevel.tickSeconds;

  const maxTimelineSeconds = Math.max(
    totalDurationSeconds,
    totalElapsedSeconds + zoomLevel.tickSeconds * 2,
    zoomLevel.tickSeconds * 8,
  );

  const trackWidth = Math.max(
    maxTimelineSeconds * pixelsPerSecond,
    (timelineFrameWidth || 700) + PIXELS_PER_TICK * 5,
  );

  const translateX = (timelineFrameWidth || 700) / 2 - totalElapsedSeconds * pixelsPerSecond;

  const tickCount = Math.ceil(maxTimelineSeconds / zoomLevel.tickSeconds) + 1;
  const ticks = useMemo(
    () =>
      Array.from({ length: tickCount }, (_, index) => {
        const second = index * zoomLevel.tickSeconds;
        return {
          second,
          x: second * pixelsPerSecond,
          label: formatClock(second),
        };
      }),
    [tickCount, zoomLevel.tickSeconds, pixelsPerSecond],
  );

  useEffect(() => {
    if (!topics.length) {
      setState(buildInitialState(instantiateTopics(DEFAULT_TOPICS)));
      return;
    }

    if (currentIndex !== state.currentIndex) {
      setState((previous) => ({
        ...previous,
        currentIndex,
      }));
    }
  }, [topics.length, currentIndex, state.currentIndex]);

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    if (!totalDurationSeconds) {
      document.title = 'Ganttimer | AGNDA';
      return;
    }

    document.title = `${formatClock(totalElapsedSeconds)} / ${formatClock(totalDurationSeconds)} | Ganttimer`;
  }, [totalDurationSeconds, totalElapsedSeconds]);

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
    function updateWidth() {
      setTimelineFrameWidth(timelineFrameRef.current?.clientWidth || 0);
    }

    updateWidth();
    window.addEventListener('resize', updateWidth);

    return () => window.removeEventListener('resize', updateWidth);
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
          const nextTopics = [...previous.topics, createTopicFromMinutes('New topic', 5)];
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
          if (!isCommentComposerOpen && !previous.length) {
            return event.key;
          }

          return `${previous}${event.key}`;
        });

        window.requestAnimationFrame(() => {
          commentInputRef.current?.focus();
          commentInputRef.current?.setSelectionRange(commentInputRef.current.value.length, commentInputRef.current.value.length);
        });
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCommentComposerOpen]);

  useEffect(() => {
    return () => {
      if (insertStatusTimeoutRef.current) {
        window.clearTimeout(insertStatusTimeoutRef.current);
      }
    };
  }, []);

  function updateCurrentTopic(updater) {
    setState((previous) => {
      if (!previous.topics.length) {
        return previous;
      }

      const nextTopics = previous.topics.map((topic, index) =>
        index === currentIndex ? updater(topic) : topic,
      );

      return {
        ...previous,
        topics: nextTopics,
      };
    });
  }

  function selectTopic(index) {
    setState((previous) => ({
      ...previous,
      currentIndex: clampIndex(index, previous.topics.length),
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
      const nextTopics = [...previous.topics, createTopicFromMinutes('New topic', 5)];
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
  }

  function updateCurrentTopicName(name) {
    updateCurrentTopic((topic) => ({
      ...topic,
      name,
    }));
  }

  function updateCurrentTopicMinutes(value) {
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) {
      return;
    }

    const seconds = Math.max(1, Math.round(minutes)) * 60;

    updateCurrentTopic((topic) => ({
      ...topic,
      seconds,
    }));
  }

  function applyTemplate(templateId) {
    const template = TEMPLATE_PRESETS.find((preset) => preset.id === templateId);
    if (!template) {
      return;
    }

    setState((previous) => ({
      ...previous,
      topics: instantiateTopics(template.topics),
      currentIndex: 0,
      isRunning: false,
    }));
  }

  function resetAgenda() {
    setState(buildInitialState(instantiateTopics(DEFAULT_TOPICS)));
  }

  function insertTopicAfterCurrent(topic) {
    setState((previous) => {
      const insertAt = clampIndex(previous.currentIndex, previous.topics.length) + 1;
      const insertedTopic = createTopic(topic.name, topic.seconds, 0);
      return {
        ...previous,
        topics: [
          ...previous.topics.slice(0, insertAt),
          insertedTopic,
          ...previous.topics.slice(insertAt),
        ],
      };
    });

    setInsertStatus(`Inserted \"${topic.name}\" right after current.`);
    if (insertStatusTimeoutRef.current) {
      window.clearTimeout(insertStatusTimeoutRef.current);
    }
    insertStatusTimeoutRef.current = window.setTimeout(() => setInsertStatus(''), 2000);
  }

  function openCommentComposer() {
    setIsCommentComposerOpen(true);
    window.requestAnimationFrame(() => commentInputRef.current?.focus());
  }

  function submitComment() {
    const nextText = commentDraft.trim();
    if (!nextText) {
      setIsCommentComposerOpen(false);
      setCommentDraft('');
      return;
    }

    const nextComment = {
      id: createCommentId(),
      text: nextText,
      atSeconds: Math.max(0, Math.round(totalElapsedSeconds)),
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
      setIsCommentComposerOpen(false);
      setCommentDraft('');
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

  if (!currentTopic) {
    return null;
  }

  const currentMinutes = minutesFromSeconds(currentTopic.seconds);
  const currentRemainingSeconds = Math.max(0, currentTopic.seconds - currentTopic.elapsed);

  return (
    <main className="ganttimer-app">
      <header className="top-bar">
        <div className="brand-stack">
          <h1>Ganttimer</h1>
          <p>Minimal monochrome timeline with live comments</p>
        </div>

        <div className="top-controls">
          <button type="button" onClick={toggleTimer}>
            {state.isRunning ? 'Pause' : 'Start'}
          </button>
          <button type="button" onClick={addTopic}>Add topic</button>
          <button type="button" onClick={removeCurrentTopic}>Remove</button>
          <button type="button" onClick={openCommentComposer}>Comment</button>
        </div>
      </header>

      <section className="timeline-card">
        <div className="timeline-toolbar">
          <div className="zoom-pill-group" role="group" aria-label="Timeline zoom">
            {ZOOM_LEVELS.map((zoom) => (
              <button
                key={zoom.id}
                type="button"
                className={zoom.id === zoomId ? 'is-active' : ''}
                onClick={() => setZoomId(zoom.id)}
              >
                {zoom.label}
              </button>
            ))}
          </div>

          <div className="timeline-meta">
            <span>{formatClock(totalElapsedSeconds)} elapsed</span>
            <span>{formatClock(totalDurationSeconds)} total</span>
          </div>
        </div>

        <div className="timeline-frame" ref={timelineFrameRef}>
          <div className="now-line" aria-hidden="true" />

          <div className="timeline-mover" style={{ transform: `translateX(${translateX}px)` }}>
            <div className="timeline-track" style={{ width: `${trackWidth}px` }}>
              <div className="timeline-ticks" aria-hidden="true">
                {ticks.map((tick) => (
                  <span key={`tick-${tick.second}`} className="tick" style={{ left: `${tick.x}px` }}>
                    <small>{tick.label}</small>
                  </span>
                ))}
              </div>

              <div className="topic-lane">
                {timelineSegments.map((segment) => {
                  const width = Math.max(segment.seconds * pixelsPerSecond, 16);
                  const left = segment.start * pixelsPerSecond;
                  const isCurrent = segment.index === currentIndex;

                  return (
                    <button
                      key={segment.id}
                      type="button"
                      className={`topic-pill${isCurrent ? ' is-current' : ''}`}
                      style={{ width: `${width}px`, left: `${left}px` }}
                      onClick={() => selectTopic(segment.index)}
                    >
                      <span>{segment.name}</span>
                    </button>
                  );
                })}
              </div>

              <div className="comment-lane">
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
          <p>Current topic (centered)</p>
          <strong>{currentTopic.name}</strong>
          <div className="active-topic-times">
            <span>{formatClock(currentTopic.elapsed)} elapsed</span>
            <span>{formatClock(currentRemainingSeconds)} left</span>
          </div>
        </div>
      </section>

      <section className="details-grid">
        <article className="detail-card">
          <h2>Next untouched topics</h2>
          <div className="chip-list">
            {nextUntouchedTopics.length ? (
              nextUntouchedTopics.map((topic) => (
                <span key={topic.id} className="chip">
                  {topic.name} · {formatClock(topic.seconds)}
                </span>
              ))
            ) : (
              <span className="muted">No untouched upcoming topics.</span>
            )}
          </div>
        </article>

        <article className="detail-card">
          <h2>Unfinished quick insert</h2>
          <div className="chip-button-list">
            {unfinishedTopics.length ? (
              unfinishedTopics.map((topic) => (
                <button
                  key={`insert-${topic.id}`}
                  type="button"
                  className="chip-button"
                  onClick={() => insertTopicAfterCurrent(topic)}
                >
                  + {topic.name}
                </button>
              ))
            ) : (
              <span className="muted">Everything is finished. Nothing to insert.</span>
            )}
          </div>
          <p className="status-text" aria-live="polite">{insertStatus}</p>
        </article>

        <article className="detail-card comments-card">
          <h2>Timer comments</h2>

          <div className="live-comment">
            <strong>Now showing:</strong>
            <p>{activeLiveComment ? activeLiveComment.text : 'No reached comments yet.'}</p>
            <small>
              {upcomingLiveComment
                ? `Next at ${formatClock(upcomingLiveComment.atSeconds)}`
                : 'No upcoming comment.'}
            </small>
          </div>

          {isCommentComposerOpen ? (
            <label className="comment-input-wrap">
              <span>Typing logs instantly. Press Enter to save.</span>
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
            <p className="muted">Start typing anywhere to open comment capture.</p>
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

        <label className="topic-edit-pill">
          <span>Topic</span>
          <input
            type="text"
            value={currentTopic.name}
            onChange={(event) => updateCurrentTopicName(event.target.value)}
          />
        </label>

        <label className="topic-edit-pill number">
          <span>Minutes</span>
          <input
            type="number"
            min="1"
            max="180"
            value={currentMinutes}
            onChange={(event) => updateCurrentTopicMinutes(event.target.value)}
          />
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
