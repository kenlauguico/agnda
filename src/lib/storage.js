import { parseTopicsFromHash } from './hashAgenda';
import {
  DEFAULT_TOPICS,
  instantiateTopics,
  normalizeTopics,
} from './topics';
import { clampIndex } from './time';

export const STORAGE_KEY = 'agnda:state:v2';
export const STORAGE_SCHEMA_VERSION = 2;

const LEGACY_HINT_KEYS = ['agnda:state', 'agnda-state', 'agenda-state'];

function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }

  return Boolean(value);
}

function toSafeNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return numeric;
}

function normalizeComments(comments) {
  if (!Array.isArray(comments)) {
    return [];
  }

  return comments
    .map((comment, index) => {
      if (!comment || typeof comment !== 'object') {
        return null;
      }

      const text = typeof comment.text === 'string' ? comment.text.trim() : '';
      if (!text) {
        return null;
      }

      const atSeconds = Math.max(0, Math.round(toSafeNumber(comment.atSeconds, 0)));
      const idCandidate = typeof comment.id === 'string' && comment.id.length
        ? comment.id
        : `comment-${index}-${atSeconds}`;

      return {
        id: idCandidate,
        text,
        atSeconds,
      };
    })
    .filter(Boolean);
}

function readJSON(storage, key) {
  if (!storage || typeof storage.getItem !== 'function' || !key) {
    return null;
  }

  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getCurrentLocationKeys() {
  if (!globalThis.window || !window.location) {
    return [];
  }

  const { origin, pathname, hash, href } = window.location;

  const keys = new Set([
    href,
    `${origin}${pathname}`,
    `${origin}${pathname}/`,
    `${origin}${pathname}${hash}`,
    String(window.location),
  ]);

  return [...keys].filter(Boolean);
}

function scanLegacyKeys(storage) {
  if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') {
    return [];
  }

  const matches = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) {
      continue;
    }

    const normalizedKey = String(key).toLowerCase();
    if (
      normalizedKey.includes('agnda') ||
      normalizedKey.includes('agenda') ||
      normalizedKey.startsWith('http://') ||
      normalizedKey.startsWith('https://')
    ) {
      matches.push(key);
    }
  }

  return matches;
}

export function buildInitialState(topics) {
  const normalized = normalizeTopics(topics);
  const fallbackTopics = normalized.length
    ? normalized
    : instantiateTopics(DEFAULT_TOPICS);

  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    topics: fallbackTopics,
    currentIndex: 0,
    autoAdvance: false,
    isRunning: false,
    timelineCursorSeconds: 0,
    comments: [],
  };
}

export function migrateStateRecord(record, fallbackTopics = instantiateTopics(DEFAULT_TOPICS)) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const storedTopics = normalizeTopics(record.topics);
  const topics = storedTopics.length ? storedTopics : normalizeTopics(fallbackTopics);

  if (!topics.length) {
    return null;
  }

  const currentIndex = clampIndex(record.currentIndex ?? record.currentNumber ?? 0, topics.length);

  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    topics,
    currentIndex,
    autoAdvance: toBoolean(record.autoAdvance ?? record.autoTopic ?? false),
    timelineCursorSeconds: Math.max(
      0,
      Math.round(
        toSafeNumber(
          record.timelineCursorSeconds,
          topics.reduce((sum, topic) => sum + toSafeNumber(topic.elapsed, 0), 0),
        ),
      ),
    ),
    comments: normalizeComments(record.comments),
    // We intentionally pause legacy sessions on migration to avoid multi-day drift.
    isRunning:
      record.schemaVersion === STORAGE_SCHEMA_VERSION ? toBoolean(record.isRunning) : false,
  };
}

function loadLegacyState(storage, fallbackTopics, onlyCurrentLocation = false) {
  const keys = onlyCurrentLocation
    ? getCurrentLocationKeys()
    : [...getCurrentLocationKeys(), ...LEGACY_HINT_KEYS, ...scanLegacyKeys(storage)];

  const uniqueKeys = [...new Set(keys)];

  for (const key of uniqueKeys) {
    const parsed = readJSON(storage, key);
    const migrated = migrateStateRecord(parsed, fallbackTopics);
    if (migrated) {
      return migrated;
    }
  }

  return null;
}

export function loadInitialState(storage = globalThis.window?.localStorage, hash = globalThis.window?.location?.hash ?? '') {
  const hashTopics = parseTopicsFromHash(hash);
  const hasHashTopics = hashTopics.length > 0;

  if (hasHashTopics) {
    const legacyForCurrentLocation = loadLegacyState(storage, hashTopics, true);
    if (legacyForCurrentLocation) {
      return legacyForCurrentLocation;
    }

    return buildInitialState(hashTopics);
  }

  const currentLocationLegacy = loadLegacyState(
    storage,
    instantiateTopics(DEFAULT_TOPICS),
    true,
  );
  if (currentLocationLegacy) {
    return currentLocationLegacy;
  }

  const modern = migrateStateRecord(readJSON(storage, STORAGE_KEY));
  if (modern) {
    return modern;
  }

  const legacy = loadLegacyState(storage, instantiateTopics(DEFAULT_TOPICS));
  if (legacy) {
    return legacy;
  }

  return buildInitialState(instantiateTopics(DEFAULT_TOPICS));
}

export function saveState(state, storage = globalThis.window?.localStorage) {
  if (!storage || typeof storage.setItem !== 'function') {
    return;
  }

  const topics = normalizeTopics(state?.topics);
  if (!topics.length) {
    return;
  }

  const payload = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    topics,
    currentIndex: clampIndex(state?.currentIndex ?? 0, topics.length),
    autoAdvance: toBoolean(state?.autoAdvance),
    isRunning: toBoolean(state?.isRunning),
    timelineCursorSeconds: Math.max(0, Math.round(toSafeNumber(state?.timelineCursorSeconds, 0))),
    comments: normalizeComments(state?.comments),
  };

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore write failures (private mode/quota).
  }
}
