/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import {screen, fireEvent } from '@testing-library/react';
import LessonList from './LessonList';
import { LessonNotesProvider } from './LessonNotesContext';
import type { DemoProgress } from './types';
import {
  baseProgress,
  makeLesson,
  makeDomain,
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

describe('LessonList', () => {
  const defaultResetProps = {
    onResetLesson: vi.fn(),
    onResetAll: vi.fn(),
  };

  it('renders lesson items', () => {
    renderWithLessonNotes(
      <LessonList
        domain={makeDomain()}
        progress={baseProgress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    expect(screen.getByText('Lesson 1')).toBeTruthy();
    expect(screen.getByText('Start')).toBeTruthy();
  });

  it('shows completed status', () => {
    const progress: DemoProgress = { ...baseProgress, completedLessons: ['l1'] };
    renderWithLessonNotes(
      <LessonList
        domain={makeDomain()}
        progress={progress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    expect(screen.getByText('✓')).toBeTruthy();
    expect(screen.getByText('Restart')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('shows in-progress indicator for lessons with step progress', () => {
    const progress: DemoProgress = { ...baseProgress, lessonSteps: { l1: 0 } };
    renderWithLessonNotes(
      <LessonList
        domain={makeDomain()}
        progress={progress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    expect(screen.getByLabelText('In progress')).toBeTruthy();
  });

  it('shows Resume badge for in-progress lessons', () => {
    const progress: DemoProgress = { ...baseProgress, lessonSteps: { l1: 2 } };
    renderWithLessonNotes(
      <LessonList
        domain={makeDomain()}
        progress={progress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    expect(screen.getByText('Resume')).toBeTruthy();
  });

  it('shows Desktop only badge instead of Start/Resume for desktop-only lessons on web', () => {
    const domain = makeDomain({
      lessons: [makeLesson({ id: 'desktop-lesson', desktopOnly: true })],
    });
    const progress: DemoProgress = { ...baseProgress, lessonSteps: { 'desktop-lesson': 1 } };
    renderWithLessonNotes(
      <LessonList
        domain={domain}
        progress={progress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    expect(screen.getByText('Desktop only')).toBeTruthy();
    expect(screen.queryByText('Resume')).toBeNull();
    expect(screen.queryByText('Start')).toBeNull();
  });

  it('calls onSelect when lesson clicked', () => {
    const onSelect = vi.fn();
    renderWithLessonNotes(
      <LessonList
        domain={makeDomain()}
        progress={baseProgress}
        onSelect={onSelect}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    fireEvent.click(screen.getByText('Lesson 1'));
    expect(onSelect).toHaveBeenCalled();
  });

  it('calls onBack when back button clicked', () => {
    const onBack = vi.fn();
    renderWithLessonNotes(
      <LessonList
        domain={makeDomain()}
        progress={baseProgress}
        onSelect={vi.fn()}
        onBack={onBack}
        {...defaultResetProps}
      />,
    );
    fireEvent.click(screen.getByText('← Back to all domains'));
    expect(onBack).toHaveBeenCalled();
  });

  it('renders category tabs when domain has categories', () => {
    const domain = makeDomain({
      categories: [
        { id: 'basics', label: 'Basics', icon: '📚' },
        { id: 'advanced', label: 'Advanced', icon: '🚀' },
      ],
      lessons: [makeLesson({ category: 'basics' })],
    });
    renderWithLessonNotes(
      <LessonList
        domain={domain}
        progress={baseProgress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    expect(screen.getByText('Basics')).toBeTruthy();
    expect(screen.getByText('Advanced')).toBeTruthy();
  });

  it('shows per-lesson reset button for completed lessons', () => {
    const progress: DemoProgress = { ...baseProgress, completedLessons: ['l1'] };
    renderWithLessonNotes(
      <LessonList
        domain={makeDomain()}
        progress={progress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    expect(screen.getByTestId('reset-lesson-l1')).toBeTruthy();
  });

  it('shows inline confirm when reset lesson button clicked', () => {
    const progress: DemoProgress = { ...baseProgress, completedLessons: ['l1'] };
    renderWithLessonNotes(
      <LessonList
        domain={makeDomain()}
        progress={progress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    fireEvent.click(screen.getByTestId('reset-lesson-l1'));
    expect(screen.getByTestId('reset-confirm-l1')).toBeTruthy();
    expect(screen.getByText('Reset progress?')).toBeTruthy();
  });

  it('calls onResetLesson when confirmed', () => {
    const onResetLesson = vi.fn();
    const progress: DemoProgress = { ...baseProgress, completedLessons: ['l1'] };
    renderWithLessonNotes(
      <LessonList
        domain={makeDomain()}
        progress={progress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        onResetLesson={onResetLesson}
        onResetAll={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('reset-lesson-l1'));
    fireEvent.click(screen.getByText('↺ Yes'));
    expect(onResetLesson).toHaveBeenCalledWith('l1');
  });

  it('dismisses confirm without resetting when ✕ clicked', () => {
    const onResetLesson = vi.fn();
    const progress: DemoProgress = { ...baseProgress, completedLessons: ['l1'] };
    renderWithLessonNotes(
      <LessonList
        domain={makeDomain()}
        progress={progress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        onResetLesson={onResetLesson}
        onResetAll={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('reset-lesson-l1'));
    fireEvent.click(screen.getByLabelText('Cancel reset'));
    expect(onResetLesson).not.toHaveBeenCalled();
    expect(screen.queryByTestId('reset-confirm-l1')).toBeNull();
  });

  it('shows Reset all button only when at least one lesson is completed', () => {
    const { rerender } = renderWithLessonNotes(
      <LessonList
        domain={makeDomain()}
        progress={baseProgress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    expect(screen.queryByTestId('reset-all-btn')).toBeNull();

    const progress: DemoProgress = { ...baseProgress, completedLessons: ['l1'] };
    rerender(
      <LessonNotesProvider>
        <LessonList
          domain={makeDomain()}
          progress={progress}
          onSelect={vi.fn()}
          onBack={vi.fn()}
          {...defaultResetProps}
        />
      </LessonNotesProvider>,
    );
    expect(screen.getByTestId('reset-all-btn')).toBeTruthy();
  });

  it('shows Reset all confirm then calls onResetAll', () => {
    const onResetAll = vi.fn();
    const progress: DemoProgress = { ...baseProgress, completedLessons: ['l1'] };
    renderWithLessonNotes(
      <LessonList
        domain={makeDomain()}
        progress={progress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        onResetLesson={vi.fn()}
        onResetAll={onResetAll}
      />,
    );
    fireEvent.click(screen.getByTestId('reset-all-btn'));
    expect(screen.getByTestId('reset-all-confirm')).toBeTruthy();
    fireEvent.click(screen.getByTestId('reset-all-yes'));
    expect(onResetAll).toHaveBeenCalledWith(['l1']);
  });

  it('cancels Reset all without calling onResetAll', () => {
    const onResetAll = vi.fn();
    const progress: DemoProgress = { ...baseProgress, completedLessons: ['l1'] };
    renderWithLessonNotes(
      <LessonList
        domain={makeDomain()}
        progress={progress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        onResetLesson={vi.fn()}
        onResetAll={onResetAll}
      />,
    );
    fireEvent.click(screen.getByTestId('reset-all-btn'));
    fireEvent.click(screen.getByTestId('reset-all-no'));
    expect(onResetAll).not.toHaveBeenCalled();
    expect(screen.queryByTestId('reset-all-confirm')).toBeNull();
  });

  it('uses initialCategory when navigating back from a lesson', () => {
    const domain = makeDomain({
      categories: [
        { id: 'basics', label: 'Basics', icon: '📚' },
        { id: 'advanced', label: 'Advanced', icon: '🚀' },
      ],
      lessons: [
        makeLesson({ id: 'l1', category: 'basics', name: 'Basics Lesson' }),
        makeLesson({ id: 'l2', category: 'advanced', name: 'Advanced Lesson' }),
      ],
    });
    renderWithLessonNotes(
      <LessonList
        domain={domain}
        progress={baseProgress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        {...defaultResetProps}
        initialCategory="advanced"
      />,
    );
    expect(screen.getByText('Advanced Lesson')).toBeTruthy();
    expect(screen.queryByText('Basics Lesson')).toBeNull();
  });

  it('shows empty category tab as disabled with soon label', () => {
    const domain = makeDomain({
      categories: [
        { id: 'basics', label: 'Basics', icon: '📚' },
        { id: 'advanced', label: 'Advanced', icon: '🚀' },
      ],
      lessons: [makeLesson({ category: 'basics' })],
    });
    renderWithLessonNotes(
      <LessonList
        domain={domain}
        progress={baseProgress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    const advancedTab = screen.getByText('Advanced').closest('button') as HTMLButtonElement;
    expect(advancedTab.disabled).toBe(true);
    expect(screen.getByText('soon')).toBeTruthy();
  });

  it('shows empty-state message when active category has no lessons', () => {
    const domain = makeDomain({
      categories: [{ id: 'basics', label: 'Basics', icon: '📚' }],
      lessons: [],
    });
    renderWithLessonNotes(
      <LessonList
        domain={domain}
        progress={baseProgress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    expect(screen.getByText(/No Basics lessons yet/)).toBeTruthy();
  });

  it('renders lesson tag badge when present', () => {
    renderWithLessonNotes(
      <LessonList
        domain={makeDomain({ lessons: [makeLesson({ tag: '🐳 Docker' })] })}
        progress={baseProgress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    expect(screen.getByText('🐳 Docker')).toBeTruthy();
  });

  it('shows category Docker badge when any lesson requires Docker', () => {
    const domain = makeDomain({
      categories: [
        { id: 'kafka', label: 'Kafka', icon: '📨' },
        { id: 'sse', label: 'SSE', icon: '📡' },
      ],
      lessons: [
        makeLesson({ id: 'k1', category: 'kafka', dockerEndpoint: 'http://localhost:18080' }),
        makeLesson({ id: 's1', category: 'sse', name: 'SSE Studio' }),
      ],
    });
    const { container } = renderWithLessonNotes(
      <LessonList
        domain={domain}
        progress={baseProgress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    expect(container.querySelectorAll('.demo-category-docker-badge')).toHaveLength(1);
    expect(screen.getByLabelText('Kafka lessons require Docker')).toBeTruthy();
  });

  it('blocks lesson select while reset confirmation is open', () => {
    const onSelect = vi.fn();
    const progress: DemoProgress = { ...baseProgress, completedLessons: ['l1'] };
    renderWithLessonNotes(
      <LessonList
        domain={makeDomain()}
        progress={progress}
        onSelect={onSelect}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    fireEvent.click(screen.getByTestId('reset-lesson-l1'));
    fireEvent.click(screen.getByText('Lesson 1'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows all-done badge when every lesson in category is completed', () => {
    const domain = makeDomain({
      categories: [{ id: 'basics', label: 'Basics', icon: '📚' }],
      lessons: [makeLesson({ id: 'l1', category: 'basics' })],
    });
    const progress: DemoProgress = { ...baseProgress, completedLessons: ['l1'] };
    const { container } = renderWithLessonNotes(
      <LessonList
        domain={domain}
        progress={progress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    expect(container.querySelector('.demo-category-count.all-done')).toBeTruthy();
  });

  it('shows reset button for in-progress lessons', () => {
    const progress: DemoProgress = { ...baseProgress, lessonSteps: { l1: 1 } };
    renderWithLessonNotes(
      <LessonList
        domain={makeDomain()}
        progress={progress}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        {...defaultResetProps}
      />,
    );
    expect(screen.getByTestId('reset-lesson-l1')).toBeTruthy();
  });
});
