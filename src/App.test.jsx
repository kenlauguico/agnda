import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { encodeTopicsToHash } from './lib/hashAgenda';
import { formatAgendaMarkdown, formatTopicMarkdown } from './lib/agendaMarkdown';
import { STORAGE_SCHEMA_VERSION, saveState } from './lib/storage';
import { createTopicFromMinutes } from './lib/topics';

function setViewport(width, height = 900) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: height,
  });
}

function mockVisualViewport({ height = window.innerHeight, offsetTop = 0 } = {}) {
  const listeners = {
    resize: new Set(),
    scroll: new Set(),
  };
  const viewport = {
    height,
    offsetTop,
    addEventListener: vi.fn((type, listener) => {
      listeners[type]?.add(listener);
    }),
    removeEventListener: vi.fn((type, listener) => {
      listeners[type]?.delete(listener);
    }),
  };

  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    writable: true,
    value: viewport,
  });

  return {
    set(next = {}) {
      if (typeof next.height === 'number') {
        viewport.height = next.height;
      }

      if (typeof next.offsetTop === 'number') {
        viewport.offsetTop = next.offsetTop;
      }
    },
    dispatch(type = 'resize') {
      listeners[type]?.forEach((listener) => listener());
    },
  };
}

function installClipboardWriteSpy() {
  const clipboardWriteTextMock = vi.fn().mockResolvedValue(undefined);

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      ...(navigator.clipboard ?? {}),
      writeText: clipboardWriteTextMock,
    },
  });

  return clipboardWriteTextMock;
}

function getFaviconHref() {
  return document.head.querySelector('link[rel="icon"]')?.getAttribute('href') ?? null;
}

describe('App', () => {
  beforeEach(() => {
    setViewport(1280, 900);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    window.localStorage.clear();
    window.history.replaceState(null, '', '#');
    document.title = '';
    document.head.querySelectorAll('link[rel="icon"]').forEach((link) => link.remove());
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('keeps the session running when adding a topic', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Start session' }));
    expect(screen.getByRole('button', { name: 'Pause session' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show agenda info' }));
    await user.type(screen.getByPlaceholderText('Add a topic'), 'Follow-up');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByRole('button', { name: 'Pause session' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByDisplayValue('Opening')).toBeInTheDocument();
  });

  it('shows the agenda name in the topics header and reveals agenda controls from the info button', async () => {
    const user = userEvent.setup();

    render(<App />);

    const topicsPanel = screen.getByRole('list', { name: 'Agenda topics' }).closest('.topics-panel');
    expect(within(topicsPanel).getByText(/^Agnda$/i)).toBeInTheDocument();
    expect(within(topicsPanel).getByRole('button', { name: 'Show agenda info' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Agenda info' })).not.toBeInTheDocument();

    await user.click(within(topicsPanel).getByRole('button', { name: 'Show agenda info' }));

    const dialog = screen.getByRole('dialog', { name: 'Agenda info' });
    expect(within(dialog).getByPlaceholderText('Name this agnda')).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText('Add a topic')).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText('Add a topic')).toHaveFocus();
  });

  it('minimizes the session clock into a floating summary and restores it', async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Time so far' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Minimize session clock' }));

    const floatingClock = screen.getByRole('region', { name: 'Floating session clock' });
    expect(screen.queryByRole('heading', { name: 'Time so far' })).not.toBeInTheDocument();
    expect(within(floatingClock).getByRole('img', { name: /Agenda progress/i })).toBeInTheDocument();
    expect(within(floatingClock).getByRole('button', { name: 'Expand session clock' })).toBeInTheDocument();
    expect(within(floatingClock).getByRole('button', { name: 'Start session' })).toBeInTheDocument();
    const topicJumpButton = within(floatingClock).getByRole('button', {
      name: 'Go to current topic Opening',
    });
    expect(within(floatingClock).getByText('Opening')).toBeInTheDocument();
    expect(within(floatingClock).queryByText(/current remaining/i)).not.toBeInTheDocument();
    expect(topicJumpButton).toHaveClass('session-float__ring-button');
    expect(topicJumpButton.querySelector('.session-float__ring')).not.toBeNull();
    expect(topicJumpButton.querySelector('.focus-agenda-ring--floating')).toBeNull();
    expect(floatingClock.querySelector('.session-float__copy-button')).toBeNull();

    await user.click(within(floatingClock).getByRole('button', { name: 'Expand session clock' }));

    expect(screen.getByRole('heading', { name: 'Time so far' })).toBeInTheDocument();
  });

  it('shows the current topic in the window title and uses the static timer favicon on load', () => {
    render(<App />);

    expect(document.title).toBe('Opening | AGNDA');
    expect(getFaviconHref()).toBe('/favicon.svg');
  });

  it('switches to a live progress favicon while the current topic timer is running', () => {
    vi.useFakeTimers();

    try {
      render(<App />);

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
      });

      const initialLiveHref = getFaviconHref();
      expect(initialLiveHref).toMatch(/^data:image\/svg\+xml,/);

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      const updatedLiveHref = getFaviconHref();
      expect(updatedLiveHref).toMatch(/^data:image\/svg\+xml,/);
      expect(updatedLiveHref).not.toBe(initialLiveHref);
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('keeps tab metadata tied to the active topic when another topic is selected', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Start session' }));
    const liveOpeningHref = getFaviconHref();

    await user.click(screen.getByText('Main Topic').closest('button'));

    expect(screen.getByRole('heading', { name: 'Viewing' })).toBeInTheDocument();
    expect(document.title).toBe('Opening | AGNDA');
    expect(getFaviconHref()).toBe(liveOpeningHref);
  });

  it('falls back to the agenda name in the title and static favicon when there is no current topic', () => {
    window.history.replaceState(null, '', '#empty-fallback');

    render(<App />);

    expect(document.title).toBe('Empty Fallback | AGNDA');
    expect(getFaviconHref()).toBe('/favicon.svg');
  });

  it('accepts loose custom duration input for the selected topic', async () => {
    const user = userEvent.setup();

    render(<App />);

    const durationInput = screen.getByRole('combobox', { name: 'Topic duration' });
    await user.clear(durationInput);
    await user.type(durationInput, '1m 30s{enter}');

    const firstTopic = within(screen.getByRole('list', { name: 'Agenda topics' })).getAllByRole('listitem')[0];

    expect(durationInput).toHaveValue('1m 30s');
    expect(firstTopic).toHaveTextContent('1m 30s');
  });

  it('accepts preset duration suggestions from the editable duration combobox', async () => {
    const user = userEvent.setup();

    render(<App />);

    const durationInput = screen.getByRole('combobox', { name: 'Topic duration' });
    await user.clear(durationInput);
    await user.type(durationInput, '10m');
    fireEvent.blur(durationInput);

    const firstTopic = within(screen.getByRole('list', { name: 'Agenda topics' })).getAllByRole('listitem')[0];
    expect(durationInput).toHaveValue('10m');
    expect(firstTopic).toHaveTextContent('10m');
  });

  it('copies the selected topic as markdown with the keyboard copy shortcut', async () => {
    const user = userEvent.setup();

    render(<App />);

    const noteInput = screen.getByPlaceholderText(/Capture agnda notes/i);
    await user.type(noteInput, 'Remember this{enter}');
    await user.click(noteInput);
    await user.paste('- [ ] Follow up');
    await user.keyboard('{Enter}');
    act(() => {
      noteInput.blur();
    });

    const clipboardWriteTextMock = installClipboardWriteSpy();

    act(() => {
      fireEvent.keyDown(window, { key: 'c', metaKey: true });
    });

    await waitFor(() =>
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        formatTopicMarkdown({
          name: 'Opening',
          notes: [{ text: 'Remember this' }, { text: '- [ ] Follow up' }],
        }),
      ),
    );
  });

  it('copies all topics as markdown with shift and the keyboard copy shortcut', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.type(screen.getByPlaceholderText(/Capture agnda notes/i), 'Opening note{enter}');
    await user.click(screen.getByText('Main Topic').closest('button'));
    const mainTopicNoteInput = screen.getByPlaceholderText(/Capture agnda notes/i);
    await user.click(mainTopicNoteInput);
    await user.paste('- [x] Decision made');
    await user.keyboard('{Enter}');
    act(() => {
      mainTopicNoteInput.blur();
    });

    const clipboardWriteTextMock = installClipboardWriteSpy();

    act(() => {
      fireEvent.keyDown(window, { key: 'C', metaKey: true, shiftKey: true });
    });

    await waitFor(() =>
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        formatAgendaMarkdown([
          {
            name: 'Opening',
            notes: [{ text: 'Opening note' }],
          },
          {
            name: 'Main Topic',
            notes: [{ text: '- [x] Decision made' }],
          },
          {
            name: 'Wrap Up',
            notes: [],
          },
        ]),
      ),
    );
  });

  it('does not intercept keyboard copy when an input is focused or page text is selected', async () => {
    const user = userEvent.setup();
    const selectionSpy = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue({ toString: () => '' });
    const clipboardWriteTextMock = installClipboardWriteSpy();

    render(<App />);

    const noteInput = screen.getByPlaceholderText(/Capture agnda notes/i);
    await user.click(noteInput);

    fireEvent.keyDown(noteInput, { key: 'c', metaKey: true });
    expect(clipboardWriteTextMock).not.toHaveBeenCalled();

    selectionSpy.mockReturnValue({ toString: () => 'Selected text' });

    act(() => {
      fireEvent.keyDown(window, { key: 'c', metaKey: true });
    });

    expect(clipboardWriteTextMock).not.toHaveBeenCalled();
    selectionSpy.mockRestore();
  });

  it('scrolls to the active in focus topic when the session starts', async () => {
    const user = userEvent.setup();
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });

    render(<App />);

    await user.click(screen.getByText('Main Topic').closest('button'));
    await user.click(screen.getByRole('button', { name: 'Start session' }));

    expect(screen.getByRole('heading', { name: 'In focus' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Opening')).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });

    requestAnimationFrameSpy.mockRestore();
  });

  it('scrolls to the topic detail when starting with the spacebar', async () => {
    const user = userEvent.setup();
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });

    render(<App />);

    act(() => {
      fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    });

    expect(screen.getByRole('button', { name: 'Pause session' })).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });

    requestAnimationFrameSpy.mockRestore();
  });

  it('scrolls to the topic detail when tapping the already selected topic', async () => {
    const user = userEvent.setup();
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Start session' }));
    Element.prototype.scrollIntoView.mockClear();

    await user.click(within(screen.getByRole('list', { name: 'Agenda topics' })).getAllByRole('listitem')[0]);

    expect(screen.getByRole('button', { name: 'Pause session' })).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });

    requestAnimationFrameSpy.mockRestore();
  });

  it('scrolls to the topic detail on the first tap of a different topic', async () => {
    const user = userEvent.setup();
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Start session' }));
    Element.prototype.scrollIntoView.mockClear();

    await user.click(within(screen.getByRole('list', { name: 'Agenda topics' })).getAllByRole('listitem')[1]);

    expect(screen.getByDisplayValue('Main Topic')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Viewing' })).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });

    requestAnimationFrameSpy.mockRestore();
  });

  it('auto-scrolls to the active topic when a running session is restored on load', () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });

    window.localStorage.setItem(
      'agnda:agenda:restored-live',
      JSON.stringify({
        schemaVersion: 3,
        agendaId: 'restored-live',
        title: 'Restored Live',
        topics: [
          { id: 'topic-1', name: 'Backlog', seconds: 300, elapsed: 0, notes: [] },
          { id: 'topic-2', name: 'Live Topic', seconds: 300, elapsed: 45, notes: [] },
        ],
        currentIndex: 1,
        selectedTopicId: 'topic-2',
        isRunning: true,
        updatedAt: Date.now(),
      }),
    );
    window.history.replaceState(null, '', '#restored-live');

    render(<App />);

    expect(screen.getByRole('button', { name: 'Pause session' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Live Topic')).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });

    requestAnimationFrameSpy.mockRestore();
  });

  it('shows Viewing when the selected topic is not the active topic', async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(screen.getByRole('heading', { name: 'In focus' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Start session/i }));
    await user.click(screen.getByText('Main Topic').closest('button'));

    expect(screen.getByRole('heading', { name: 'Viewing' })).toBeInTheDocument();
  });

  it('jumps to the current topic from the session clock summary', async () => {
    const user = userEvent.setup();
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });

    render(<App />);

    await user.click(screen.getByRole('button', { name: /Start session/i }));
    await user.click(screen.getByText('Main Topic').closest('button'));

    expect(screen.getByRole('heading', { name: 'Viewing' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Go to current topic Opening' }));

    expect(screen.getByDisplayValue('Opening')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'In focus' })).toBeInTheDocument();

    requestAnimationFrameSpy.mockRestore();
  });

  it('jumps to the current topic from the minimized session clock summary', async () => {
    const user = userEvent.setup();
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });

    render(<App />);

    await user.click(screen.getByRole('button', { name: /Start session/i }));
    await user.click(screen.getByText('Main Topic').closest('button'));
    await user.click(screen.getByRole('button', { name: 'Minimize session clock' }));

    const floatingClock = screen.getByRole('region', { name: 'Floating session clock' });
    const topicJumpButton = within(floatingClock).getByRole('button', {
      name: 'Go to current topic Opening',
    });
    expect(within(floatingClock).getByText('Opening')).toBeInTheDocument();
    expect(within(floatingClock).queryByText(/current remaining/i)).not.toBeInTheDocument();
    expect(topicJumpButton).toHaveClass('session-float__ring-button');
    expect(topicJumpButton.querySelector('.session-float__ring')).not.toBeNull();
    expect(topicJumpButton.querySelector('.focus-agenda-ring--floating')).toBeNull();
    expect(floatingClock.querySelector('.session-float__copy-button')).toBeNull();

    await user.click(topicJumpButton);

    expect(screen.getByDisplayValue('Opening')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'In focus' })).toBeInTheDocument();

    requestAnimationFrameSpy.mockRestore();
  });

  it('enters and exits focus mode from the session controls', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Focus mode' }));

    expect(screen.queryByRole('list', { name: 'Agenda topics' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to next topic' })).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(screen.getByRole('list', { name: 'Agenda topics' })).toBeInTheDocument();
  });

  it('moves through topics in focus mode with j and k shortcuts', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Focus mode' }));
    expect(screen.getByRole('heading', { name: 'Opening' })).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(window, { key: 'j' });
    });

    expect(screen.getByRole('heading', { name: 'Main Topic' })).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(window, { key: 'k' });
    });

    expect(screen.getByRole('heading', { name: 'Opening' })).toBeInTheDocument();
  });

  it('reveals the current topic task list in focus mode and toggles its checkboxes', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByPlaceholderText(/Capture agnda notes/i));
    await user.paste('- [ ] Follow up');
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Focus mode' }));
    await user.click(screen.getByRole('button', { name: 'Show topic tasks' }));

    const checkbox = screen.getByRole('checkbox', { name: 'Follow up' });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);

    expect(screen.getByRole('checkbox', { name: 'Follow up' })).toBeChecked();
  });

  it('keeps mobile task toggles in their menu and offers a checklist shortcut for focus notes', async () => {
    const user = userEvent.setup();
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });

    render(<App />);

    await user.click(screen.getByPlaceholderText(/Capture agnda notes/i));
    await user.paste('- [ ] Follow up');
    await user.keyboard('{Enter}');

    act(() => {
      setViewport(720, 620);
      window.dispatchEvent(new Event('resize'));
    });

    await user.click(screen.getByRole('button', { name: 'Show topic tasks' }));
    expect(screen.getByRole('checkbox', { name: 'Follow up' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Add note to /i }));

    expect(screen.queryByRole('checkbox', { name: 'Follow up' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert checklist item' })).toBeInTheDocument();

    const focusNoteInput = screen.getByPlaceholderText('Capture a focus note');
    await user.type(focusNoteInput, 'Follow up');
    await user.click(screen.getByRole('button', { name: 'Insert checklist item' }));

    expect(focusNoteInput).toHaveValue('- [ ] Follow up');
    expect(focusNoteInput).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Insert checklist item' }));

    expect(focusNoteInput).toHaveValue('Follow up');
    expect(focusNoteInput).toHaveFocus();

    requestAnimationFrameSpy.mockRestore();
  });

  it('offsets focus-mode note callouts when markers are near the screen edges', async () => {
    const user = userEvent.setup();
    const updatedAt = Date.now();

    window.localStorage.setItem(
      'agnda:agenda:edge-safe',
      JSON.stringify({
        schemaVersion: 3,
        agendaId: 'edge-safe',
        sourceHash: '#edge-safe',
        title: 'Edge Safe',
        topics: [
          {
            id: 'topic-1',
            name: 'Edge topic',
            seconds: 300,
            elapsed: 150,
            notes: [
              { id: 'note-1', text: 'Left edge', offsetSeconds: 0 },
              { id: 'note-2', text: 'Right edge', offsetSeconds: 300 },
            ],
          },
        ],
        currentIndex: 0,
        selectedTopicId: 'topic-1',
        isRunning: false,
        updatedAt,
      }),
    );
    window.history.replaceState(null, '', '#edge-safe');

    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: 'Focus mode' }));

    const markers = container.querySelectorAll('.focus-mode__topic-progress .topic-card__progress-note');
    expect(markers).toHaveLength(2);
    expect(markers[0]).toHaveAttribute('data-note-edge', 'start');
    expect(markers[1]).toHaveAttribute('data-note-edge', 'end');
  });

  it('marks the current topic addressed from the focus controls', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Focus mode' }));
    expect(screen.getByRole('heading', { name: 'Opening' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mark current topic addressed' }));

    expect(screen.getByRole('heading', { name: 'Main Topic' })).toBeInTheDocument();
  });

  it('resets the current topic from the focus controls', async () => {
    const user = userEvent.setup();
    const updatedAt = Date.now();

    window.localStorage.setItem(
      'agnda:agenda:focus-reset',
      JSON.stringify({
        schemaVersion: 3,
        agendaId: 'focus-reset',
        sourceHash: '#focus-reset',
        title: 'Focus Reset',
        topics: [
          {
            id: 'topic-1',
            name: 'Opening',
            seconds: 300,
            elapsed: 45,
            notes: [],
          },
        ],
        currentIndex: 0,
        selectedTopicId: 'topic-1',
        isRunning: false,
        updatedAt,
      }),
    );
    window.history.replaceState(null, '', '#focus-reset');

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Focus mode' }));

    const resetButton = screen.getByRole('button', { name: 'Reset current topic' });
    expect(resetButton).toBeEnabled();

    await user.click(resetButton);

    expect(screen.getByRole('button', { name: 'Reset current topic' })).toBeDisabled();
  });

  it('keeps the focus controls ordered previous, reset, play', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Focus mode' }));

    const controls = screen.getByRole('toolbar', { name: 'Focus mode controls' });
    const buttons = within(controls).getAllByRole('button');

    expect(buttons.slice(0, 3).map((button) => button.getAttribute('aria-label'))).toEqual([
      'Go to previous topic',
      'Reset current topic',
      'Start session',
    ]);
  });

  it('shows auto next topic in mini focus mode and keeps it synced with auto-advance', async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(screen.getByRole('checkbox', { name: 'Auto-advance topic' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Auto-advance topic' }));
    expect(screen.getByRole('checkbox', { name: 'Auto-advance topic' })).not.toBeChecked();

    act(() => {
      setViewport(720, 620);
      window.dispatchEvent(new Event('resize'));
    });

    const controls = screen.getByRole('toolbar', { name: 'Focus mode controls' });
    const autoNextToggle = within(controls).getByRole('checkbox', { name: 'Auto Next Topic' });
    expect(autoNextToggle).not.toBeChecked();

    await user.click(autoNextToggle);

    expect(within(controls).getByRole('checkbox', { name: 'Auto Next Topic' })).toBeChecked();
  });

  it('switches into mini mode as the window gets small', () => {
    render(<App />);

    expect(screen.getByRole('list', { name: 'Agenda topics' })).toBeInTheDocument();

    act(() => {
      setViewport(720, 620);
      window.dispatchEvent(new Event('resize'));
    });

    expect(screen.queryByRole('list', { name: 'Agenda topics' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to next topic' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit mini mode' })).toBeInTheDocument();
    expect(screen.getByText(/Mini mode/i)).toBeInTheDocument();
    expect(screen.queryByText('Later')).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Exit mini mode' }));
    });

    expect(screen.getByRole('list', { name: 'Agenda topics' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Focus mode' })).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Focus mode' }));
    });

    expect(screen.queryByRole('list', { name: 'Agenda topics' })).not.toBeInTheDocument();
    expect(screen.getByText(/Mini mode/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit mini mode' })).toBeInTheDocument();
    expect(screen.queryByText('Later')).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Exit mini mode' }));
    });

    expect(screen.getByRole('list', { name: 'Agenda topics' })).toBeInTheDocument();

    act(() => {
      setViewport(1280, 900);
      window.dispatchEvent(new Event('resize'));
    });

    act(() => {
      setViewport(720, 620);
      window.dispatchEvent(new Event('resize'));
    });

    expect(screen.queryByRole('list', { name: 'Agenda topics' })).not.toBeInTheDocument();

    act(() => {
      setViewport(1280, 900);
      window.dispatchEvent(new Event('resize'));
    });

    expect(screen.getByRole('list', { name: 'Agenda topics' })).toBeInTheDocument();
  });

  it('shows mobile copy menus only in the mobile main view and copies the selected topic', async () => {
    const user = userEvent.setup();

    const { unmount } = render(<App />);
    expect(screen.queryByRole('button', { name: 'Show topic copy actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show agenda copy actions' })).not.toBeInTheDocument();
    unmount();

    setViewport(720, 620);
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Exit mini mode' }));
    await user.type(screen.getByPlaceholderText(/Capture agnda notes/i), 'Remember this{enter}');

    await user.click(screen.getByRole('button', { name: 'Show topic copy actions' }));
    expect(screen.getByRole('menuitem', { name: 'Copy topic markdown' })).toBeInTheDocument();

    const clipboardWriteTextMock = installClipboardWriteSpy();

    await user.click(screen.getByRole('menuitem', { name: 'Copy topic markdown' }));

    await waitFor(() =>
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        formatTopicMarkdown({
          name: 'Opening',
          notes: [{ text: 'Remember this' }],
        }),
      ),
    );

    expect(screen.queryByRole('menuitem', { name: 'Copy topic markdown' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
  });

  it('copies all topics from the mobile topics header menu and dismisses the menu on outside tap', async () => {
    const user = userEvent.setup();

    setViewport(720, 620);
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Exit mini mode' }));
    await user.type(screen.getByPlaceholderText(/Capture agnda notes/i), 'Opening note{enter}');
    await user.click(screen.getByText('Main Topic').closest('button'));
    await user.click(screen.getByPlaceholderText(/Capture agnda notes/i));
    await user.paste('- [ ] Follow up');
    await user.keyboard('{Enter}');

    await user.click(screen.getByRole('button', { name: 'Show agenda copy actions' }));
    expect(screen.getByRole('menuitem', { name: 'Copy all topics markdown' })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menuitem', { name: 'Copy all topics markdown' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show agenda copy actions' }));
    const clipboardWriteTextMock = installClipboardWriteSpy();
    await user.click(screen.getByRole('menuitem', { name: 'Copy all topics markdown' }));

    await waitFor(() =>
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        formatAgendaMarkdown([
          {
            name: 'Opening',
            notes: [{ text: 'Opening note' }],
          },
          {
            name: 'Main Topic',
            notes: [{ text: '- [ ] Follow up' }],
          },
          {
            name: 'Wrap Up',
            notes: [],
          },
        ]),
      ),
    );
  });

  it('renders the agenda action queue after topics on mobile while keeping desktop order unchanged', async () => {
    const user = userEvent.setup();

    const desktopView = render(<App />);
    const desktopTopicsPanel = desktopView.container.querySelector('.topics-panel');
    const desktopDetailPanel = desktopView.container.querySelector('.detail-panel');
    const desktopActionPanel = desktopView.container.querySelector('.agenda-actions-panel');

    expect(desktopTopicsPanel.compareDocumentPosition(desktopDetailPanel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(desktopDetailPanel.compareDocumentPosition(desktopActionPanel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    desktopView.unmount();

    setViewport(720, 620);
    const mobileView = render(<App />);

    await user.click(screen.getByRole('button', { name: 'Exit mini mode' }));

    const mobileTopicsPanel = mobileView.container.querySelector('.topics-panel');
    const mobileDetailPanel = mobileView.container.querySelector('.detail-panel');
    const mobileActionPanel = mobileView.container.querySelector('.agenda-actions-panel');

    expect(mobileTopicsPanel.compareDocumentPosition(mobileActionPanel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(mobileActionPanel.compareDocumentPosition(mobileDetailPanel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('keeps the mobile agenda action queue interactive after moving it below topics', async () => {
    const user = userEvent.setup();

    setViewport(720, 620);
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Exit mini mode' }));
    await user.click(screen.getByPlaceholderText(/Capture agnda notes/i));
    await user.paste('- [ ] Opening follow-up');
    await user.keyboard('{Enter}');
    await user.click(screen.getByText('Main Topic').closest('button'));
    await user.click(screen.getByPlaceholderText(/Capture agnda notes/i));
    await user.paste('- [x] Main decision');
    await user.keyboard('{Enter}');

    const actionRegion = screen.getByRole('region', { name: 'Agenda action items' });
    await user.click(within(actionRegion).getByRole('button', { name: 'Expand action items' }));

    expect(within(actionRegion).getByText('Opening')).toBeInTheDocument();
    expect(within(actionRegion).getByText('Main Topic')).toBeInTheDocument();

    await user.click(within(actionRegion).getByRole('button', { name: 'Opening' }));
    expect(screen.getByDisplayValue('Opening')).toBeInTheDocument();

    const openingCheckbox = within(actionRegion).getByRole('checkbox', { name: 'Opening follow-up' });
    expect(openingCheckbox).not.toBeChecked();

    await user.click(openingCheckbox);

    expect(within(actionRegion).getByRole('checkbox', { name: 'Opening follow-up' })).toBeChecked();
  });

  it('keeps mini focus controls single-tap and lifts the note composer above the mobile keyboard', async () => {
    const user = userEvent.setup();
    const visualViewport = mockVisualViewport({ height: 620, offsetTop: 0 });
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });

    setViewport(720, 620);
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: 'Go to next topic' }));
    expect(screen.getByRole('heading', { name: 'Main Topic' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Add note to /i }));
    const focusNoteInput = screen.getByPlaceholderText('Capture a focus note');
    expect(focusNoteInput).toHaveFocus();

    act(() => {
      visualViewport.set({ height: 360, offsetTop: 0 });
      visualViewport.dispatch('resize');
    });

    expect(container.querySelector('.focus-mode')).toHaveClass('is-keyboard-active');

    requestAnimationFrameSpy.mockRestore();
  });

  it('inserts a new note as soon as typing starts', async () => {
    const user = userEvent.setup();

    render(<App />);

    const noteInput = screen.getByPlaceholderText(/Capture agnda notes/i);
    const notesSection = screen.getByText('Notes').closest('section');
    await user.type(noteInput, 'F');

    expect(noteInput).toHaveValue('F');
    expect(within(notesSection).getByText('F')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit note 1' })).toBeInTheDocument();

    await user.type(noteInput, 'irst note{enter}');

    expect(noteInput).toHaveValue('');
    expect(within(notesSection).getByText('First note')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit note 1' })).toHaveLength(1);
  });

  it('cancels a standard note draft and blurs the input with escape', async () => {
    const user = userEvent.setup();

    render(<App />);

    const noteInput = screen.getByPlaceholderText(/Capture agnda notes/i);
    await user.type(noteInput, 'Draft note');

    expect(noteInput).toHaveValue('Draft note');
    expect(screen.getByRole('button', { name: 'Edit note 1' })).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(noteInput, { key: 'Escape' });
    });

    expect(noteInput).toHaveValue('');
    expect(noteInput).not.toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Edit note 1' })).not.toBeInTheDocument();
  });

  it('opens note capture in focus mode as soon as typing starts', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Focus mode' }));

    act(() => {
      fireEvent.keyDown(window, { key: 'x' });
    });

    expect(screen.getByRole('button', { name: 'Save note' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('x')).toBeInTheDocument();

    await user.keyboard('yz{Enter}');

    expect(screen.queryByRole('button', { name: 'Save note' })).not.toBeInTheDocument();
    expect(screen.getByText(/Type to capture a note/i)).toBeInTheDocument();
  });

  it('disables browser autocomplete on note inputs', async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(screen.getByPlaceholderText(/Capture agnda notes/i)).toHaveAttribute('autocomplete', 'off');

    await user.click(screen.getByRole('button', { name: 'Focus mode' }));

    expect(screen.getByPlaceholderText('Capture a focus note')).toHaveAttribute('autocomplete', 'off');
  });

  it('keeps focus note drafts transient until they are saved', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Focus mode' }));
    await user.click(screen.getByRole('button', { name: /^Add note to /i }));

    const focusNoteInput = screen.getByPlaceholderText('Capture a focus note');
    await user.type(focusNoteInput, 'Draft');

    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('agnda:agenda:today')).topics[0].notes).toEqual([]);

    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem('agnda:agenda:today')).topics[0].notes).toHaveLength(1);
    });
  });

  it('cancels a focus note draft with escape without leaving focus mode', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Focus mode' }));
    await user.click(screen.getByRole('button', { name: /^Add note to /i }));

    const focusNoteInput = screen.getByPlaceholderText('Capture a focus note');
    await user.type(focusNoteInput, 'Draft note');

    act(() => {
      fireEvent.keyDown(focusNoteInput, { key: 'Escape' });
    });

    expect(focusNoteInput).not.toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Save note' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Agenda topics' })).not.toBeInTheDocument();
    expect(screen.getByText(/Type to capture a note/i)).toBeInTheDocument();
  });

  it('clears a transient focus note preview when switching topics', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Focus mode' }));
    await user.click(screen.getByRole('button', { name: /^Add note to /i }));
    await user.type(screen.getByPlaceholderText('Capture a focus note'), 'Draft');

    expect(screen.getByText('Draft')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Go to next topic' }));

    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('agnda:agenda:today')).topics[0].notes).toEqual([]);
  });

  it('opens the focus note composer from the progress bar trigger', async () => {
    const user = userEvent.setup();
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Focus mode' }));
    const noteTrigger = screen.getByRole('button', { name: /^Add note to /i });
    expect(noteTrigger.getAttribute('style')).toContain('--focus-progress-percent: 0');

    await user.click(noteTrigger);

    expect(screen.getByRole('button', { name: 'Save note' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Capture a focus note')).toHaveFocus();

    requestAnimationFrameSpy.mockRestore();
  });

  it('hides topic progress note markers behind the mobile agenda info popover', async () => {
    const user = userEvent.setup();

    const { container } = render(<App />);

    await user.type(screen.getByPlaceholderText(/Capture agnda notes/i), 'Popover note{enter}');
    expect(container.querySelectorAll('.topics-panel .topic-card__progress-note')).toHaveLength(1);

    act(() => {
      setViewport(720, 620);
      window.dispatchEvent(new Event('resize'));
    });

    await user.click(screen.getByRole('button', { name: 'Exit mini mode' }));
    expect(screen.getByRole('list', { name: 'Agenda topics' })).toBeInTheDocument();
    expect(container.querySelectorAll('.topics-panel .topic-card__progress-note')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Show agenda info' }));

    expect(screen.getByRole('dialog', { name: 'Agenda info' })).toBeInTheDocument();
    expect(container.querySelectorAll('.topics-panel .topic-card__progress-note')).toHaveLength(0);
  });

  it('edits and deletes notes with icon controls', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.type(screen.getByPlaceholderText(/Capture agnda notes/i), 'First note{enter}');
    expect(screen.getByText('0:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit note 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit note 1' }));
    const noteInput = screen.getByDisplayValue('First note');
    await user.clear(noteInput);
    await user.type(noteInput, 'Updated note{enter}');

    expect(screen.getAllByText('Updated note')).toHaveLength(2);
    expect(screen.queryByDisplayValue('First note')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete note 1' }));
    expect(screen.queryByText('Updated note')).not.toBeInTheDocument();
  });

  it('renders URLs in notes as clickable links', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.type(
      screen.getByPlaceholderText(/Capture agnda notes/i),
      'Docs https://example.com/path?q=1{enter}',
    );

    const link = screen.getByRole('link', { name: 'https://example.com/path?q=1' });
    expect(link).toHaveAttribute('href', 'https://example.com/path?q=1');
  });

  it('tallies agenda action items on the left grouped by topic order', async () => {
    const user = userEvent.setup();

    render(<App />);

    const noteInput = screen.getByPlaceholderText(/Capture agnda notes/i);

    await user.click(noteInput);
    await user.paste('- [ ] Opening follow-up');
    await user.keyboard('{Enter}');
    await user.click(screen.getByText('Main Topic').closest('button'));
    await user.click(screen.getByPlaceholderText(/Capture agnda notes/i));
    await user.paste('- [x] Main decision');
    await user.keyboard('{Enter}');

    const actionRegion = screen.getByRole('region', { name: 'Agenda action items' });

    expect(within(actionRegion).getByText('1 open / 1 done')).toBeInTheDocument();
    expect(within(actionRegion).queryByText('Opening')).not.toBeInTheDocument();
    expect(actionRegion).not.toHaveClass('is-expanded');

    await user.click(within(actionRegion).getByRole('button', { name: 'Expand action items' }));

    expect(actionRegion).toHaveClass('is-expanded');
    expect(within(actionRegion).getByText('Opening')).toBeInTheDocument();
    expect(within(actionRegion).getByText('Main Topic')).toBeInTheDocument();

    const topicButtons = within(actionRegion).getAllByRole('button');
    expect(topicButtons.map((button) => button.textContent)).toEqual([
      '',
      'Opening',
      'Main Topic',
    ]);

    const groupedCheckboxes = within(actionRegion).getAllByRole('checkbox');
    expect(groupedCheckboxes).toHaveLength(2);
    expect(groupedCheckboxes[0]).not.toBeChecked();
    expect(groupedCheckboxes[1]).toBeChecked();
  });

  it('creates a new blank agnda from the drawer', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open saved agendas' }));
    await user.click(screen.getByRole('button', { name: 'Create new agnda' }));

    const dialog = screen.getByRole('dialog', { name: 'Agenda info' });
    expect(within(dialog).getByDisplayValue('New Agnda')).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText('Add a topic')).toHaveFocus();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Select a topic' })).toBeInTheDocument();
  });

  it('keeps other saved agndas when switching between them from the drawer', async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      'agnda:agenda:alpha',
      JSON.stringify({
        schemaVersion: 3,
        agendaId: 'alpha',
        title: 'Alpha',
        topics: [{ id: 'alpha-topic', name: 'Alpha topic', seconds: 300, elapsed: 0, notes: [] }],
        currentIndex: 0,
        selectedTopicId: 'alpha-topic',
        isRunning: false,
        updatedAt: 100,
      }),
    );
    window.localStorage.setItem(
      'agnda:agenda:beta',
      JSON.stringify({
        schemaVersion: 3,
        agendaId: 'beta',
        title: 'Beta',
        topics: [{ id: 'beta-topic', name: 'Beta topic', seconds: 300, elapsed: 0, notes: [] }],
        currentIndex: 0,
        selectedTopicId: 'beta-topic',
        isRunning: false,
        updatedAt: 200,
      }),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open saved agendas' }));
    await user.click(screen.getByRole('button', { name: /Beta topic/i }));
    await user.click(screen.getByRole('button', { name: 'Show agenda info' }));

    expect(screen.getByRole('dialog', { name: 'Agenda info' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Beta')).toBeInTheDocument();
    expect(window.localStorage.getItem('agnda:agenda:alpha')).not.toBeNull();
  });

  it('deletes a saved agnda from the drawer', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    window.localStorage.setItem(
      'agnda:agenda:alpha',
      JSON.stringify({
        schemaVersion: 3,
        agendaId: 'alpha',
        title: 'Alpha',
        topics: [{ id: 'alpha-topic', name: 'Alpha topic', seconds: 300, elapsed: 0, notes: [] }],
        currentIndex: 0,
        selectedTopicId: 'alpha-topic',
        isRunning: false,
        updatedAt: 100,
      }),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open saved agendas' }));
    await act(async () => {
      screen.getByRole('button', { name: 'Delete Alpha' }).click();
    });

    expect(window.localStorage.getItem('agnda:agenda:alpha')).toBeNull();
    expect(screen.queryByText('Alpha topic')).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it('keeps shared agenda hashes stable when opened directly', () => {
    const shareHash = encodeTopicsToHash([createTopicFromMinutes('Design', 5)], 'Design');
    window.history.replaceState(null, '', shareHash);

    render(<App />);

    expect(window.location.hash).toBe(shareHash);
  });

  it('keeps shared agendas with the same title isolated when switching and typing in focus mode', async () => {
    const user = userEvent.setup();
    const alphaTopic = createTopicFromMinutes('Alpha topic', 5, 0, {
      notes: [{ id: 'alpha-note', text: 'Alpha memory', offsetSeconds: 10 }],
    });
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
      window.localStorage,
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
      window.localStorage,
    );

    window.history.replaceState(null, '', alphaHash);

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open saved agendas' }));
    await user.click(screen.getByRole('button', { name: /Beta topic/i }));
    await user.click(screen.getByRole('button', { name: 'Focus mode' }));
    await user.click(screen.getByRole('button', { name: /^Add note to /i }));
    await user.type(screen.getByPlaceholderText('Capture a focus note'), 'x');

    expect(screen.getByRole('heading', { name: 'Beta topic' })).toBeInTheDocument();
    expect(screen.queryByText('Alpha memory')).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(betaHash)).topics[0].notes).toEqual([]);
  });
});
