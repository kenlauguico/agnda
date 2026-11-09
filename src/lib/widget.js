import { parseAgendaHash, normalizeAgendaId } from './hashAgenda';
import { listSavedAgendas, loadInitialState, loadSavedAgenda } from './storage';
import { reconcileRunningState } from './session';
import { makeEntityId } from './topics';
import { clampIndex } from './time';

export const WIDGET_CHANNEL = 'agnda.widget';
export const WIDGET_VERSION = 1;
export const WIDGET_VIEWS = ['capture', 'time', 'progress'];

const MAX_NOTE_LENGTH = 4000;
const MAX_DURATION_SECONDS = 24 * 60 * 60;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseAllowedOrigins(value = '') {
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => {
      try {
        const url = new URL(part);
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          url.pathname === '/' &&
          !url.search &&
          !url.hash &&
          url.origin === part
        );
      } catch {
        return false;
      }
    });
}

export function resolveParentOrigin(search, allowedOrigins) {
  const candidate = new URLSearchParams(search).get('parentOrigin');
  return candidate && allowedOrigins.includes(candidate) ? candidate : null;
}

export function isTrustedParentEvent(event, parentOrigin, parentWindow) {
  return Boolean(parentOrigin && event?.origin === parentOrigin && event?.source === parentWindow);
}

export function parseWidgetTarget(value, currentOrigin) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  let hash = '';
  let sourceUrl = null;
  let foreignOrigin = false;

  if (/^[a-z0-9][a-z0-9-]*$/i.test(candidate)) {
    hash = `#${normalizeAgendaId(candidate)}`;
  } else if (candidate.startsWith('#')) {
    hash = candidate;
  } else {
    try {
      const url = new URL(candidate);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hash) return null;
      hash = url.hash;
      sourceUrl = url.href;
      foreignOrigin = url.origin !== currentOrigin;
    } catch {
      return null;
    }
  }

  const parsed = parseAgendaHash(hash);
  if (parsed.kind === 'empty') return null;

  return {
    hash,
    agendaId: parsed.agendaId,
    kind: parsed.kind,
    href: `${currentOrigin}/` + hash,
    sourceUrl,
    foreignOrigin,
  };
}

export function loadExistingWidgetAgenda(storage, target, existingEntry = null) {
  if (!storage || !target) return null;

  if (target.foreignOrigin && storage.getItem(target.sourceUrl) === null) return null;

  const entry = existingEntry ?? listSavedAgendas(storage).find((candidate) => {
    if (target.foreignOrigin && candidate.target !== target.sourceUrl) return false;
    return target.kind === 'share'
      ? candidate.kind === 'share' && candidate.sourceHash === target.hash
      : candidate.kind !== 'share' && candidate.agendaId === target.agendaId;
  }) ?? (target.foreignOrigin ? {
    agendaId: target.agendaId,
    sourceHash: target.hash,
    hash: target.hash,
    target: target.sourceUrl,
  } : null);
  if (!entry) return null;

  const modernKey = target.kind === 'share'
    ? target.hash
    : `agnda:agenda:${target.agendaId}`;
  const keys = [modernKey, entry.target, entry.hash].filter(Boolean);
  if (!keys.some((key) => storage.getItem(key) !== null)) return null;
  const state = storage.getItem(modernKey)
    ? loadInitialState(storage, target.hash)
    : loadSavedAgenda(storage, entry);
  return state?.topics?.length ? { state, entry } : null;
}

export function getActiveWidgetTopics(state) {
  if (!state?.topics?.length) return [];
  const primary = state.topics[clampIndex(state.currentIndex, state.topics.length)];
  const secondary = Number.isInteger(state.secondaryIndex)
    ? state.topics[state.secondaryIndex]
    : null;
  return [primary, secondary]
    .filter(Boolean)
    .filter((topic, index, topics) => topics.findIndex((item) => item.id === topic.id) === index);
}

export function getWidgetSnapshot(state, now = Date.now()) {
  const current = reconcileRunningState(state, now);
  const activeIds = new Set(getActiveWidgetTopics(current).map((topic) => topic.id));
  return {
    agendaId: current.agendaId,
    sourceHash: current.sourceHash,
    title: current.title,
    isRunning: current.isRunning,
    completed: !current.isRunning && current.topics.every((topic) => topic.addressed || topic.elapsed >= topic.seconds),
    capturedAt: new Date(now).toISOString(),
    topics: current.topics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      seconds: topic.seconds,
      elapsed: topic.elapsed,
      remaining: Math.max(0, topic.seconds - topic.elapsed),
      progress: topic.seconds > 0 ? Math.min(1, topic.elapsed / topic.seconds) : 0,
      noteCount: topic.notes.length,
      notes: topic.notes.map((note) => ({
        id: note.id,
        text: note.text,
        offsetSeconds: note.offsetSeconds,
      })),
      active: activeIds.has(topic.id),
    })),
    primaryTopicId: current.topics[current.currentIndex]?.id ?? null,
    secondaryTopicId: current.topics[current.secondaryIndex]?.id ?? null,
  };
}

export function adjustWidgetDuration(state, topicId, seconds) {
  if (!getActiveWidgetTopics(state).some((topic) => topic.id === topicId)) {
    throw new Error('Topic is not active');
  }
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > MAX_DURATION_SECONDS) {
    throw new Error('Duration must be between 30 seconds and 24 hours');
  }
  return {
    ...state,
    topics: state.topics.map((topic) => topic.id === topicId ? { ...topic, seconds } : topic),
  };
}

export function captureWidgetNote(state, topicId, text, now = Date.now(), timeZone = 'UTC') {
  const cleanText = typeof text === 'string' ? text.trim() : '';
  const topic = getActiveWidgetTopics(state).find((item) => item.id === topicId);
  if (!topic) throw new Error('Topic is not active');
  if (!cleanText || cleanText.length > MAX_NOTE_LENGTH) {
    throw new Error('Note must be 1–4000 characters');
  }
  const note = {
    id: makeEntityId('note'),
    text: cleanText,
    agendaId: state.agendaId,
    topicId,
    capturedAt: new Date(now).toISOString(),
    timeZone,
    offsetSeconds: topic.elapsed,
  };
  return {
    note,
    state: {
      ...state,
      topics: state.topics.map((item) => item.id === topicId
        ? { ...item, notes: [...item.notes, note] }
        : item),
    },
  };
}

export function mergeWidgetChanges(current, incoming) {
  if (!current || !incoming || current.agendaId !== incoming.agendaId ||
      current.sourceHash !== incoming.sourceHash || !Array.isArray(incoming.topics)) {
    return current;
  }
  let changed = false;
  const topics = current.topics.map((topic) => {
    const external = incoming.topics.find((item) => item.id === topic.id);
    if (!external || !Array.isArray(external.notes)) return topic;
    const knownIds = new Set(topic.notes.map((note) => note.id));
    const added = external.notes.filter((note) =>
      isObject(note) && typeof note.id === 'string' && typeof note.text === 'string' && !knownIds.has(note.id),
    );
    const seconds = Number.isInteger(external.seconds) && external.seconds >= 30
      ? external.seconds
      : topic.seconds;
    if (!added.length && seconds === topic.seconds) return topic;
    changed = true;
    return { ...topic, seconds, notes: [...topic.notes, ...added] };
  });
  return changed ? { ...current, topics } : current;
}

export function parseWidgetCommand(data) {
  const requestId = typeof data?.requestId === 'string' &&
    data.requestId.length > 0 && data.requestId.length <= 128
    ? data.requestId : null;
  if (!isObject(data) || data.channel !== WIDGET_CHANNEL || data.version !== WIDGET_VERSION || !requestId) {
    return { requestId, error: 'invalid_envelope' };
  }
  const payload = data.payload;
  switch (data.type) {
    case 'get-snapshot':
      return payload === undefined || isObject(payload)
        ? { requestId, type: data.type, payload: {} }
        : { requestId, error: 'invalid_payload' };
    case 'set-view':
      return isObject(payload) && WIDGET_VIEWS.includes(payload.view)
        ? { requestId, type: data.type, payload: { view: payload.view } }
        : { requestId, error: 'invalid_payload' };
    case 'adjust-duration':
      return isObject(payload) && typeof payload.topicId === 'string' &&
        payload.topicId.length > 0 && payload.topicId.length <= 200 &&
        Number.isInteger(payload.seconds) && payload.seconds >= 30 &&
        payload.seconds <= MAX_DURATION_SECONDS
        ? { requestId, type: data.type, payload: { topicId: payload.topicId, seconds: payload.seconds } }
        : { requestId, error: 'invalid_payload' };
    case 'save-note':
      return isObject(payload) && typeof payload.topicId === 'string' &&
        payload.topicId.length > 0 && payload.topicId.length <= 200 &&
        typeof payload.text === 'string' && payload.text.trim().length > 0 &&
        payload.text.trim().length <= MAX_NOTE_LENGTH
        ? { requestId, type: data.type, payload: { topicId: payload.topicId, text: payload.text.trim() } }
        : { requestId, error: 'invalid_payload' };
    default:
      return { requestId, error: 'unknown_command' };
  }
}

export function widgetMessage(type, requestId, payload = {}, ok = true) {
  return { channel: WIDGET_CHANNEL, version: WIDGET_VERSION, type, requestId, ok, payload };
}
