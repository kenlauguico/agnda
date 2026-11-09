import { describe, expect, it } from 'vitest';
import { createTopicFromMinutes } from './topics';
import { buildInitialState, saveState } from './storage';
import { reconcileRunningState } from './session';
import {
  adjustWidgetDuration,
  captureWidgetNote,
  getActiveWidgetTopics,
  getWidgetSnapshot,
  isTrustedParentEvent,
  loadExistingWidgetAgenda,
  mergeWidgetChanges,
  parseAllowedOrigins,
  parseWidgetCommand,
  parseWidgetTarget,
  resolveParentOrigin,
  widgetMessage,
} from './widget';

function memoryStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    key(index) { return [...data.keys()][index] ?? null; },
  };
}

describe('widget URL and storage', () => {
  it('accepts a saved slug or URL and marks legacy-host URLs for exact library matching', () => {
    expect(parseWidgetTarget('weekly-sync', 'https://agnda.example').hash).toBe('#weekly-sync');
    expect(parseWidgetTarget('https://agnda.example/#weekly-sync', 'https://agnda.example').agendaId).toBe('weekly-sync');
    expect(parseWidgetTarget('https://old-agnda.example/#weekly-sync', 'https://agnda.example').foreignOrigin).toBe(true);
    expect(parseWidgetTarget('javascript:alert(1)#weekly-sync', 'https://agnda.example')).toBeNull();
  });

  it('loads only a saved agenda and preserves v3 note capture metadata', () => {
    const storage = memoryStorage();
    const target = parseWidgetTarget('weekly-sync', 'https://agnda.example');
    expect(loadExistingWidgetAgenda(storage, target)).toBeNull();
    const topic = createTopicFromMinutes('Planning', 5);
    const state = buildInitialState([topic], { agendaId: 'weekly-sync', title: 'Weekly Sync' });
    saveState(state, storage);
    const loaded = loadExistingWidgetAgenda(storage, target);
    expect(loaded.state.topics[0].id).toBe(topic.id);
    const captured = captureWidgetNote(loaded.state, topic.id, 'Decision recorded', 1_765_000_000_000, 'America/Los_Angeles');
    saveState(captured.state, storage);
    const savedNote = loadExistingWidgetAgenda(storage, target, loaded.entry).state.topics[0].notes[0];
    expect(savedNote).toMatchObject({
      agendaId: 'weekly-sync',
      topicId: topic.id,
      offsetSeconds: 0,
      capturedAt: new Date(1_765_000_000_000).toISOString(),
      timeZone: 'America/Los_Angeles',
    });
  });

  it('loads an exact legacy saved URL but not an unrelated URL with the same hash', () => {
    const storage = memoryStorage();
    const topic = createTopicFromMinutes('Legacy planning', 5);
    const legacyUrl = 'https://old-agnda.example/#weekly-sync';
    storage.setItem(legacyUrl, JSON.stringify({
      ...buildInitialState([topic], { agendaId: 'weekly-sync', title: 'Weekly Sync' }),
      schemaVersion: 3,
    }));
    expect(loadExistingWidgetAgenda(storage, parseWidgetTarget(legacyUrl, 'https://agnda.example'))?.state.topics[0].name).toBe('Legacy planning');
    expect(loadExistingWidgetAgenda(storage, parseWidgetTarget('https://other.example/#weekly-sync', 'https://agnda.example'))).toBeNull();
    const target = parseWidgetTarget(legacyUrl, 'https://agnda.example');
    const loaded = loadExistingWidgetAgenda(storage, target);
    saveState(adjustWidgetDuration(loaded.state, topic.id, 420), storage);
    expect(loadExistingWidgetAgenda(storage, target)?.state.topics[0].seconds).toBe(420);
  });
});

describe('widget session mutations', () => {
  it('captures from the current clock after reload and keeps both active topics', () => {
    const first = createTopicFromMinutes('First', 5, 12);
    const second = createTopicFromMinutes('Second', 5, 4);
    const start = 1_765_000_000_000;
    const state = {
      ...buildInitialState([first, second], { agendaId: 'meeting', updatedAt: start }),
      secondaryIndex: 1,
      secondaryTopicId: second.id,
      isRunning: true,
      autoAdvance: false,
    };
    const live = reconcileRunningState(state, start + 4000);
    expect(getActiveWidgetTopics(live).map((topic) => topic.id)).toEqual([first.id, second.id]);
    const { note } = captureWidgetNote(live, second.id, 'Capture now', start + 4000, 'America/Los_Angeles');
    expect(note.offsetSeconds).toBe(8);
    expect(note.capturedAt).toBe(new Date(start + 4000).toISOString());
    expect(getWidgetSnapshot(live, start + 4000).secondaryTopicId).toBe(second.id);
    expect(getWidgetSnapshot({ ...live, topics: live.topics.map((topic) => topic.id === second.id ? { ...topic, notes: [note] } : topic) }, start + 4000)
      .topics.find((topic) => topic.id === second.id).notes).toEqual([{ id: note.id, text: note.text, offsetSeconds: 8 }]);
  });

  it('adjusts only total duration and merges widget notes into a live main-app state', () => {
    const topic = createTopicFromMinutes('Planning', 5, 95);
    const current = buildInitialState([topic], { agendaId: 'planning' });
    const adjusted = adjustWidgetDuration(current, topic.id, 420);
    expect(adjusted.topics[0].elapsed).toBe(95);
    expect(adjusted.topics[0].seconds).toBe(420);
    const captured = captureWidgetNote(adjusted, topic.id, 'Follow up', 1_765_000_000_000, 'UTC');
    const merged = mergeWidgetChanges({ ...current, topics: [{ ...topic, elapsed: 100 }] }, captured.state);
    expect(merged.topics[0].elapsed).toBe(100);
    expect(merged.topics[0].seconds).toBe(420);
    expect(merged.topics[0].notes).toHaveLength(1);
  });
});

describe('widget message contract', () => {
  it('requires an exact configured parent origin and source', () => {
    const allowed = parseAllowedOrigins('https://notes.example,https://evil.example/path,http://localhost:5173');
    expect(allowed).toEqual(['https://notes.example', 'http://localhost:5173']);
    expect(resolveParentOrigin('?parentOrigin=https%3A%2F%2Fnotes.example', allowed)).toBe('https://notes.example');
    expect(resolveParentOrigin('?parentOrigin=https%3A%2F%2Fother.example', allowed)).toBeNull();
    const parent = {};
    expect(isTrustedParentEvent({ origin: 'https://notes.example', source: parent }, 'https://notes.example', parent)).toBe(true);
    expect(isTrustedParentEvent({ origin: 'https://other.example', source: parent }, 'https://notes.example', parent)).toBe(false);
    expect(isTrustedParentEvent({ origin: 'https://notes.example', source: {} }, 'https://notes.example', parent)).toBe(false);
  });

  it('validates commands and retains request IDs for responses', () => {
    const valid = parseWidgetCommand(widgetMessage('save-note', 'req-42', { topicId: 'topic-1', text: '  Hello  ' }));
    expect(valid).toEqual({ requestId: 'req-42', type: 'save-note', payload: { topicId: 'topic-1', text: 'Hello' } });
    expect(parseWidgetCommand(widgetMessage('adjust-duration', 'req-43', { topicId: 'topic-1', seconds: -1 })).error).toBe('invalid_payload');
    expect(parseWidgetCommand(widgetMessage('set-view', 'req-44', { view: 'unknown' })).error).toBe('invalid_payload');
    expect(parseWidgetCommand(widgetMessage('get-snapshot', 'req-45', 'wrong')).error).toBe('invalid_payload');
    expect(parseWidgetCommand({ ...widgetMessage('set-view', 'req-46', { view: 'time' }), version: 2 }).error).toBe('invalid_envelope');
    expect(widgetMessage('response', valid.requestId, { noteId: 'n1' }, true)).toMatchObject({ requestId: 'req-42', ok: true });
  });
});
