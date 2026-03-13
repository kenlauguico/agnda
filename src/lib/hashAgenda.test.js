import { describe, expect, it } from 'vitest';
import {
  buildAgendaHash,
  encodeTopicsToHash,
  parseAgendaHash,
  parseTopicsFromHash,
} from './hashAgenda';
import { createTopicFromMinutes } from './topics';

describe('parseAgendaHash', () => {
  it('treats simple hashes as named agendas', () => {
    const parsed = parseAgendaHash('#weekly-sync');

    expect(parsed.kind).toBe('slug');
    expect(parsed.agendaId).toBe('weekly-sync');
    expect(parsed.topics).toHaveLength(0);
  });

  it('parses legacy alternating hash format', () => {
    const topics = parseTopicsFromHash('#Design/API/QA');

    expect(topics).toHaveLength(3);
    expect(topics[0].name).toBe('Design');
    expect(topics[0].seconds).toBe(10 * 60);
    expect(topics[1].seconds).toBe(15 * 60);
  });

  it('parses legacy minute-lock hash format', () => {
    const topics = parseTopicsFromHash('#25/Design/API/QA');

    expect(topics).toHaveLength(3);
    expect(topics[0].seconds).toBe(25 * 60);
    expect(topics[1].seconds).toBe(25 * 60);
    expect(topics[2].seconds).toBe(25 * 60);
  });

  it('round-trips the v3 share format with a title', () => {
    const sourceTopics = [
      createTopicFromMinutes('Intro', 7),
      createTopicFromMinutes('Build', 23),
    ];

    const hash = encodeTopicsToHash(sourceTopics, 'Sprint Review');
    const parsed = parseAgendaHash(hash);

    expect(parsed.kind).toBe('share');
    expect(parsed.title).toBe('Sprint Review');
    expect(parsed.topics).toHaveLength(2);
    expect(parsed.topics[0].name).toBe('Intro');
    expect(parsed.topics[0].seconds).toBe(7 * 60);
    expect(parsed.topics[1].seconds).toBe(23 * 60);
  });

  it('builds a simple slug hash for saved agendas', () => {
    expect(buildAgendaHash('Design Review')).toBe('#design-review');
  });
});
