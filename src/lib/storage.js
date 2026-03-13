import {
  buildAgendaHash,
  humanizeAgendaId,
  normalizeAgendaId,
  parseAgendaHash,
} from './hashAgenda';
import { reconcileRunningState } from './session';
import { DEFAULT_TOPICS, instantiateTopics, normalizeTopics } from './topics';
import { clampIndex } from './time';

export const STORAGE_KEY = 'agnda:state:v3';
export const STORAGE_SCHEMA_VERSION = 3;
export const AGENDA_LIBRARY_KEY = 'agnda:library:v1';

const AGENDA_KEY_PREFIX = 'agnda:agenda:';
const DEFAULT_AGENDA_ID = 'today';
const LEGACY_HINT_KEYS = ['agnda:state:v2', 'agnda:state', 'agnda-state', 'agenda-state'];

function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }

  return Boolean(value);
}

function normalizeTimestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.now();
}

function normalizeAgendaTitle(title, agendaId = DEFAULT_AGENDA_ID) {
  if (typeof title === 'string' && title.trim()) {
    return title.trim();
  }

  return humanizeAgendaId(agendaId);
}

function getAgendaStorageKey(agendaId) {
  return `${AGENDA_KEY_PREFIX}${normalizeAgendaId(agendaId)}`;
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

function writeJSON(storage, key, value) {
  if (!storage || typeof storage.setItem !== 'function') {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore write failures (private mode/quota).
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

function getSelectedTopicId(record, topics, currentIndex) {
  if (
    typeof record?.selectedTopicId === 'string' &&
    topics.some((topic) => topic.id === record.selectedTopicId)
  ) {
    return record.selectedTopicId;
  }

  return topics[currentIndex]?.id ?? null;
}

export function buildInitialState(topics, options = {}) {
  const normalized = normalizeTopics(topics);
  const allowEmptyTopics = toBoolean(options.allowEmptyTopics);
  const fallbackTopics = normalized.length
    ? normalized
    : allowEmptyTopics
      ? []
      : instantiateTopics(DEFAULT_TOPICS);
  const currentIndex = fallbackTopics.length
    ? clampIndex(options.currentIndex ?? 0, fallbackTopics.length)
    : 0;
  const agendaId = normalizeAgendaId(options.agendaId ?? options.title, DEFAULT_AGENDA_ID);

  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    agendaId,
    title: normalizeAgendaTitle(options.title, agendaId),
    topics: fallbackTopics,
    currentIndex,
    selectedTopicId:
      typeof options.selectedTopicId === 'string' &&
      fallbackTopics.some((topic) => topic.id === options.selectedTopicId)
        ? options.selectedTopicId
        : fallbackTopics[currentIndex]?.id ?? null,
    autoAdvance: toBoolean(options.autoAdvance),
    autoRevisitOnSelect: toBoolean(options.autoRevisitOnSelect),
    isRunning: toBoolean(options.isRunning),
    updatedAt: normalizeTimestamp(options.updatedAt),
  };
}

export function migrateStateRecord(
  record,
  fallbackTopics = instantiateTopics(DEFAULT_TOPICS),
  options = {},
) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const storedTopics = normalizeTopics(record.topics);
  const topics = storedTopics.length ? storedTopics : normalizeTopics(fallbackTopics);

  if (!topics.length) {
    return null;
  }

  const currentIndex = clampIndex(record.currentIndex ?? record.currentNumber ?? 0, topics.length);
  const agendaId = normalizeAgendaId(
    record.agendaId ?? options.agendaId ?? record.title ?? options.title,
    DEFAULT_AGENDA_ID,
  );

  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    agendaId,
    title: normalizeAgendaTitle(record.title ?? options.title, agendaId),
    topics,
    currentIndex,
    selectedTopicId: getSelectedTopicId(record, topics, currentIndex),
    autoAdvance: toBoolean(record.autoAdvance ?? record.autoTopic ?? false),
    autoRevisitOnSelect: toBoolean(record.autoRevisitOnSelect),
    // We intentionally pause legacy sessions on migration to avoid multi-day drift.
    isRunning:
      Number(record.schemaVersion) === STORAGE_SCHEMA_VERSION ? toBoolean(record.isRunning) : false,
    updatedAt: normalizeTimestamp(record.updatedAt),
  };
}

function loadLegacyState(storage, fallbackTopics, options = {}) {
  const { onlyCurrentLocation = false, agendaId, title } = options;
  const keys = onlyCurrentLocation
    ? getCurrentLocationKeys()
    : [...getCurrentLocationKeys(), ...LEGACY_HINT_KEYS, ...scanLegacyKeys(storage)];

  const uniqueKeys = [...new Set(keys)];

  for (const key of uniqueKeys) {
    if (
      !key ||
      key === STORAGE_KEY ||
      key === AGENDA_LIBRARY_KEY ||
      key.startsWith(AGENDA_KEY_PREFIX)
    ) {
      continue;
    }

    const parsed = readJSON(storage, key);
    const migrated = reconcileRunningState(
      migrateStateRecord(parsed, fallbackTopics, { agendaId, title }),
    );
    if (migrated) {
      return migrated;
    }
  }

  return null;
}

function loadStateFromKey(storage, key, fallbackTopics, options = {}) {
  if (!key) {
    return null;
  }

  return reconcileRunningState(
    migrateStateRecord(readJSON(storage, key), fallbackTopics, options),
  );
}

function buildLibraryEntry(state, updatedAt = Date.now()) {
  const agendaId = normalizeAgendaId(state?.agendaId ?? state?.title, DEFAULT_AGENDA_ID);
  const topics = normalizeTopics(state?.topics);

  return {
    agendaId,
    hash: buildAgendaHash(agendaId),
    title: normalizeAgendaTitle(state?.title, agendaId),
    firstTopic: topics[0]?.name ?? `#${agendaId}`,
    updatedAt: normalizeTimestamp(updatedAt),
  };
}

function buildLibraryEntryFromRecord(record, options = {}) {
  const agendaId = normalizeAgendaId(
    options.agendaId ?? record?.agendaId ?? record?.title,
    DEFAULT_AGENDA_ID,
  );
  const topics = normalizeTopics(record?.topics);

  return {
    agendaId,
    hash: buildAgendaHash(agendaId),
    title: normalizeAgendaTitle(options.title ?? record?.title, agendaId),
    firstTopic: topics[0]?.name ?? `#${agendaId}`,
    target:
      typeof options.target === 'string' && options.target.trim()
        ? options.target.trim()
        : buildAgendaHash(agendaId),
    updatedAt: normalizeTimestamp(options.updatedAt ?? record?.updatedAt),
  };
}

function deriveLegacyEntryOptions(key, record) {
  if (!key) {
    return {};
  }

  if (/^https?:\/\//i.test(key)) {
    try {
      const url = new URL(key);
      const hashInfo = parseAgendaHash(url.hash || '');
      const agendaId = normalizeAgendaId(
        hashInfo.agendaId ?? record?.agendaId ?? record?.title ?? key,
        DEFAULT_AGENDA_ID,
      );

      return {
        agendaId,
        title: hashInfo.title || record?.title || normalizeAgendaTitle('', agendaId),
        hash: url.hash || buildAgendaHash(agendaId),
        target: key,
      };
    } catch {
      return {};
    }
  }

  const agendaId = normalizeAgendaId(record?.agendaId ?? record?.title ?? key, DEFAULT_AGENDA_ID);
  return {
    agendaId,
    title: record?.title || normalizeAgendaTitle('', agendaId),
    hash: buildAgendaHash(agendaId),
    target: buildAgendaHash(agendaId),
  };
}

function mergeLibraryEntries(entries) {
  const byAgendaId = new Map();

  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }

    const agendaId = normalizeAgendaId(
      entry.agendaId ?? entry.hash ?? entry.title,
      '',
    );

    if (!agendaId) {
      return;
    }

    const normalizedEntry = {
      agendaId,
      hash: buildAgendaHash(agendaId),
      title: normalizeAgendaTitle(entry.title, agendaId),
      firstTopic:
        typeof entry.firstTopic === 'string' && entry.firstTopic.trim()
          ? entry.firstTopic.trim()
          : `#${agendaId}`,
      target:
        typeof entry.target === 'string' && entry.target.trim()
          ? entry.target.trim()
          : buildAgendaHash(agendaId),
      updatedAt: normalizeTimestamp(entry.updatedAt),
    };

    const existing = byAgendaId.get(agendaId);
    if (!existing || normalizedEntry.updatedAt >= existing.updatedAt) {
      byAgendaId.set(agendaId, normalizedEntry);
    }
  });

  return [...byAgendaId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function scanStoredAgendas(storage) {
  if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') {
    return [];
  }

  const entries = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(AGENDA_KEY_PREFIX)) {
      continue;
    }

    const parsed = readJSON(storage, key);
    const migrated = migrateStateRecord(parsed);
    if (!migrated) {
      continue;
    }

    entries.push(buildLibraryEntry(migrated, migrated.updatedAt));
  }

  return entries;
}

function scanLegacyAgendaEntries(storage) {
  if (!storage) {
    return [];
  }

  const legacyKeys = [...new Set([...LEGACY_HINT_KEYS, ...scanLegacyKeys(storage)])];
  const entries = [];

  legacyKeys.forEach((key) => {
    if (
      !key ||
      key === STORAGE_KEY ||
      key === AGENDA_LIBRARY_KEY ||
      key.startsWith(AGENDA_KEY_PREFIX)
    ) {
      return;
    }

    const parsed = readJSON(storage, key);
    const options = deriveLegacyEntryOptions(key, parsed);
    const migrated = migrateStateRecord(parsed, instantiateTopics(DEFAULT_TOPICS), options);

    if (!migrated) {
      return;
    }

    entries.push(
      buildLibraryEntryFromRecord(migrated, {
        ...options,
        updatedAt: migrated.updatedAt,
      }),
    );
  });

  return entries;
}

export function listSavedAgendas(storage = globalThis.window?.localStorage) {
  if (!storage) {
    return [];
  }

  const indexedEntries = readJSON(storage, AGENDA_LIBRARY_KEY);
  const mergedEntries = mergeLibraryEntries([
    ...(Array.isArray(indexedEntries) ? indexedEntries : []),
    ...scanStoredAgendas(storage),
    ...scanLegacyAgendaEntries(storage),
  ]);

  if (mergedEntries.length) {
    writeJSON(storage, AGENDA_LIBRARY_KEY, mergedEntries);
  }

  return mergedEntries;
}

export function findSavedAgendaEntry(
  storage = globalThis.window?.localStorage,
  agendaId = '',
) {
  const normalizedAgendaId = normalizeAgendaId(agendaId, '');
  if (!normalizedAgendaId) {
    return null;
  }

  return (
    listSavedAgendas(storage).find((entry) => entry.agendaId === normalizedAgendaId) ?? null
  );
}

export function loadInitialState(
  storage = globalThis.window?.localStorage,
  hash = globalThis.window?.location?.hash ?? '',
) {
  const hashInfo = parseAgendaHash(hash);
  const fallbackTopics = hashInfo.topics.length
    ? hashInfo.topics
    : instantiateTopics(DEFAULT_TOPICS);
  const agendaId = normalizeAgendaId(hashInfo.agendaId, DEFAULT_AGENDA_ID);
  const title = normalizeAgendaTitle(hashInfo.title, agendaId);

  if (hashInfo.kind === 'slug') {
    const savedAgenda = loadStateFromKey(storage, getAgendaStorageKey(agendaId), fallbackTopics, {
      agendaId,
      title,
    });

    if (savedAgenda) {
      return savedAgenda;
    }

    const mirroredCurrentAgenda = loadStateFromKey(storage, STORAGE_KEY, fallbackTopics, {
      agendaId,
      title,
    });
    if (mirroredCurrentAgenda?.agendaId === agendaId) {
      return mirroredCurrentAgenda;
    }

    const savedEntry = findSavedAgendaEntry(storage, agendaId);
    if (savedEntry) {
      return (
        loadSavedAgenda(storage, savedEntry) ??
        buildInitialState([], { agendaId, title, allowEmptyTopics: true })
      );
    }

    return buildInitialState([], { agendaId, title, allowEmptyTopics: true });
  }

  if (hashInfo.kind === 'share') {
    return buildInitialState(fallbackTopics, { agendaId, title });
  }

  const modern = reconcileRunningState(
    migrateStateRecord(readJSON(storage, STORAGE_KEY), fallbackTopics, { agendaId, title }),
  );
  if (modern) {
    return modern;
  }

  const legacy = loadLegacyState(storage, fallbackTopics, { agendaId, title });
  if (legacy) {
    return legacy;
  }

  return buildInitialState(fallbackTopics, { agendaId, title });
}

export function loadSavedAgenda(
  storage = globalThis.window?.localStorage,
  agendaEntry = null,
) {
  if (!storage || !agendaEntry || typeof agendaEntry !== 'object') {
    return null;
  }

  const hash =
    typeof agendaEntry.hash === 'string' && agendaEntry.hash.trim() ? agendaEntry.hash.trim() : '';
  const hashInfo = parseAgendaHash(hash);
  const fallbackTopics = hashInfo.topics.length
    ? hashInfo.topics
    : instantiateTopics(DEFAULT_TOPICS);
  const agendaId = normalizeAgendaId(
    agendaEntry.agendaId ?? hashInfo.agendaId,
    DEFAULT_AGENDA_ID,
  );
  const title = normalizeAgendaTitle(agendaEntry.title ?? hashInfo.title, agendaId);
  const target =
    typeof agendaEntry.target === 'string' && agendaEntry.target.trim()
      ? agendaEntry.target.trim()
      : '';
  const keys = [target, getAgendaStorageKey(agendaId), hash];

  for (const key of [...new Set(keys)].filter(Boolean)) {
    const loaded = loadStateFromKey(storage, key, fallbackTopics, { agendaId, title });
    if (loaded) {
      return loaded;
    }
  }

  if (hash) {
    return loadInitialState(storage, hash);
  }

  return null;
}

export function deleteSavedAgenda(
  storage = globalThis.window?.localStorage,
  agendaEntry = null,
) {
  if (!storage || !agendaEntry || typeof agendaEntry !== 'object') {
    return;
  }

  const agendaId = normalizeAgendaId(agendaEntry.agendaId, '');
  if (!agendaId) {
    return;
  }

  const keys = [
    getAgendaStorageKey(agendaId),
    typeof agendaEntry.target === 'string' ? agendaEntry.target.trim() : '',
  ];

  keys
    .filter(Boolean)
    .forEach((key) => {
      if (typeof storage.removeItem !== 'function') {
        return;
      }

      try {
        storage.removeItem(key);
      } catch {
        // Ignore cleanup failures.
      }
    });

  const nextEntries = listSavedAgendas(storage).filter((entry) => entry.agendaId !== agendaId);
  writeJSON(storage, AGENDA_LIBRARY_KEY, nextEntries);
}

export function saveState(state, storage = globalThis.window?.localStorage, options = {}) {
  if (!storage) {
    return;
  }

  const topics = normalizeTopics(state?.topics);
  if (!topics.length) {
    return;
  }

  const payload = migrateStateRecord(
    {
      ...state,
      schemaVersion: STORAGE_SCHEMA_VERSION,
      topics,
    },
    topics,
    {
      agendaId: state?.agendaId,
      title: state?.title,
    },
  );

  if (!payload) {
    return;
  }

  const updatedAt = Date.now();
  const savedPayload = {
    ...payload,
    updatedAt,
  };

  const previousAgendaId = normalizeAgendaId(options.previousAgendaId, '');

  writeJSON(storage, STORAGE_KEY, savedPayload);
  writeJSON(storage, getAgendaStorageKey(savedPayload.agendaId), savedPayload);

  if (
    previousAgendaId &&
    previousAgendaId !== savedPayload.agendaId &&
    typeof storage.removeItem === 'function'
  ) {
    try {
      storage.removeItem(getAgendaStorageKey(previousAgendaId));
    } catch {
      // Ignore cleanup failures.
    }
  }

  const nextEntries = mergeLibraryEntries(
    listSavedAgendas(storage)
      .filter(
        (entry) =>
          entry.agendaId !== previousAgendaId && entry.agendaId !== savedPayload.agendaId,
      )
      .concat(buildLibraryEntry(savedPayload, updatedAt)),
  );

  writeJSON(storage, AGENDA_LIBRARY_KEY, nextEntries);
}
