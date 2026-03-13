import { describe, expect, it } from 'vitest';
import { createTopicFromMinutes, reorderTopics } from './topics';

describe('reorderTopics', () => {
  it('moves a topic before another topic', () => {
    const opening = createTopicFromMinutes('Opening', 2);
    const build = createTopicFromMinutes('Build', 10);
    const wrap = createTopicFromMinutes('Wrap', 5);

    const reordered = reorderTopics([opening, build, wrap], wrap.id, opening.id, 'before');

    expect(reordered.map((topic) => topic.name)).toEqual(['Wrap', 'Opening', 'Build']);
  });

  it('moves a topic after another topic and returns the original array for no-ops', () => {
    const opening = createTopicFromMinutes('Opening', 2);
    const build = createTopicFromMinutes('Build', 10);
    const wrap = createTopicFromMinutes('Wrap', 5);
    const topics = [opening, build, wrap];

    const reordered = reorderTopics(topics, opening.id, wrap.id, 'after');
    const unchanged = reorderTopics(topics, opening.id, opening.id, 'before');

    expect(reordered.map((topic) => topic.name)).toEqual(['Build', 'Wrap', 'Opening']);
    expect(unchanged).toBe(topics);
  });
});
