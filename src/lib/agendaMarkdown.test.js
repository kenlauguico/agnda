import { describe, expect, it, vi } from 'vitest';
import {
  formatAgendaMarkdown,
  formatTopicMarkdown,
  writeTextToClipboard,
} from './agendaMarkdown';

describe('agendaMarkdown', () => {
  it('formats one topic with notes and action items', () => {
    const markdown = formatTopicMarkdown({
      name: 'Opening',
      notes: [
        { text: 'Remember this' },
        { text: '- [ ] Follow up' },
      ],
    });

    expect(markdown).toBe(
      [
        '## Opening',
        '- Remember this',
        '',
        '### Action items',
        '- [ ] Follow up',
      ].join('\n'),
    );
  });

  it('formats all topics in agenda order and preserves multiline notes', () => {
    const markdown = formatAgendaMarkdown([
      {
        name: 'Opening',
        notes: [{ text: 'First line\nSecond line' }],
      },
      {
        name: 'Main Topic',
        notes: [{ text: '- [x] Decision made' }],
      },
    ]);

    expect(markdown).toContain('## Opening');
    expect(markdown).toContain('## Opening\n- First line\n  Second line');
    expect(markdown.indexOf('## Opening')).toBeLessThan(markdown.indexOf('## Main Topic'));
    expect(markdown).toContain('## Main Topic\n### Action items\n- [x] Decision made');
    expect(markdown).not.toContain('## Opening\n\n- First line');
  });

  it('uses the async clipboard api when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(
      writeTextToClipboard('Copied text', {
        navigatorRef: { clipboard: { writeText } },
        documentRef: document,
      }),
    ).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith('Copied text');
  });

  it('falls back to execCommand copy when the async clipboard api is unavailable', async () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: execCommand,
    });

    await expect(
      writeTextToClipboard('Fallback text', {
        navigatorRef: {},
        documentRef: document,
      }),
    ).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledWith('copy');
  });
});
