import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '#');
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('keeps the session running when adding a topic', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Start session' }));
    expect(screen.getByRole('button', { name: 'Pause session' })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Add a topic'), 'Follow-up');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByRole('button', { name: 'Pause session' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByDisplayValue('Opening')).toBeInTheDocument();
  });

  it('accepts loose custom duration input for the selected topic', async () => {
    const user = userEvent.setup();

    render(<App />);

    const durationInput = screen.getByPlaceholderText('1:30 or 1m 30s');
    await user.clear(durationInput);
    await user.type(durationInput, '1m 30s{enter}');

    expect(screen.getByRole('combobox', { name: 'Topic duration' })).toHaveValue('90');
    expect(durationInput).toHaveValue('1m 30s');
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

    await user.click(within(actionRegion).getByRole('button', { name: 'Expand action items' }));

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

    expect(screen.getByDisplayValue('New Agnda')).toBeInTheDocument();
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
});
