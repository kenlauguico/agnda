const MIN_TOPIC_SECONDS = 30;
const DEFAULT_TOPIC_SECONDS = 5 * 60;
const FALLBACK_TOPIC_NAME = 'New topic';

let recordCounter = 0;

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }

  return Boolean(value);
}

function normalizeName(name, fallback = FALLBACK_TOPIC_NAME) {
  if (typeof name !== 'string') {
    return fallback;
  }

  const trimmed = name.trim();
  return trimmed.length ? trimmed : fallback;
}

function normalizeSeconds(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return DEFAULT_TOPIC_SECONDS;
  }

  return Math.max(MIN_TOPIC_SECONDS, Math.round(numeric));
}

function normalizeElapsed(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return 0;
  }

  return Math.max(0, Math.round(numeric));
}

function normalizeTag(tag) {
  if (typeof tag !== 'string') {
    return '';
  }

  const trimmed = tag.trim().toLowerCase();
  return TOPIC_TAGS.some((option) => option.id === trimmed) ? trimmed : '';
}

function normalizeNotes(candidateNotes) {
  if (!Array.isArray(candidateNotes)) {
    return [];
  }

  return candidateNotes
    .map((note, index) => {
      if (!note || typeof note !== 'object') {
        return null;
      }

      const text = typeof note.text === 'string' ? note.text.trim() : '';
      if (!text) {
        return null;
      }

      return {
        id:
          typeof note.id === 'string' && note.id.trim()
            ? note.id
            : makeEntityId(`note-${index + 1}`),
        text,
        offsetSeconds: normalizeElapsed(note.offsetSeconds ?? note.elapsed ?? 0),
      };
    })
    .filter(Boolean);
}

export function makeEntityId(prefix = 'record') {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  recordCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${recordCounter.toString(36)}`;
}

export function createTopic(name, seconds, elapsed = 0, options = {}) {
  return {
    id:
      typeof options.id === 'string' && options.id.trim()
        ? options.id
        : makeEntityId('topic'),
    name: normalizeName(name),
    seconds: normalizeSeconds(seconds),
    elapsed: normalizeElapsed(elapsed),
    tag: normalizeTag(options.tag),
    addressed: toBoolean(options.addressed ?? options.done),
    notes: normalizeNotes(options.notes),
  };
}

export function createTopicFromMinutes(name, minutes, elapsed = 0, options = {}) {
  const numeric = toFiniteNumber(minutes);
  const totalSeconds = numeric === null ? DEFAULT_TOPIC_SECONDS : numeric * 60;
  return createTopic(name, totalSeconds, elapsed, options);
}

export function normalizeTopics(candidateTopics) {
  if (!Array.isArray(candidateTopics)) {
    return [];
  }

  return candidateTopics
    .map((topic, index) => {
      if (!topic || typeof topic !== 'object') {
        return null;
      }

      const seconds =
        topic.seconds ??
        topic.durationSeconds ??
        (Number.isFinite(Number(topic.minutes)) ? Number(topic.minutes) * 60 : null);

      return createTopic(
        topic.name ?? topic.title ?? `Topic ${index + 1}`,
        seconds,
        topic.elapsed ?? topic.progress ?? 0,
        {
          id: topic.id,
          tag: topic.tag,
          addressed: topic.addressed ?? topic.done,
          notes: topic.notes,
        },
      );
    })
    .filter(Boolean);
}

export const DEFAULT_TOPICS = Object.freeze([
  { name: 'Opening', minutes: 2 },
  { name: 'Main Topic', minutes: 10 },
  { name: 'Wrap Up', minutes: 5 },
]);

export const TEMPLATE_PRESETS = Object.freeze([
  {
    id: 'pomodoro',
    label: 'Pomodoro',
    topics: [
      { name: 'Work', minutes: 25 },
      { name: 'Break', minutes: 5 },
      { name: 'Work', minutes: 25 },
      { name: 'Break', minutes: 5 },
      { name: 'Work', minutes: 25 },
      { name: 'Break', minutes: 5 },
      { name: 'Work', minutes: 25 },
      { name: 'Long Break', minutes: 15 },
    ],
  },
  {
    id: 'hourdoro',
    label: 'Hourdoro',
    topics: [
      { name: 'Warm up', minutes: 5 },
      { name: 'Get serious', minutes: 10 },
      { name: 'Deep focus', minutes: 15 },
      { name: 'Finish task', minutes: 15 },
      { name: 'Break', minutes: 15 },
    ],
  },
  {
    id: 'jkflow',
    label: 'JK Flow',
    topics: [
      { name: 'Struggle', minutes: 15 },
      { name: 'Relaxation', minutes: 5 },
      { name: 'Flow', minutes: 45 },
      { name: 'Consolidation', minutes: 15 },
    ],
  },
]);

export const TOPIC_DURATION_OPTIONS = Object.freeze([
  { label: '30s', seconds: 30 },
  { label: '60s', seconds: 60 },
  { label: '2m', seconds: 2 * 60 },
  { label: '5m', seconds: 5 * 60 },
  { label: '10m', seconds: 10 * 60 },
  { label: '15m', seconds: 15 * 60 },
  { label: '25m', seconds: 25 * 60 },
  { label: '30m', seconds: 30 * 60 },
  { label: '45m', seconds: 45 * 60 },
  { label: '60m', seconds: 60 * 60 },
]);

export const TOPIC_TAGS = Object.freeze([
  { id: 'open', label: 'Open', tone: 'lemon' },
  { id: 'focus', label: 'Focus', tone: 'mint' },
  { id: 'decision', label: 'Decision', tone: 'sky' },
  { id: 'parking', label: 'Parking', tone: 'peach' },
  { id: 'done', label: 'Done', tone: 'rose' },
]);

export function instantiateTopics(templateTopics) {
  if (!Array.isArray(templateTopics)) {
    return [];
  }

  return templateTopics.map((topic) =>
    createTopicFromMinutes(topic.name, topic.minutes, topic.elapsed, {
      tag: topic.tag,
      addressed: topic.addressed,
      notes: topic.notes,
    }),
  );
}

export function reorderTopics(candidateTopics, sourceTopicId, targetTopicId, placement = 'before') {
  if (!Array.isArray(candidateTopics) || candidateTopics.length < 2) {
    return candidateTopics;
  }

  const sourceIndex = candidateTopics.findIndex((topic) => topic.id === sourceTopicId);
  const targetIndex = candidateTopics.findIndex((topic) => topic.id === targetTopicId);

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return candidateTopics;
  }

  const nextTopics = candidateTopics.slice();
  const [movedTopic] = nextTopics.splice(sourceIndex, 1);
  const normalizedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const insertionIndex =
    placement === 'after' ? normalizedTargetIndex + 1 : normalizedTargetIndex;

  nextTopics.splice(Math.max(0, Math.min(insertionIndex, nextTopics.length)), 0, movedTopic);

  const changed = nextTopics.some((topic, index) => topic !== candidateTopics[index]);
  return changed ? nextTopics : candidateTopics;
}
