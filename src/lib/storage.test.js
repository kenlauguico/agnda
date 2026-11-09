import { describe, expect, it, vi } from 'vitest';
import { encodeTopicsToHash } from './hashAgenda';
import {
  AGENDA_LIBRARY_KEY,
  STORAGE_SCHEMA_VERSION,
  deleteSavedAgenda,
  listSavedAgendas,
  loadInitialState,
  loadSavedAgenda,
  migrateStateRecord,
  saveState,
} from './storage';
import { createTopicFromMinutes } from './topics';

function createMemoryStorage(seed = {}) {
  const store = new Map(Object.entries(seed));

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

describe('migrateStateRecord', () => {
  it('migrates legacy localStorage shape from redesign/2022', () => {
    const legacyState = {
      topics: [
        { name: 'Deep work', seconds: 1500, elapsed: 120 },
        { name: 'Break', seconds: 300, elapsed: 0 },
      ],
      currentNumber: 1,
      autoTopic: true,
      on: true,
    };

    const migrated = migrateStateRecord(legacyState, undefined, {
      agendaId: 'deep-work',
      title: 'Deep Work',
    });

    expect(migrated).not.toBeNull();
    expect(migrated.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);
    expect(migrated.topics).toHaveLength(2);
    expect(migrated.currentIndex).toBe(1);
    expect(migrated.selectedTopicId).toBe(migrated.topics[1].id);
    expect(migrated.autoAdvance).toBe(true);
    expect(migrated.autoRevisitOnSelect).toBe(false);
    expect(migrated.isRunning).toBe(false);
    expect(migrated.agendaId).toBe('deep-work');
    expect(migrated.title).toBe('Deep Work');
  });
});

describe('saved agendas', () => {
  it('defaults auto advance to checked when the field is absent', () => {
    const storage = createMemoryStorage({
      'agnda:state:v3': JSON.stringify({
        schemaVersion: STORAGE_SCHEMA_VERSION,
        agendaId: 'weekly-sync',
        title: 'Weekly Sync',
        topics: [{ name: 'Kickoff', seconds: 300, elapsed: 0 }],
        currentIndex: 0,
        isRunning: false,
      }),
    });

    const loaded = loadInitialState(storage, '#weekly-sync');

    expect(loaded.autoAdvance).toBe(true);
  });

  it('defaults auto revisit to unchecked when the field is absent', () => {
    const storage = createMemoryStorage({
      'agnda:state:v3': JSON.stringify({
        schemaVersion: STORAGE_SCHEMA_VERSION,
        agendaId: 'weekly-sync',
        title: 'Weekly Sync',
        topics: [{ name: 'Kickoff', seconds: 300, elapsed: 0 }],
        currentIndex: 0,
        isRunning: false,
      }),
    });

    const loaded = loadInitialState(storage, '#weekly-sync');

    expect(loaded.autoRevisitOnSelect).toBe(false);
  });

  it('loads a saved agenda by slug hash', () => {
    const storage = createMemoryStorage();
    const topic = createTopicFromMinutes('Kickoff', 5, 45, {
      tag: 'focus',
      notes: [{ id: 'note-1', text: '- [ ] Follow up', offsetSeconds: 40 }],
    });

    saveState(
      {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        agendaId: 'weekly-sync',
        title: 'Weekly Sync',
        topics: [topic],
        currentIndex: 0,
        selectedTopicId: topic.id,
        autoAdvance: false,
        autoRevisitOnSelect: true,
        isRunning: false,
      },
      storage,
    );

    const loaded = loadInitialState(storage, '#weekly-sync');

    expect(loaded.title).toBe('Weekly Sync');
    expect(loaded.agendaId).toBe('weekly-sync');
    expect(loaded.topics[0].name).toBe('Kickoff');
    expect(loaded.topics[0].notes).toHaveLength(1);
    expect(loaded.autoRevisitOnSelect).toBe(true);
  });

  it('restores saved state when revisiting the same shared hash', () => {
    const storage = createMemoryStorage();
    const topic = createTopicFromMinutes('Shared kickoff', 5, 0, {
      notes: [{ id: 'note-1', text: 'Remember this', offsetSeconds: 15 }],
    });
    const shareHash = encodeTopicsToHash([topic], 'Shared Kickoff');

    saveState(
      {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        agendaId: 'shared-kickoff',
        sourceHash: shareHash,
        title: 'Shared Kickoff',
        topics: [topic],
        currentIndex: 0,
        selectedTopicId: topic.id,
        autoAdvance: false,
        autoRevisitOnSelect: false,
        isRunning: false,
      },
      storage,
    );

    expect(JSON.parse(storage.getItem(shareHash)).sourceHash).toBe(shareHash);

    const loaded = loadInitialState(storage, shareHash);

    expect(loaded.sourceHash).toBe(shareHash);
    expect(loaded.topics[0].name).toBe('Shared kickoff');
    expect(loaded.topics[0].notes[0].text).toBe('Remember this');
  });

  it('keeps shared agendas with the same normalized id as separate saved entries', () => {
    const storage = createMemoryStorage();
    const alphaTopic = createTopicFromMinutes('Alpha topic', 5, 0, {
      notes: [{ id: 'alpha-note', text: 'Alpha memory', offsetSeconds: 12 }],
    });
    const betaTopic = createTopicFromMinutes('Beta topic', 5, 0, {
      notes: [{ id: 'beta-note', text: 'Beta memory', offsetSeconds: 24 }],
    });
    const alphaHash = encodeTopicsToHash([alphaTopic], 'Shared Kickoff');
    const betaHash = encodeTopicsToHash([betaTopic], 'Shared Kickoff');

    saveState(
      {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        agendaId: 'shared-kickoff',
        sourceHash: alphaHash,
        title: 'Shared Kickoff',
        topics: [alphaTopic],
        currentIndex: 0,
        selectedTopicId: alphaTopic.id,
        autoAdvance: false,
        isRunning: false,
      },
      storage,
    );

    saveState(
      {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        agendaId: 'shared-kickoff',
        sourceHash: betaHash,
        title: 'Shared Kickoff',
        topics: [betaTopic],
        currentIndex: 0,
        selectedTopicId: betaTopic.id,
        autoAdvance: false,
        isRunning: false,
      },
      storage,
    );

    const library = listSavedAgendas(storage).filter((entry) => entry.agendaId === 'shared-kickoff');

    expect(library).toHaveLength(2);
    expect(library.map((entry) => entry.identityKey)).toEqual(
      expect.arrayContaining([alphaHash, betaHash]),
    );
    expect(loadInitialState(storage, alphaHash).topics[0].notes[0].text).toBe('Alpha memory');
    expect(loadInitialState(storage, betaHash).topics[0].notes[0].text).toBe('Beta memory');
  });

  it('deletes only the targeted shared agenda entry', () => {
    const storage = createMemoryStorage();
    const alphaTopic = createTopicFromMinutes('Alpha topic', 5);
    const betaTopic = createTopicFromMinutes('Beta topic', 5);
    const alphaHash = encodeTopicsToHash([alphaTopic], 'Shared Kickoff');
    const betaHash = encodeTopicsToHash([betaTopic], 'Shared Kickoff');

    saveState(
      {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        agendaId: 'shared-kickoff',
        sourceHash: alphaHash,
        title: 'Shared Kickoff',
        topics: [alphaTopic],
        currentIndex: 0,
        selectedTopicId: alphaTopic.id,
        autoAdvance: false,
        isRunning: false,
      },
      storage,
    );

    saveState(
      {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        agendaId: 'shared-kickoff',
        sourceHash: betaHash,
        title: 'Shared Kickoff',
        topics: [betaTopic],
        currentIndex: 0,
        selectedTopicId: betaTopic.id,
        autoAdvance: false,
        isRunning: false,
      },
      storage,
    );

    const alphaEntry = listSavedAgendas(storage).find((entry) => entry.identityKey === alphaHash);
    deleteSavedAgenda(storage, alphaEntry);

    expect(storage.getItem(alphaHash)).toBeNull();
    expect(storage.getItem(betaHash)).not.toBeNull();
    expect(listSavedAgendas(storage).map((entry) => entry.identityKey)).toEqual([betaHash]);
  });

  it('continues counting after refresh when a session was running', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-27T13:20:30Z'));

    const storage = createMemoryStorage({
      'agnda:state:v3': JSON.stringify({
        schemaVersion: STORAGE_SCHEMA_VERSION,
        agendaId: 'weekly-sync',
        title: 'Weekly Sync',
        topics: [{ name: 'Kickoff', seconds: 300, elapsed: 45 }],
        currentIndex: 0,
        isRunning: true,
        updatedAt: new Date('2026-02-27T13:20:00Z').valueOf(),
      }),
    });

    const loaded = loadInitialState(storage, '#weekly-sync');

    expect(loaded.topics[0].elapsed).toBe(75);
    expect(loaded.isRunning).toBe(true);

    vi.useRealTimers();
  });

  it('carries time across topics on restore when auto-advance is enabled', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-27T13:21:40Z'));

    const storage = createMemoryStorage();
    const firstTopic = createTopicFromMinutes('Design', 1, 50);
    const secondTopic = createTopicFromMinutes('Build', 2, 0);

    saveState(
      {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        agendaId: 'handoff',
        title: 'Handoff',
        topics: [firstTopic, secondTopic],
        currentIndex: 0,
        selectedTopicId: firstTopic.id,
        autoAdvance: true,
        isRunning: true,
      },
      storage,
    );

    const saved = JSON.parse(storage.getItem('agnda:state:v3'));
    saved.updatedAt = new Date('2026-02-27T13:21:00Z').valueOf();
    storage.setItem('agnda:state:v3', JSON.stringify(saved));
    storage.setItem(`agnda:agenda:${saved.agendaId}`, JSON.stringify(saved));

    const loaded = loadInitialState(storage, '#handoff');

    expect(loaded.currentIndex).toBe(1);
    expect(loaded.selectedTopicId).toBe(loaded.topics[1].id);
    expect(loaded.topics[0].elapsed).toBe(60);
    expect(loaded.topics[1].elapsed).toBe(30);
    expect(loaded.isRunning).toBe(true);

    vi.useRealTimers();
  });

  it('includes legacy URL-based localStorage agendas in the menu list', () => {
    const storage = createMemoryStorage({
      'https://agnda.example.com/#25/Design/API': JSON.stringify({
        topics: [
          { name: 'Design', seconds: 1500, elapsed: 120 },
          { name: 'API', seconds: 1500, elapsed: 0 },
        ],
        currentNumber: 0,
        autoTopic: false,
      }),
    });

    const library = listSavedAgendas(storage);

    expect(library).toHaveLength(1);
    expect(library[0].target).toBe('https://agnda.example.com/#25/Design/API');
    expect(library[0].hash).toBe('#25/Design/API');
    expect(library[0].firstTopic).toBe('Design');
  });

  it('loads a legacy URL-keyed agenda directly from a saved card entry', () => {
    const storage = createMemoryStorage({
      'https://agnda.example.com/#25/Design/API': JSON.stringify({
        topics: [
          { name: 'Design', seconds: 1500, elapsed: 120 },
          { name: 'API', seconds: 1500, elapsed: 0 },
        ],
        currentNumber: 1,
        autoTopic: true,
      }),
    });

    const [entry] = listSavedAgendas(storage);
    const loaded = loadSavedAgenda(storage, entry);

    expect(loaded).not.toBeNull();
    expect(loaded.agendaId).toBe('design');
    expect(loaded.topics).toHaveLength(2);
    expect(loaded.topics[0].name).toBe('Design');
    expect(loaded.currentIndex).toBe(1);
    expect(loaded.selectedTopicId).toBe(loaded.topics[1].id);
    expect(loaded.autoAdvance).toBe(true);
  });

  it('loads a legacy URL-keyed agenda when a matching slug hash is typed directly', () => {
    const storage = createMemoryStorage({
      'https://agnda.example.com/#25/Design/API': JSON.stringify({
        topics: [
          { name: 'Design', seconds: 1500, elapsed: 120 },
          { name: 'API', seconds: 1500, elapsed: 0 },
        ],
        currentNumber: 1,
        autoTopic: true,
      }),
    });

    const loaded = loadInitialState(storage, '#design');

    expect(loaded.agendaId).toBe('design');
    expect(loaded.topics).toHaveLength(2);
    expect(loaded.currentIndex).toBe(1);
  });

  it('creates a fresh empty agenda for a new slug instead of loading the current one', () => {
    const storage = createMemoryStorage({
      'agnda:state:v3': JSON.stringify({
        schemaVersion: STORAGE_SCHEMA_VERSION,
        agendaId: 'weekly-sync',
        title: 'Weekly Sync',
        topics: [{ name: 'Kickoff', seconds: 300, elapsed: 0 }],
        currentIndex: 0,
        isRunning: false,
      }),
    });

    const loaded = loadInitialState(storage, '#fresh-agnda');

    expect(loaded.agendaId).toBe('fresh-agnda');
    expect(loaded.title).toBe('Fresh Agnda');
    expect(loaded.topics).toHaveLength(0);
  });

  it('writes library metadata and removes renamed agenda keys', () => {
    const storage = createMemoryStorage();
    const firstTopic = createTopicFromMinutes('First topic', 5);

    saveState(
      {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        agendaId: 'old-name',
        title: 'Old Name',
        topics: [firstTopic],
        currentIndex: 0,
        selectedTopicId: firstTopic.id,
        autoAdvance: false,
        isRunning: false,
      },
      storage,
    );

    saveState(
      {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        agendaId: 'new-name',
        title: 'New Name',
        topics: [firstTopic],
        currentIndex: 0,
        selectedTopicId: firstTopic.id,
        autoAdvance: false,
        isRunning: false,
      },
      storage,
      { previousAgendaId: 'old-name' },
    );

    const library = listSavedAgendas(storage);

    expect(storage.getItem('agnda:agenda:old-name')).toBeNull();
    expect(library).toHaveLength(1);
    expect(library[0].hash).toBe('#new-name');
    expect(library[0].firstTopic).toBe('First topic');
    expect(JSON.parse(storage.getItem(AGENDA_LIBRARY_KEY))).toHaveLength(1);
  });

  it('deletes saved agendas from storage and the library index', () => {
    const storage = createMemoryStorage();
    const topic = createTopicFromMinutes('Kickoff', 5);

    saveState(
      {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        agendaId: 'weekly-sync',
        title: 'Weekly Sync',
        topics: [topic],
        currentIndex: 0,
        selectedTopicId: topic.id,
        autoAdvance: false,
        isRunning: false,
      },
      storage,
    );

    const [entry] = listSavedAgendas(storage);
    deleteSavedAgenda(storage, entry);

    expect(storage.getItem('agnda:agenda:weekly-sync')).toBeNull();
    expect(listSavedAgendas(storage)).toHaveLength(0);
    expect(JSON.parse(storage.getItem(AGENDA_LIBRARY_KEY))).toEqual([]);
  });
});
