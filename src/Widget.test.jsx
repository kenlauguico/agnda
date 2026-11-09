import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Widget from './Widget';
import { buildInitialState, loadInitialState, saveState } from './lib/storage';
import { createTopicFromMinutes } from './lib/topics';

function openWidget(agendaId = 'weekly-sync') {
  window.history.replaceState(null, '', `/?embed=1&agenda=${agendaId}`);
}

beforeEach(() => {
  window.localStorage.clear();
  openWidget();
});

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('inline widget', () => {
  it('shows a clear AGNDA fallback when the saved agenda is absent', () => {
    render(<Widget />);
    expect(screen.getByText('This saved agenda is not available in this browser.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open agenda in AGNDA/ })).toHaveAttribute('href', `${window.location.origin}/#weekly-sync`);
  });

  it('opens a note preview, expands the composer, and saves metadata to v3 storage', () => {
    const topic = createTopicFromMinutes('Planning', 5, 30, {
      notes: [{ id: 'existing-note', text: 'Prior decision', offsetSeconds: 20 }],
    });
    saveState(buildInitialState([topic], { agendaId: 'weekly-sync', title: 'Weekly Sync' }), window.localStorage);
    render(<Widget />);

    expect(screen.getByText('04:30')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview note 1 at 0:20' }));
    expect(screen.getByText('Prior decision')).toBeInTheDocument();
    fireEvent.focus(screen.getByPlaceholderText('Write a note…'));
    const composer = screen.getByRole('textbox', { name: 'Write a note for Planning' });
    fireEvent.change(composer, { target: { value: 'Capture from widget' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));

    const saved = loadInitialState(window.localStorage, '#weekly-sync');
    const note = saved.topics[0].notes.at(-1);
    expect(note).toMatchObject({
      text: 'Capture from widget',
      agendaId: 'weekly-sync',
      topicId: topic.id,
      offsetSeconds: 30,
    });
    expect(new Date(note.capturedAt).toISOString()).toBe(note.capturedAt);
    expect(note.timeZone).toBeTruthy();
  });

  it('adjusts duration from the handle without altering elapsed time', () => {
    const topic = createTopicFromMinutes('Planning', 5, 95);
    saveState(buildInitialState([topic], { agendaId: 'weekly-sync' }), window.localStorage);
    render(<Widget />);
    const slider = screen.getByRole('slider', { name: 'Adjust Planning total duration' });
    fireEvent.change(slider, { target: { value: '420' } });
    fireEvent.pointerUp(slider, { target: { value: '420' } });
    const saved = loadInitialState(window.localStorage, '#weekly-sync');
    expect(saved.topics[0].seconds).toBe(420);
    expect(saved.topics[0].elapsed).toBe(95);
  });

  it('cycles capture, time, and progress views with Option-click', () => {
    const topic = createTopicFromMinutes('Planning', 5);
    saveState(buildInitialState([topic], { agendaId: 'weekly-sync' }), window.localStorage);
    render(<Widget />);
    const widget = screen.getByRole('main');
    expect(screen.getByPlaceholderText('Write a note…')).toBeInTheDocument();
    fireEvent.click(widget, { altKey: true });
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    fireEvent.click(widget, { altKey: true });
    expect(screen.getByRole('slider')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Write a note…')).not.toBeInTheDocument();
    fireEvent.click(widget, { altKey: true });
    expect(screen.getByPlaceholderText('Write a note…')).toBeInTheDocument();
  });
});
