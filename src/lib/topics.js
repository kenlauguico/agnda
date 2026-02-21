const MIN_TOPIC_SECONDS = 60;
const DEFAULT_TOPIC_SECONDS = 5 * 60;
const FALLBACK_TOPIC_NAME = 'New topic';

let topicCounter = 0;

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

export function makeTopicId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  topicCounter += 1;
  return `topic-${Date.now().toString(36)}-${topicCounter.toString(36)}`;
}

export function createTopic(name, seconds, elapsed = 0) {
  return {
    id: makeTopicId(),
    name: normalizeName(name),
    seconds: normalizeSeconds(seconds),
    elapsed: normalizeElapsed(elapsed),
  };
}

export function createTopicFromMinutes(name, minutes, elapsed = 0) {
  const numeric = toFiniteNumber(minutes);
  const totalSeconds = numeric === null ? DEFAULT_TOPIC_SECONDS : numeric * 60;
  return createTopic(name, totalSeconds, elapsed);
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

      const normalizedTopic = createTopic(
        topic.name ?? topic.title ?? `Topic ${index + 1}`,
        seconds,
        topic.elapsed ?? topic.progress ?? 0,
      );

      if (topic.id && typeof topic.id === 'string') {
        return { ...normalizedTopic, id: topic.id };
      }

      return normalizedTopic;
    })
    .filter(Boolean);
}

export const DEFAULT_TOPICS = Object.freeze([
  { name: "LET'S", minutes: 5 },
  { name: 'MAKE', minutes: 10 },
  { name: 'SHIP', minutes: 5 },
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

export function instantiateTopics(templateTopics) {
  if (!Array.isArray(templateTopics)) {
    return [];
  }

  return templateTopics.map((topic) =>
    createTopicFromMinutes(topic.name, topic.minutes, topic.elapsed),
  );
}
