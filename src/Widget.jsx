import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveState } from './lib/storage';
import { reconcileRunningState } from './lib/session';
import { formatClock, formatMinuteSecond, formatShortDuration } from './lib/time';
import {
  WIDGET_VIEWS,
  adjustWidgetDuration,
  captureWidgetNote,
  getActiveWidgetTopics,
  getWidgetSnapshot,
  isTrustedParentEvent,
  loadExistingWidgetAgenda,
  parseAllowedOrigins,
  parseWidgetCommand,
  parseWidgetTarget,
  resolveParentOrigin,
  widgetMessage,
} from './lib/widget';
import './widget.css';

function getStorage() {
  try {
    const storage = window.localStorage;
    const key = 'agnda:widget:storage-check';
    storage.setItem(key, '1');
    if (storage.getItem(key) !== '1') return null;
    storage.removeItem(key);
    return storage;
  } catch {
    return null;
  }
}

function initialWidgetData() {
  const params = new URLSearchParams(window.location.search);
  const target = parseWidgetTarget(params.get('agenda') || window.location.hash, window.location.origin);
  const storage = getStorage();
  let loaded = null;
  try {
    loaded = target && storage ? loadExistingWidgetAgenda(storage, target) : null;
  } catch {
    return { target, storage: null, loaded: null };
  }
  return { target, storage, loaded };
}

function NoteTrack({ topic, onPreview, duration, onDurationChange, onDurationCommit }) {
  const [dragScale, setDragScale] = useState(null);
  const latestNoteOffset = Math.max(0, ...topic.notes.map((note) => note.offsetSeconds));
  const scale = dragScale ?? Math.min(86400, Math.max(180,
    Math.ceil(Math.max(topic.seconds, topic.elapsed, latestNoteOffset) * 1.6 / 30) * 30));
  const elapsedPercent = Math.min(100, topic.elapsed / scale * 100);
  const durationPercent = Math.min(100, duration / scale * 100);

  function commit(event) {
    const seconds = Math.max(30, Number(event.currentTarget.value));
    setDragScale(null);
    onDurationCommit(topic.id, seconds);
  }

  return (
    <div className="widget-track-wrap">
      <div className="widget-track" aria-hidden="true">
        <span className="widget-track__elapsed" style={{ width: `${elapsedPercent}%` }} />
        <span className="widget-track__duration" style={{ left: `${durationPercent}%` }} />
      </div>
      {topic.notes.map((note, index) => (
        <button
          key={note.id}
          type="button"
          className="widget-note-dot"
          style={{ left: `${Math.min(100, note.offsetSeconds / scale * 100)}%` }}
          aria-label={`Preview note ${index + 1} at ${formatMinuteSecond(note.offsetSeconds)}`}
          title={`Note ${index + 1} · ${formatMinuteSecond(note.offsetSeconds)}`}
          onClick={() => onPreview(topic.id, note.id)}
        />
      ))}
      <input
        className="widget-duration-slider"
        type="range"
        min="0"
        max={scale}
        step="30"
        value={Math.max(30, Math.min(duration, scale))}
        aria-label={`Adjust ${topic.name} total duration`}
        aria-valuemin={30}
        aria-valuetext={formatShortDuration(duration)}
        onPointerDown={() => setDragScale(scale)}
        onChange={(event) => onDurationChange(topic.id, Math.max(30, Number(event.currentTarget.value)))}
        onPointerUp={commit}
        onKeyUp={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
            commit(event);
          }
        }}
        onBlur={commit}
      />
      <div className="widget-track-labels">
        <span>ELAPSED {formatShortDuration(topic.elapsed)}</span>
        <span>DURATION {formatShortDuration(duration)}</span>
      </div>
    </div>
  );
}

export default function Widget() {
  const boot = useMemo(initialWidgetData, []);
  const rootRef = useRef(null);
  const storageRef = useRef(boot.storage);
  const entryRef = useRef(boot.loaded?.entry ?? null);
  const messageCounter = useRef(0);
  const lastHeight = useRef(-1);
  const lastSnapshot = useRef('');
  const [state, setState] = useState(boot.loaded?.state ?? null);
  const [view, setView] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('view');
    return WIDGET_VIEWS.includes(requested) ? requested : 'capture';
  });
  const [preview, setPreview] = useState(null);
  const [composerTopicId, setComposerTopicId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [durations, setDurations] = useState({});
  const [status, setStatus] = useState('');
  const [unavailable, setUnavailable] = useState(!boot.storage || !boot.loaded);

  const allowedOrigins = useMemo(
    () => parseAllowedOrigins(import.meta.env.VITE_WIDGET_ALLOWED_ORIGINS ?? ''),
    [],
  );
  const parentOrigin = useMemo(
    () => resolveParentOrigin(window.location.search, allowedOrigins),
    [allowedOrigins],
  );
  const isEmbedded = window.parent !== window;

  const nextRequestId = useCallback(() => {
    messageCounter.current += 1;
    return `widget-${messageCounter.current}`;
  }, []);

  const send = useCallback((type, payload, requestId = nextRequestId(), ok = true) => {
    if (!isEmbedded || !parentOrigin) return;
    window.parent.postMessage(widgetMessage(type, requestId, payload, ok), parentOrigin);
  }, [isEmbedded, nextRequestId, parentOrigin]);

  const refresh = useCallback(() => {
    if (!storageRef.current || !boot.target) return null;
    try {
      const loaded = loadExistingWidgetAgenda(storageRef.current, boot.target, entryRef.current);
      if (!loaded) {
        setUnavailable(true);
        return null;
      }
      entryRef.current = loaded.entry;
      setState(loaded.state);
      setUnavailable(false);
      return loaded.state;
    } catch {
      setUnavailable(true);
      return null;
    }
  }, [boot.target]);

  const mutate = useCallback((kind, topicId, value) => {
    const storage = storageRef.current;
    if (!storage || !boot.target) throw new Error('Agenda storage is unavailable');
    const loaded = loadExistingWidgetAgenda(storage, boot.target, entryRef.current);
    if (!loaded) throw new Error('Saved agenda is unavailable');
    const now = Date.now();
    const live = reconcileRunningState(loaded.state, now);
    let result;
    if (kind === 'duration') {
      const updated = adjustWidgetDuration(live, topicId, value);
      result = { state: updated, payload: { topicId, seconds: value, elapsed: live.topics.find((topic) => topic.id === topicId)?.elapsed } };
    } else {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const captured = captureWidgetNote(live, topicId, value, now, timeZone);
      result = { state: captured.state, payload: { note: captured.note } };
    }
    saveState(result.state, storage);
    const verified = loadExistingWidgetAgenda(storage, boot.target, loaded.entry);
    const saved = verified && (kind === 'duration'
      ? verified.state.topics.some((topic) => topic.id === topicId && topic.seconds === value)
      : verified.state.topics.some((topic) => topic.id === topicId && topic.notes.some((note) => note.id === result.payload.note.id)));
    if (!saved) throw new Error('Could not save to AGNDA storage');
    entryRef.current = verified.entry;
    setState(verified.state);
    setUnavailable(false);
    send(kind === 'duration' ? 'duration-adjustment' : 'note-save', result.payload);
    return result.payload;
  }, [boot.target, send]);

  useEffect(() => {
    if (!boot.target) return undefined;
    const interval = window.setInterval(refresh, 1000);
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [boot.target, refresh]);

  useEffect(() => {
    if (!state) return;
    document.title = `${state.title} · AGNDA widget`;
    const snapshot = getWidgetSnapshot(state);
    const signature = JSON.stringify({
      title: snapshot.title,
      isRunning: snapshot.isRunning,
      completed: snapshot.completed,
      primaryTopicId: snapshot.primaryTopicId,
      secondaryTopicId: snapshot.secondaryTopicId,
      topics: snapshot.topics.map((topic) =>
        [topic.id, topic.name, topic.elapsed, topic.seconds, topic.noteCount, topic.active]),
    });
    if (signature !== lastSnapshot.current) {
      lastSnapshot.current = signature;
      send('snapshot', snapshot);
    }
  }, [state, send]);

  useEffect(() => {
    if (!state) return;
    const activeIds = new Set(getActiveWidgetTopics(state).map((topic) => topic.id));
    if (preview && !activeIds.has(preview.topicId)) setPreview(null);
    if (composerTopicId && !activeIds.has(composerTopicId)) setComposerTopicId(null);
  }, [state?.currentIndex, state?.secondaryIndex, state?.topics?.length]);

  useEffect(() => {
    send('ready', {
      view,
      views: WIDGET_VIEWS,
      agendaId: state?.agendaId ?? boot.target?.agendaId ?? null,
      available: Boolean(state && !unavailable),
      snapshot: state ? getWidgetSnapshot(state) : null,
    });
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const report = () => {
      const height = Math.ceil(root.getBoundingClientRect().height);
      if (height > 0 && height !== lastHeight.current) {
        lastHeight.current = height;
        send('height-change', { height });
      }
    };
    report();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(report) : null;
    observer?.observe(root);
    const frame = requestAnimationFrame(report);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [view, preview, composerTopicId, unavailable, send]);

  useEffect(() => {
    if (!parentOrigin || !isEmbedded) return undefined;
    function onMessage(event) {
      if (!isTrustedParentEvent(event, parentOrigin, window.parent)) return;
      const command = parseWidgetCommand(event.data);
      if (!command.requestId) return;
      if (command.error) {
        send('response', { error: command.error }, command.requestId, false);
        return;
      }
      try {
        let payload = {};
        if (command.type === 'get-snapshot') {
          const latest = refresh();
          if (!latest) throw new Error('Saved agenda is unavailable');
          payload = { snapshot: getWidgetSnapshot(latest) };
        } else if (command.type === 'set-view') {
          setView(command.payload.view);
          setPreview(null);
          setComposerTopicId(null);
          payload = { view: command.payload.view };
          send('view-change', payload);
        } else if (command.type === 'adjust-duration') {
          payload = mutate('duration', command.payload.topicId, command.payload.seconds);
        } else if (command.type === 'save-note') {
          payload = mutate('note', command.payload.topicId, command.payload.text);
        }
        send('response', payload, command.requestId, true);
      } catch (error) {
        send('response', { error: error.message || 'Widget action failed' }, command.requestId, false);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [isEmbedded, mutate, parentOrigin, refresh, send]);

  function changeView(next) {
    setView(next);
    setPreview(null);
    setComposerTopicId(null);
    send('view-change', { view: next });
  }

  function saveNote(event, topicId) {
    event.preventDefault();
    try {
      mutate('note', topicId, drafts[topicId] ?? '');
      setDrafts((previous) => ({ ...previous, [topicId]: '' }));
      setComposerTopicId(null);
      setStatus('Note saved');
    } catch (error) {
      setStatus(error.message);
    }
  }

  function adjustDuration(topicId, seconds) {
    const topic = getActiveWidgetTopics(state).find((item) => item.id === topicId);
    if (!topic || topic.seconds === seconds) return;
    try {
      mutate('duration', topicId, seconds);
      setStatus('Duration updated');
    } catch (error) {
      setStatus(error.message);
    }
    setDurations((previous) => {
      const next = { ...previous };
      delete next[topicId];
      return next;
    });
  }

  const openHref = boot.target?.href ?? `${window.location.origin}/`;
  const activeTopics = state ? getActiveWidgetTopics(state) : [];
  const isComplete = state && !state.isRunning && state.topics.every(
    (topic) => topic.addressed || topic.elapsed >= topic.seconds,
  );

  return (
    <main
      ref={rootRef}
      className={`widget widget--${view}`}
      onClickCapture={(event) => {
        if (!event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        changeView(WIDGET_VIEWS[(WIDGET_VIEWS.indexOf(view) + 1) % WIDGET_VIEWS.length]);
      }}
    >
      <header className="widget-header">
        <span className="widget-brand">AGNDA <span>/ INLINE</span></span>
        {state ? <span className="widget-session">{isComplete ? 'COMPLETE' : state.isRunning ? '● LIVE' : 'Ⅱ PAUSED'}</span> : null}
      </header>

      {unavailable || !state ? (
        <div className="widget-fallback" role="status">
          <p>{!boot.target ? 'This widget URL needs a valid saved agenda.' :
            !storageRef.current ? 'Embedded storage is unavailable.' : 'This saved agenda is not available in this browser.'}</p>
          <a href={openHref} target="_blank" rel="noopener noreferrer">Open agenda in AGNDA ↗</a>
        </div>
      ) : (
        <>
          {activeTopics.map((topic) => {
            const selectedNote = preview?.topicId === topic.id
              ? topic.notes.find((note) => note.id === preview.noteId)
              : null;
            const duration = durations[topic.id] ?? topic.seconds;
            return (
              <section className="widget-topic" key={topic.id} aria-label={topic.name}>
                <div className="widget-topic__heading">
                  <span className="widget-topic__name">{topic.name}</span>
                  <span className="widget-topic__remaining">{formatClock(Math.max(0, duration - topic.elapsed))}</span>
                </div>
                {view !== 'time' ? (
                  <>
                    <NoteTrack
                      topic={topic}
                      duration={duration}
                      onPreview={(topicId, noteId) => {
                        setPreview((previous) => previous?.topicId === topicId && previous.noteId === noteId
                          ? null : { topicId, noteId });
                        setComposerTopicId(null);
                      }}
                      onDurationChange={(topicId, seconds) => setDurations((previous) => ({ ...previous, [topicId]: seconds }))}
                      onDurationCommit={adjustDuration}
                    />
                    {selectedNote ? (
                      <div className="widget-note-preview">
                        <span>{formatMinuteSecond(selectedNote.offsetSeconds)}</span>
                        <p>{selectedNote.text}</p>
                        <button type="button" onClick={() => setPreview(null)} aria-label="Close note preview">×</button>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {view === 'capture' ? (
                  composerTopicId === topic.id ? (
                    <form className="widget-composer" onSubmit={(event) => saveNote(event, topic.id)}>
                      <textarea
                        autoFocus
                        aria-label={`Write a note for ${topic.name}`}
                        placeholder="Write a note…"
                        value={drafts[topic.id] ?? ''}
                        maxLength={4000}
                        onChange={(event) => setDrafts((previous) => ({ ...previous, [topic.id]: event.target.value }))}
                      />
                      <div className="widget-composer__actions">
                        <button type="button" onClick={() => setComposerTopicId(null)}>Cancel</button>
                        <button type="submit">Save note</button>
                      </div>
                    </form>
                  ) : (
                    <input
                      className="widget-note-prompt"
                      aria-label={`Write a note for ${topic.name}`}
                      placeholder="Write a note…"
                      readOnly
                      onFocus={() => { setPreview(null); setComposerTopicId(topic.id); }}
                    />
                  )
                ) : null}
              </section>
            );
          })}
          {status ? <p className="widget-status" role="status">{status}</p> : null}
          {isEmbedded && !parentOrigin ? (
            <p className="widget-connection">Parent messaging is not configured. <a href={openHref} target="_blank" rel="noopener noreferrer">Open in AGNDA ↗</a></p>
          ) : null}
        </>
      )}
    </main>
  );
}
