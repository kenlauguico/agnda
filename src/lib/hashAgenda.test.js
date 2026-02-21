import { describe, expect, it } from 'vitest';
import { encodeTopicsToHash, parseTopicsFromHash } from './hashAgenda';
import { createTopicFromMinutes } from './topics';

describe('parseTopicsFromHash', () => {
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

  it('round-trips v2 hash format', () => {
    const sourceTopics = [
      createTopicFromMinutes('Intro', 7),
      createTopicFromMinutes('Build', 23),
    ];

    const hash = encodeTopicsToHash(sourceTopics);
    const parsedTopics = parseTopicsFromHash(hash);

    expect(parsedTopics).toHaveLength(2);
    expect(parsedTopics[0].name).toBe('Intro');
    expect(parsedTopics[0].seconds).toBe(7 * 60);
    expect(parsedTopics[1].seconds).toBe(23 * 60);
  });
});
