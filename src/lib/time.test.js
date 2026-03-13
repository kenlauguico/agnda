import { describe, expect, it } from 'vitest';
import { parseLooseDuration } from './time';

describe('parseLooseDuration', () => {
  it('parses minute-second clock values', () => {
    expect(parseLooseDuration('1:30')).toBe(90);
    expect(parseLooseDuration('01:05')).toBe(65);
  });

  it('parses loose unit phrases', () => {
    expect(parseLooseDuration('1m 30s')).toBe(90);
    expect(parseLooseDuration('2 min')).toBe(120);
    expect(parseLooseDuration('90s')).toBe(90);
  });

  it('treats bare numbers as minutes', () => {
    expect(parseLooseDuration('5')).toBe(300);
  });
});
