/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import {screen, fireEvent, act } from '@testing-library/react';
import LessonPlayer from './LessonPlayer';
import {clickLessonPlayerStep,
  makeLesson,
  renderWithLessonNotes,
} from './demo-components.testHelpers';

vi.mock('./utils/checkEndpoint', () => ({
  checkEndpoint: vi.fn().mockResolvedValue(false),
}));

vi.mock('@shared/utils/platform', () => ({
  isTauri: vi.fn(() => false),
  isDesktopRuntimeAvailable: vi.fn(() => false),
  isLocalWebHost: (hostname: string) =>
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost'),
}));

vi.mock('./adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./adapters')>();
  return {
    ...actual,
    countUserTabsInStorage: vi.fn().mockResolvedValue(0),
    userTabsToCloseForLesson: vi.fn(() => 0),
  };
});

describe('LessonPlayer', () => {
  it('renders concept slide and step list', () => {
    renderWithLessonNotes(
      <LessonPlayer
        lesson={makeLesson()}
        onStartDemo={vi.fn()}
      />,
    );
    expect(screen.getByText('Concept Title')).toBeTruthy();
    expect(screen.getByText(/Step 1/)).toBeTruthy();
    expect(screen.getByText(/Step 2/)).toBeTruthy();
  });

  it('does not render speed selector buttons', () => {
    renderWithLessonNotes(
      <LessonPlayer
        lesson={makeLesson()}
        onStartDemo={vi.fn()}
      />,
    );
    expect(screen.queryByText('1x')).toBeNull();
    expect(screen.queryByText('2x')).toBeNull();
  });

  it('calls onStartDemo when Start Demo is clicked', () => {
    const onStart = vi.fn();
    renderWithLessonNotes(
      <LessonPlayer
        lesson={makeLesson()}
        onStartDemo={onStart}
      />,
    );
    fireEvent.click(screen.getByText('Start Demo →'));
    expect(onStart).toHaveBeenCalled();
  });

  it('disables start button when lesson has dockerEndpoint and gate not cleared', () => {
    const onStart = vi.fn();
    renderWithLessonNotes(
      <LessonPlayer
        lesson={makeLesson({ dockerEndpoint: 'ws://localhost:3100/socket.io/?EIO=4' })}
        onStartDemo={onStart}
      />,
    );
    const startBtn = screen.getByText(/Waiting for/);
    expect(startBtn).toBeTruthy();
    expect((startBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(startBtn);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('disables start button for desktop-only lessons on web', () => {
    const onStart = vi.fn();
    renderWithLessonNotes(
      <LessonPlayer
        lesson={makeLesson({ desktopOnly: true })}
        onStartDemo={onStart}
      />,
    );
    const startBtn = screen.getByRole('button', { name: 'Desktop app required' });
    expect(startBtn).toBeTruthy();
    expect((startBtn as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-testid="desktop-only-gate"]')).toBeTruthy();
    fireEvent.click(startBtn);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('renders PrerequisiteGate when dockerEndpoint is set', () => {
    renderWithLessonNotes(
      <LessonPlayer
        lesson={makeLesson({
          dockerEndpoint: 'ws://localhost:3100/test',
          dockerCommand: 'docker compose up test',
        })}
        onStartDemo={vi.fn()}
      />,
    );
    const gateEl = document.querySelector('.prereq-gate');
    expect(gateEl).toBeTruthy();
  });

  it('does not render PrerequisiteGate without dockerEndpoint', () => {
    renderWithLessonNotes(
      <LessonPlayer
        lesson={makeLesson()}
        onStartDemo={vi.fn()}
      />,
    );
    expect(document.querySelector('.prereq-gate')).toBeNull();
  });

  it('clicking a step nav item shows its description in the right panel', () => {
    renderWithLessonNotes(
      <LessonPlayer
        lesson={makeLesson()}
        onStartDemo={vi.fn()}
      />,
    );
    // Default: concept view is active
    expect(document.querySelector('.demo-concept-slide')).toBeTruthy();
    expect(document.querySelector('.demo-step-detail')).toBeNull();

    // Click step 1 in the sidebar
    clickLessonPlayerStep(0);

    // Concept slide should be replaced by step detail
    expect(document.querySelector('.demo-concept-slide')).toBeNull();
    expect(document.querySelector('.demo-step-detail')).toBeTruthy();
    expect(document.querySelector('.demo-step-detail-title')?.textContent).toBe('Step 1');
    expect(document.querySelector('.demo-step-detail-num')?.textContent).toBe('Step 1');

    // Clicking Concept nav item restores concept view
    fireEvent.click(document.querySelectorAll('.demo-sidebar-nav-item')[0]!);
    expect(document.querySelector('.demo-concept-slide')).toBeTruthy();
    expect(document.querySelector('.demo-step-detail')).toBeNull();
  });

  it('renders step diagram when step has diagram field', () => {
    renderWithLessonNotes(
      <LessonPlayer
        lesson={makeLesson({
          steps: [
            {
              id: 's1',
              title: 'Anatomy',
              description: 'See the diagram below.',
              diagram: '<svg data-testid="step-diagram"><circle r="10"/></svg>',
            },
          ],
        })}
        onStartDemo={vi.fn()}
      />,
    );
    clickLessonPlayerStep(0);
    expect(document.querySelector('.demo-step-diagram')).toBeTruthy();
    expect(document.querySelector('[data-testid="step-diagram"]')).toBeTruthy();
  });

  it('footer always shows Start Demo; Prev/Next appear only when viewing a step', () => {
    renderWithLessonNotes(
      <LessonPlayer
        lesson={makeLesson()}
        onStartDemo={vi.fn()}
      />,
    );

    // Concept view → Start Demo present, no step navigation
    expect(screen.queryByText('Start Demo →')).toBeTruthy();
    expect(screen.queryByText(/← Prev/)).toBeNull();
    expect(screen.queryByText(/Next →/)).toBeNull();

    // Step 1 (non-last, non-first) → Start Demo + Next, no Prev
    clickLessonPlayerStep(0);
    expect(screen.queryByText('Start Demo →')).toBeTruthy();
    expect(screen.queryByText(/Next →/)).toBeTruthy();
    expect(screen.queryByText(/← Prev/)).toBeNull();

    // Step 2 (last) → Start Demo + Prev, no Next
    clickLessonPlayerStep(1);
    expect(screen.queryByText('Start Demo →')).toBeTruthy();
    expect(screen.queryByText(/← Prev/)).toBeTruthy();
    expect(screen.queryByText(/Next →/)).toBeNull();
  });

  it('enables start button when docker gate becomes ready', async () => {
    vi.useFakeTimers();
    const { checkEndpoint } = await import('./utils/checkEndpoint');
    (checkEndpoint as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false).mockResolvedValue(true);

    const onStart = vi.fn();
    renderWithLessonNotes(
      <LessonPlayer
        lesson={makeLesson({ dockerEndpoint: 'ws://localhost:3100/test' })}
        onStartDemo={onStart}
      />,
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByText(/Waiting for/)).toBeTruthy();

    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    const startBtn = screen.getByText('Start Demo →');
    expect(startBtn).toBeTruthy();
    expect((startBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(startBtn);
    expect(onStart).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('Prev and Next buttons navigate between steps', () => {
    renderWithLessonNotes(
      <LessonPlayer
        lesson={makeLesson()}
        onStartDemo={vi.fn()}
      />,
    );
    clickLessonPlayerStep(0);
    fireEvent.click(screen.getByText(/Next →/));
    expect(document.querySelector('.demo-step-detail-title')?.textContent).toBe('Step 2');
    fireEvent.click(screen.getByText(/← Prev/));
    expect(document.querySelector('.demo-step-detail-title')?.textContent).toBe('Step 1');
  });

  it('uses default dockerCommand when lesson omits dockerCommand', () => {
    renderWithLessonNotes(
      <LessonPlayer
        lesson={makeLesson({ dockerEndpoint: 'ws://localhost:3100/test' })}
        onStartDemo={vi.fn()}
      />,
    );
    expect(document.querySelector('.prereq-gate')).toBeTruthy();
  });

  it('passes tabBudget to PrerequisiteGate for GraphQL studio lessons', async () => {
    vi.useFakeTimers();
    const { checkEndpoint } = await import('./utils/checkEndpoint');
    (checkEndpoint as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const onStart = vi.fn();
    renderWithLessonNotes(
      <LessonPlayer
        lesson={makeLesson({
          category: 'graphql',
          initialTab: 'graphql-studio',
          tabBudget: 2,
          dockerEndpoint: 'http://localhost:4010/graphql',
        })}
        onStartDemo={onStart}
      />,
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });

    const startBtn = screen.getByText('Start Demo →');
    expect((startBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(startBtn);
    expect(onStart).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
