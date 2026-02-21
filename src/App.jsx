import { useEffect, useMemo, useRef, useState } from 'react';
import { encodeTopicsToHash } from './lib/hashAgenda';
import { buildInitialState, loadInitialState, saveState } from './lib/storage';
import {
  DEFAULT_TOPICS,
  TEMPLATE_PRESETS,
  createTopicFromMinutes,
  instantiateTopics,
} from './lib/topics';
import { clampIndex, formatClock, minutesFromSeconds } from './lib/time';
import './styles.css';

function getSavedUrlDestinations() {
  if (!globalThis.window || !window.localStorage) {
    return [];
  }

  const currentUrl = window.location.href;
  const fallbackCurrentPath = `${window.location.origin}${window.location.pathname}`;
  const destinations = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !/^https?:\/\//i.test(key)) {
      continue;
    }

    const isCurrent =
      key === currentUrl ||
      key === fallbackCurrentPath ||
      key === `${fallbackCurrentPath}/`;

    if (isCurrent) {
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

    destinations.push({
      key,
      topicCount,
    });
  }

  return destinations.sort((a, b) => a.key.localeCompare(b.key));
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

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    target.isContentEditable
  );
}

export default function App() {
  const [state, setState] = useState(() => loadInitialState());
  const [shareStatus, setShareStatus] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [showSavedUrls, setShowSavedUrls] = useState(false);
  const [savedUrlEntries, setSavedUrlEntries] = useState([]);
  const [savedUrlStatus, setSavedUrlStatus] = useState('');

  const tickerRef = useRef({ intervalId: null, lastTickMs: Date.now() });
  const shareTimeoutRef = useRef(null);
  const importTimeoutRef = useRef(null);

  const topics = state.topics;
  const currentIndex = clampIndex(state.currentIndex, topics.length);
  const currentTopic = topics[currentIndex];

  const totalSeconds = useMemo(
    () => topics.reduce((sum, topic) => sum + topic.seconds, 0),
    [topics],
  );

  const totalElapsed = useMemo(
    () => topics.reduce((sum, topic) => sum + topic.elapsed, 0),
    [topics],
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
  }, [currentIndex, state.currentIndex, topics.length]);

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    if (!totalSeconds) {
      document.title = 'AGNDA';
      return;
    }

    document.title = `${formatClock(totalElapsed)} / ${formatClock(totalSeconds)} session | AGNDA`;
  }, [totalElapsed, totalSeconds]);

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

  useEffect(
    () => () => {
      if (shareTimeoutRef.current) {
        window.clearTimeout(shareTimeoutRef.current);
      }

      if (importTimeoutRef.current) {
        window.clearTimeout(importTimeoutRef.current);
      }
    },
    [],
  );

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
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function updateCurrentTopic(updateFn) {
    setState((previous) => {
      if (!previous.topics.length) {
        return previous;
      }

      const nextTopics = previous.topics.map((topic, index) =>
        index === currentIndex ? updateFn(topic) : topic,
      );

      return {
        ...previous,
        topics: nextTopics,
      };
    });
  }

  function toggleTimer() {
    setState((previous) => ({
      ...previous,
      isRunning: !previous.isRunning,
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
        return {
          ...buildInitialState([createTopicFromMinutes('New topic', 5)]),
        };
      }

      const nextTopics = previous.topics.filter((_, index) => index !== currentIndex);
      const nextIndex = clampIndex(currentIndex - 1, nextTopics.length);

      return {
        ...previous,
        topics: nextTopics,
        currentIndex: nextIndex,
        isRunning: false,
      };
    });
  }

  function selectTopic(index) {
    setState((previous) => ({
      ...previous,
      currentIndex: clampIndex(index, previous.topics.length),
    }));
  }

  function updateTopicName(name) {
    updateCurrentTopic((topic) => ({
      ...topic,
      name,
    }));
  }

  function updateTopicMinutes(value) {
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) {
      return;
    }

    const nextSeconds = Math.max(1, Math.round(minutes)) * 60;
    updateCurrentTopic((topic) => ({
      ...topic,
      seconds: nextSeconds,
    }));
  }

  function toggleAutoAdvance() {
    setState((previous) => ({
      ...previous,
      autoAdvance: !previous.autoAdvance,
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

  function resetElapsedTimes() {
    setState((previous) => ({
      ...previous,
      isRunning: false,
      topics: previous.topics.map((topic) => ({
        ...topic,
        elapsed: 0,
      })),
    }));
  }

  function toggleSavedUrls() {
    setShowSavedUrls((previous) => {
      const nextValue = !previous;

      if (nextValue) {
        const destinations = getSavedUrlDestinations();
        setSavedUrlEntries(destinations);
        setSavedUrlStatus(destinations.length ? '' : 'No other saved URLs found.');
      } else {
        setSavedUrlStatus('');
      }

      return nextValue;
    });
  }

  function goToSavedUrl(url) {
    if (!url) {
      return;
    }

    window.location.assign(url);
  }

  async function copyShareLink() {
    const hash = encodeTopicsToHash(topics);
    const url = `${window.location.origin}${window.location.pathname}${hash}`;

    try {
      await navigator.clipboard.writeText(url);
      setShareStatus('Copied URL');

      if (shareTimeoutRef.current) {
        window.clearTimeout(shareTimeoutRef.current);
      }

      shareTimeoutRef.current = window.setTimeout(() => setShareStatus(''), 2400);
    } catch {
      setShareStatus('Clipboard blocked');

      if (shareTimeoutRef.current) {
        window.clearTimeout(shareTimeoutRef.current);
      }

      shareTimeoutRef.current = window.setTimeout(() => setShareStatus(''), 2400);
    }
  }

  async function importFromClipboard() {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
      setImportStatus('Clipboard not available');
      if (importTimeoutRef.current) {
        window.clearTimeout(importTimeoutRef.current);
      }
      importTimeoutRef.current = window.setTimeout(() => setImportStatus(''), 2400);
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      const names = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      if (!names.length) {
        setImportStatus('No lines to import');
      } else {
        setState((previous) => ({
          ...previous,
          topics: names.map((name) => createTopicFromMinutes(name, 5)),
          currentIndex: 0,
          isRunning: false,
        }));
        setImportStatus(`Imported ${names.length}`);
      }
    } catch {
      setImportStatus('Clipboard blocked');
    }

    if (importTimeoutRef.current) {
      window.clearTimeout(importTimeoutRef.current);
    }
    importTimeoutRef.current = window.setTimeout(() => setImportStatus(''), 2400);
  }

  if (!currentTopic) {
    return null;
  }

  const currentMinutes = minutesFromSeconds(currentTopic.seconds);
  const remainingSeconds = Math.max(0, currentTopic.seconds - currentTopic.elapsed);

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="overline">Agenda timer rebuilt for 2026</p>
        <div className="headline-row">
          <h1>AGNDA</h1>
          <p className="domain-row">
            <span>agnda.kenlauguico.com</span>
            <span>agnda.kenlaugui.co</span>
          </p>
        </div>
        <div className="hero-metrics">
          <article>
            <span>Total</span>
            <strong>{formatClock(totalSeconds)}</strong>
          </article>
          <article>
            <span>Elapsed</span>
            <strong>{formatClock(totalElapsed)}</strong>
          </article>
          <article>
            <span>Current left</span>
            <strong>{formatClock(remainingSeconds)}</strong>
          </article>
        </div>
      </section>

      <section className="workspace">
        <aside className="agenda-panel">
          <header>
            <h2>Agenda</h2>
            <p>Space to start/pause. Cmd/Ctrl+N to add.</p>
          </header>

          <div className="topic-list" role="list" aria-label="Agenda topics">
            {topics.map((topic, index) => {
              const progress = Math.min(100, (topic.elapsed / topic.seconds) * 100);
              const selected = index === currentIndex;

              return (
                <button
                  key={topic.id}
                  type="button"
                  role="listitem"
                  className={`topic-card${selected ? ' is-selected' : ''}${
                    topic.elapsed > topic.seconds ? ' is-over' : ''
                  }`}
                  onClick={() => selectTopic(index)}
                >
                  <span className="topic-card__title">{topic.name}</span>
                  <span className="topic-card__time">
                    {formatClock(topic.elapsed)} / {formatClock(topic.seconds)}
                  </span>
                  <span className="topic-card__meter" aria-hidden="true">
                    <span style={{ width: `${progress}%` }} />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="agenda-buttons">
            <button type="button" onClick={toggleTimer}>
              {state.isRunning ? 'Pause' : 'Start'}
            </button>
            <button type="button" onClick={addTopic}>Add</button>
            <button type="button" onClick={removeCurrentTopic}>Delete</button>
            <button type="button" onClick={resetElapsedTimes}>Zero elapsed</button>
            <button type="button" onClick={toggleSavedUrls}>
              {showSavedUrls ? 'Hide saved URLs' : 'Saved URLs'}
            </button>
          </div>

          {showSavedUrls ? (
            <div className="saved-urls-panel">
              <p>Other URLs found in localStorage</p>
              <div className="saved-urls-list">
                {savedUrlEntries.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className="saved-url-item"
                    onClick={() => goToSavedUrl(entry.key)}
                  >
                    <span>{entry.key}</span>
                    <small>
                      {entry.topicCount === null ? 'unknown agenda data' : `${entry.topicCount} topics`}
                    </small>
                  </button>
                ))}
              </div>
              <div className="saved-urls-status" aria-live="polite">{savedUrlStatus}</div>
            </div>
          ) : null}
        </aside>

        <section className="editor-panel">
          <header>
            <h2>Editor</h2>
            <p>Fine tune the current block and run presets.</p>
          </header>

          <label className="field">
            <span>Topic name</span>
            <input
              type="text"
              value={currentTopic.name}
              onChange={(event) => updateTopicName(event.target.value)}
              placeholder="Focus block name"
            />
          </label>

          <label className="field">
            <span>Duration ({currentMinutes} min)</span>
            <input
              type="range"
              min="1"
              max="180"
              value={currentMinutes}
              onChange={(event) => updateTopicMinutes(event.target.value)}
            />
            <input
              type="number"
              min="1"
              max="180"
              value={currentMinutes}
              onChange={(event) => updateTopicMinutes(event.target.value)}
            />
          </label>

          <label className="toggle-field">
            <input
              type="checkbox"
              checked={state.autoAdvance}
              onChange={toggleAutoAdvance}
            />
            <span>Auto-advance when a topic ends</span>
          </label>

          <div className="template-grid">
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

          <div className="utility-row">
            <button type="button" onClick={copyShareLink}>Copy share link</button>
            <button type="button" onClick={importFromClipboard}>Import clipboard lines</button>
          </div>

          <div className="status-row" aria-live="polite">
            <span>{shareStatus}</span>
            <span>{importStatus}</span>
          </div>
        </section>
      </section>
    </main>
  );
}
