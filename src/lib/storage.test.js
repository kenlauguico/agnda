import { describe, expect, it } from 'vitest';
import { migrateStateRecord } from './storage';

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

    const migrated = migrateStateRecord(legacyState);

    expect(migrated).not.toBeNull();
    expect(migrated.topics).toHaveLength(2);
    expect(migrated.currentIndex).toBe(1);
    expect(migrated.autoAdvance).toBe(true);
    expect(migrated.isRunning).toBe(false);
  });

  it('falls back to default topics when payload has no usable topics', () => {
    const migrated = migrateStateRecord({ autoTopic: true });

    expect(migrated).not.toBeNull();
    expect(migrated.topics.length).toBeGreaterThan(0);
    expect(migrated.autoAdvance).toBe(true);
  });
});
