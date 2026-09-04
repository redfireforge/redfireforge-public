/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import LessonPlayer from './LessonPlayer';
import { LessonNotesProvider } from './LessonNotesContext';
import type { DemoLesson } from './types';

// ── Module-level mock for PrerequisiteGate so we can fire callbacks in tests ──
let capturedPrereqProps: {
  onServerReady: () => void;
  onServerLost?: () => void;
  onProbeStatusChange?: (down: string[]) => void;
} | null = null;

vi.mock('./components/PrerequisiteGate', () => ({
  default: (props: {
    onServerReady: () => void;
    onServerLost?: () => void;
    onProbeStatusChange?: (down: string[]) => void;
    dockerCommand: string;
  }) => {
    capturedPrereqProps = props;
    return (
      <div data-testid="prereq-gate-mock">
        {'⏳ Waiting for local services…'}
      </div>
    ) as unknown as null;
  },
}));

function makeLesson(overrides: Partial<DemoLesson> = {}): DemoLesson {
  return {
    id: 'lesson-player-gap',
    domainId: 'protocols',
    name: 'Player Gap Lesson',
    description: 'desc',
    estimatedMinutes: 3,
    concept: { title: 'Concept', body: 'Body text' },
    steps: [
      { id: 's1', title: 'Step One', description: 'First step', diagram: '<svg></svg>' },
      { id: 's2', title: 'Step Two', description: 'Second step' },
    ],
    ...overrides,
  };
}

describe('LessonPlayer — coverage gaps', () => {
  const wrap = (ui: React.ReactNode) => render(<LessonNotesProvider>{ui}</LessonNotesProvider>);

  beforeEach(() => {
    capturedPrereqProps = null;
    sessionStorage.clear();
  });

  it('renders notes editor and saves through context', () => {
    wrap(<LessonPlayer lesson={makeLesson()} onStartDemo={vi.fn()} />);
    fireEvent.click(screen.getByTestId('demo-lesson-sidebar-notes'));
    const textarea = screen.getByTestId('demo-lesson-notes-textarea');
    fireEvent.change(textarea, { target: { value: 'my note' } });
    fireEvent.click(screen.getByTestId('demo-lesson-notes-save-btn'));
    expect(screen.getByTestId('demo-lesson-sidebar-notes')).toBeTruthy();
  });

  it('shows desktop-only gate and disables start for desktop-only lessons on web', async () => {
    const platform = await import('./utils/lessonPlatform');
    vi.spyOn(platform, 'isLessonDesktopOnlyBlocked').mockReturnValue(true);
    wrap(<LessonPlayer lesson={makeLesson({ desktopOnly: true })} onStartDemo={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Desktop app required/i })).toHaveProperty('disabled', true);
  });

  it('shows docker-backend DesktopOnlyGate with Docker install link on hosted web', async () => {
    const platform = await import('./utils/lessonPlatform');
    vi.spyOn(platform, 'isDockerLessonBlockedOnWeb').mockReturnValue(true);
    wrap(
      <LessonPlayer
        lesson={makeLesson({ dockerEndpoint: 'http://localhost:4010/graphql' })}
        onStartDemo={vi.fn()}
      />,
    );
    expect(screen.getByTestId('desktop-only-gate-note').textContent).toMatch(/Docker Desktop/i);
    expect(screen.getByTestId('desktop-only-gate-docker-hint')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Desktop app required/i })).toHaveProperty('disabled', true);
  });

  it('navigates step detail prev/next and shows diagram', () => {
    wrap(<LessonPlayer lesson={makeLesson()} onStartDemo={vi.fn()} />);
    fireEvent.click(screen.getByText('Step One'));
    expect(screen.getByText('Step 1')).toBeTruthy();
    expect(document.querySelector('.demo-step-diagram')).toBeTruthy();
    fireEvent.click(screen.getByText('Next →'));
    expect(screen.getByText('Step 2')).toBeTruthy();
    fireEvent.click(screen.getByText('← Prev'));
    expect(screen.getByText('Step 1')).toBeTruthy();
  });

  it('clicking the Concept sidebar nav button navigates back to concept view', () => {
    wrap(<LessonPlayer lesson={makeLesson()} onStartDemo={vi.fn()} />);
    // Navigate away to a step first
    fireEvent.click(screen.getByText('Step One'));
    expect(screen.getByText('Step 1')).toBeTruthy();
    // Click the "Concept" sidebar nav button to return
    fireEvent.click(screen.getByTestId('demo-lesson-sidebar-concept'));
    // Step detail should be gone
    expect(screen.queryByText('Step 1')).toBeNull();
  });

  it('closes notes editor via onClose and returns to concept', () => {
    wrap(<LessonPlayer lesson={makeLesson()} onStartDemo={vi.fn()} />);
    // Open notes
    fireEvent.click(screen.getByTestId('demo-lesson-sidebar-notes'));
    expect(screen.getByTestId('demo-lesson-notes-textarea')).toBeTruthy();
    // Close via the close button in the notes editor
    fireEvent.click(screen.getByTestId('demo-lesson-notes-close-btn'));
    // Should be back on concept (ConceptSlide title shows)
    expect(screen.queryByTestId('demo-lesson-notes-textarea')).toBeNull();
  });

  it('shows docker waiting label via mocked PrerequisiteGate (Tauri/localhost)', async () => {
    const platform = await import('./utils/lessonPlatform');
    vi.spyOn(platform, 'isLessonDesktopOnlyBlocked').mockReturnValue(false);
    vi.spyOn(platform, 'isDockerLessonBlockedOnWeb').mockReturnValue(false);
    wrap(
      <LessonPlayer
        lesson={makeLesson({ dockerEndpoint: 'http://localhost:4010/health' })}
        onStartDemo={vi.fn()}
      />,
    );
    expect(screen.getByTestId('prereq-gate-mock')).toBeTruthy();
    expect(screen.getAllByText(/Waiting for/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Waiting for/i })).toHaveProperty('disabled', true);
  });

  it('handleServerReady clears the docker gate and enables Start Demo', async () => {
    const platform = await import('./utils/lessonPlatform');
    vi.spyOn(platform, 'isLessonDesktopOnlyBlocked').mockReturnValue(false);
    vi.spyOn(platform, 'isDockerLessonBlockedOnWeb').mockReturnValue(false);
    wrap(
      <LessonPlayer
        lesson={makeLesson({ dockerEndpoint: 'http://localhost:4010/health' })}
        onStartDemo={vi.fn()}
      />,
    );
    expect(capturedPrereqProps).not.toBeNull();
    // Fire onServerReady — should clear the docker gate
    act(() => { capturedPrereqProps!.onServerReady(); });
    const startBtn = screen.getByRole('button', { name: /Start Demo/i });
    expect(startBtn).not.toBeDisabled();
    act(() => { capturedPrereqProps!.onServerLost?.(); });
    expect(screen.getByRole('button', { name: /Waiting for/i })).toHaveProperty('disabled', true);
  });

  it('keeps the docker gate mounted on a step so Start Demo can lock again', async () => {
    const platform = await import('./utils/lessonPlatform');
    vi.spyOn(platform, 'isLessonDesktopOnlyBlocked').mockReturnValue(false);
    vi.spyOn(platform, 'isDockerLessonBlockedOnWeb').mockReturnValue(false);
    wrap(
      <LessonPlayer
        lesson={makeLesson({ dockerEndpoint: 'http://localhost:4010/health' })}
        onStartDemo={vi.fn()}
      />,
    );
    act(() => { capturedPrereqProps!.onServerReady(); });
    expect(screen.getByRole('button', { name: /Start Demo/i })).not.toBeDisabled();
    fireEvent.click(screen.getByText('Step One'));
    expect(screen.getByTestId('prereq-gate-mock')).toBeTruthy();
    expect(screen.getByTestId('demo-lesson-prereq-wrap')).toHaveAttribute('hidden');
    act(() => { capturedPrereqProps!.onServerLost?.(); });
    expect(screen.getByRole('button', { name: /Waiting for/i })).toHaveProperty('disabled', true);
  });

  it('handleProbeStatus updates down service labels in the waiting button', async () => {
    const platform = await import('./utils/lessonPlatform');
    vi.spyOn(platform, 'isLessonDesktopOnlyBlocked').mockReturnValue(false);
    vi.spyOn(platform, 'isDockerLessonBlockedOnWeb').mockReturnValue(false);
    wrap(
      <LessonPlayer
        lesson={makeLesson({ dockerEndpoint: 'http://localhost:4010/health' })}
        onStartDemo={vi.fn()}
      />,
    );
    expect(capturedPrereqProps).not.toBeNull();
    // Fire onProbeStatusChange with a down label
    act(() => { capturedPrereqProps!.onProbeStatusChange?.(['GraphQL server']); });
    expect(screen.getByRole('button', { name: /Waiting for GraphQL server/i })).toHaveProperty('disabled', true);
    // Fire again with same values — state updater should return prev (no-op branch)
    act(() => { capturedPrereqProps!.onProbeStatusChange?.(['GraphQL server']); });
    // Fire with empty array — all services up
    act(() => { capturedPrereqProps!.onProbeStatusChange?.([]); });
    expect(screen.getByRole('button', { name: /Waiting for local services/i })).toHaveProperty('disabled', true);
  });

  it('shows desktop-only gate for docker lesson on hosted web and disables start', async () => {
    const platform = await import('./utils/lessonPlatform');
    vi.spyOn(platform, 'isLessonDesktopOnlyBlocked').mockReturnValue(false);
    vi.spyOn(platform, 'isDockerLessonBlockedOnWeb').mockReturnValue(true);
    wrap(
      <LessonPlayer
        lesson={makeLesson({ dockerEndpoint: 'http://localhost:4010/health' })}
        onStartDemo={vi.fn()}
      />,
    );
    expect(screen.getByTestId('desktop-only-gate')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Desktop app required/i })).toHaveProperty('disabled', true);
  });

  it('shows New badge on steps at or after newStepsFrom', () => {
    wrap(<LessonPlayer lesson={makeLesson()} onStartDemo={vi.fn()} newStepsFrom={1} />);
    // Step 1 (index 0) should NOT have New badge
    const step1Btn = screen.getByText('Step One').closest('button');
    expect(step1Btn?.querySelector('.demo-sidebar-new-badge')).toBeNull();
    // Step 2 (index 1) SHOULD have New badge
    const step2Btn = screen.getByText('Step Two').closest('button');
    expect(step2Btn?.querySelector('.demo-sidebar-new-badge')).toBeTruthy();
  });
});
