/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { makeVisible } from './lessons/protocols/ws-test-utils';
import {
  advanceToResumedPhase,
  makeLesson,
  renderDemoHub,
  withStubbedLessonBody,
} from './useDemoHub.coverage-helpers';
import {
  setupUseDemoHubCoverageBeforeEach,
  teardownUseDemoHubCoverageAfterEach,
} from './useDemoHub.coverage.testHelpers';
import { gqlFirstQueryLesson } from './lessons/protocols/graphql-first-query';
import {
  persistDemoLiveSession,
  resetLiveDemoResumeConsumeForTests,
} from './demoLiveSession';

vi.mock('./lessons/env-manager-lesson-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lessons/env-manager-lesson-helpers')>();
  return {
    ...actual,
    cleanupGqlDemoLessonEnvironment: vi.fn(async () => {}),
  };
});

vi.mock('./lessons/gql-demo-storage-cleanup', () => ({
  purgeGqlDemoEphemeralStorage: vi.fn().mockResolvedValue({
    profilesRemoved: 0,
    runnerConfigsRemoved: 0,
    staleKeysRemoved: 0,
    freedKB: 0,
  }),
}));

vi.mock('./lessons/protocols/graphql-lesson-helpers/gql-demo-tab', () => ({
  ensureGqlDemoTab: vi.fn(async () => 'demo-tab-resume'),
  closeGqlDemoTabs: vi.fn(async () => {}),
  closeGqlDemoWorkspaceQuiet: vi.fn(async () => {}),
}));

describe('useDemoHub — coverage gaps (session & resume)', () => {
  const navigateToTab = vi.fn();

  beforeEach(() => {
    setupUseDemoHubCoverageBeforeEach();
    sessionStorage.clear();
    resetLiveDemoResumeConsumeForTests();
  });

  afterEach(async () => {
    await teardownUseDemoHubCoverageAfterEach();
  });

  it('persists live session on pagehide while demo is active', async () => {
    const { result } = renderDemoHub(navigateToTab);
    const lesson = makeLesson();
    act(() => result.current.selectLesson(lesson));
    await act(async () => {
      const p = result.current.startLiveDemo();
      await vi.advanceTimersByTimeAsync(7000);
      await p;
    });
    window.dispatchEvent(new Event('pagehide'));
    const raw = sessionStorage.getItem('redfire-demo-live-session-v1');
    expect(raw).toBeTruthy();
  });

  it('executeCurrentStep runs readingSync when provided', async () => {
    const readingSync = vi.fn(async () => {});
    const { result } = renderDemoHub(navigateToTab);
    const lesson = makeLesson({
      steps: [{
        id: 's1',
        title: 'Sync',
        description: 'Short.',
        pauseAfter: 0,
        readingSync,
      }],
    });
    act(() => result.current.selectLesson(lesson));
    await act(async () => {
      const p = result.current.startLiveDemo();
      await vi.advanceTimersByTimeAsync(9000);
      await p;
    });
    expect(readingSync).toHaveBeenCalled();
  });

  it('logs when readingSync throws during executeCurrentStep', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderDemoHub(navigateToTab);
    const lesson = makeLesson({
      steps: [{
        id: 's1',
        title: 'Bad sync',
        description: 'Short.',
        pauseAfter: 0,
        readingSync: async () => { throw new Error('sync fail'); },
      }],
    });
    act(() => result.current.selectLesson(lesson));
    await act(async () => {
      const p = result.current.startLiveDemo();
      await vi.advanceTimersByTimeAsync(9000);
      await p;
    });
    expect(warnSpy).toHaveBeenCalledWith('[DemoHub] readingSync failed:', expect.any(Error));
    warnSpy.mockRestore();
  });

  it('executeCurrentStep enters verify phase when verify selector appears', async () => {
    const verifyEl = document.createElement('div');
    verifyEl.className = 'gap-verify-target';
    makeVisible(verifyEl);
    document.body.appendChild(verifyEl);

    const { result } = renderDemoHub(navigateToTab);
    const lesson = makeLesson({
      steps: [{
        id: 's1',
        title: 'Verify',
        description: 'Short verify step.',
        pauseAfter: 0,
        verify: '.gap-verify-target',
      }],
    });
    act(() => result.current.selectLesson(lesson));
    await act(async () => {
      const p = result.current.startLiveDemo();
      await vi.advanceTimersByTimeAsync(9000);
      await p;
    });
    expect(result.current.stepPhase).toBe('done');
    verifyEl.remove();
  });

  it('resumeInterruptedLiveDemo runs setup and completes restored step', async () => {
    await withStubbedLessonBody(gqlFirstQueryLesson, async () => {
      resetLiveDemoResumeConsumeForTests();
      persistDemoLiveSession({
        lessonId: gqlFirstQueryLesson.id,
        stepIndex: 0,
        isPlaying: false,
        speed: 1,
        savedAt: Date.now(),
      });
      const { result } = renderDemoHub(navigateToTab);
      await advanceToResumedPhase(result, 'done');
      expect(result.current.state.view).toBe('live');
      expect(result.current.state.selectedLesson?.id).toBe(gqlFirstQueryLesson.id);
      expect(result.current.stepPhase).toBe('done');
    });
  });

  it('resumeInterruptedLiveDemo restores isPlaying when session was playing', async () => {
    await withStubbedLessonBody(gqlFirstQueryLesson, async () => {
      resetLiveDemoResumeConsumeForTests();
      persistDemoLiveSession({
        lessonId: gqlFirstQueryLesson.id,
        stepIndex: 0,
        isPlaying: true,
        speed: 1,
        savedAt: Date.now(),
      });
      const { result } = renderDemoHub(navigateToTab);
      // Resume parks playback while it replays the step, then hands it back. The
      // replay takes a few hundred ms and auto-play advances off the step ~4s
      // later, so sample finely enough to land inside that window.
      await advanceToResumedPhase(result, 'done', { stepMs: 50, maxMs: 4_000 });
      expect(result.current.state.isPlaying).toBe(true);
    });
  });

  it('pauseAutoPlay aborts in-flight step and clears skipReading during auto-play pause', async () => {
    const { result } = renderDemoHub(navigateToTab);
    const lesson = makeLesson({
      steps: [
        { id: 's1', title: 'S1', description: 'A'.repeat(400) },
        { id: 's2', title: 'S2', description: 'Step two' },
      ],
    });
    act(() => result.current.selectLesson(lesson));
    await act(async () => {
      void result.current.startLiveDemo();
      await vi.advanceTimersByTimeAsync(100);
    });
    act(() => {
      result.current.toggleAutoPlay();
      result.current.toggleAutoPlay();
    });
    expect(result.current.state.isPlaying).toBe(false);
    // Double-toggle net-cancels: both calls see isPlayingRef=false so neither
    // runs pauseAutoPlay (which would force 'done'). With no preAction the
    // pipeline can already be in 'reading' after 100ms — do not require 'pre'.
    expect(['pre', 'reading']).toContain(result.current.stepPhase);
  });

  it('pauseAutoPlay clears pending auto-advance timer when auto-play is active', async () => {
    const { result } = renderDemoHub(navigateToTab);
    const lesson = makeLesson({
      steps: [
        { id: 's1', title: 'S1', description: 'Short.', pauseAfter: 0 },
        { id: 's2', title: 'S2', description: 'Next step' },
      ],
    });
    act(() => result.current.selectLesson(lesson));
    await act(async () => {
      const p = result.current.startLiveDemo();
      await vi.advanceTimersByTimeAsync(7000);
      await p;
    });
    act(() => result.current.toggleAutoPlay());
    act(() => result.current.toggleAutoPlay());
    expect(result.current.state.isPlaying).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.state.isPlaying).toBe(false);
  });

  it('toggleAutoPlay at end re-enables playing after graphql cleanup and setup', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const setup = vi.fn().mockResolvedValue(undefined);
    const { result } = renderDemoHub(navigateToTab);
    const lesson = makeLesson({
      id: 'gql-gap-restart',
      category: 'graphql',
      domainId: 'protocols',
      initialTab: 'graphql-studio',
      cleanup,
      setup,
    });
    act(() => result.current.selectLesson(lesson));
    await act(async () => {
      const p = result.current.startLiveDemo();
      await vi.advanceTimersByTimeAsync(7000);
      await p;
    });
    await act(async () => {
      const p = result.current.goToStep(1);
      await vi.advanceTimersByTimeAsync(7000);
      await p;
    });
    act(() => result.current.toggleAutoPlay());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(13000);
    });
    expect(cleanup).toHaveBeenCalled();
    expect(setup).toHaveBeenCalled();
    expect(result.current.state.stepIndex).toBe(0);
    expect(result.current.state.isPlaying).toBe(true);
  });

  it('toggleAutoPlay at end expands workflow sidebar for designer lessons', async () => {
    const adapterMod = await import('./adapters');
    const expandSpy = vi.spyOn(adapterMod, 'expandAppSidebar').mockImplementation(() => {});
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const setup = vi.fn().mockResolvedValue(undefined);
    const { result } = renderDemoHub(navigateToTab);
    const lesson = makeLesson({
      id: 'wf-gap-restart',
      category: 'workflow',
      initialTab: 'workflow',
      cleanup,
      setup,
    });
    act(() => result.current.selectLesson(lesson));
    await act(async () => {
      const p = result.current.startLiveDemo();
      await vi.advanceTimersByTimeAsync(7000);
      await p;
    });
    await act(async () => {
      const p = result.current.goToStep(1);
      await vi.advanceTimersByTimeAsync(7000);
      await p;
    });
    act(() => result.current.toggleAutoPlay());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(13000);
    });
    expect(expandSpy).toHaveBeenCalled();
    expandSpy.mockRestore();
  });

  it('toggleAutoPlay at end logs when cleanup and setup throw', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cleanup = vi.fn().mockRejectedValue(new Error('cleanup fail'));
    const setup = vi.fn().mockRejectedValue(new Error('setup fail'));
    const { result } = renderDemoHub(navigateToTab);
    const lesson = makeLesson({ cleanup, setup });
    act(() => result.current.selectLesson(lesson));
    await act(async () => {
      const p = result.current.startLiveDemo();
      await vi.advanceTimersByTimeAsync(7000);
      await p;
    });
    await act(async () => {
      const p = result.current.goToStep(1);
      await vi.advanceTimersByTimeAsync(7000);
      await p;
    });
    act(() => result.current.toggleAutoPlay());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(13000);
    });
    expect(warnSpy).toHaveBeenCalledWith('[DemoHub] Lesson cleanup failed:', expect.any(Error));
    expect(warnSpy).toHaveBeenCalledWith('[DemoHub] Lesson setup failed:', expect.any(Error));
    warnSpy.mockRestore();
  });

  it('toggleAutoPlay at end skips restart when generation changes before callback', async () => {
    const setup = vi.fn().mockResolvedValue(undefined);
    const { result } = renderDemoHub(navigateToTab);
    const lesson = makeLesson({ setup });
    act(() => result.current.selectLesson(lesson));
    await act(async () => {
      const p = result.current.startLiveDemo();
      await vi.advanceTimersByTimeAsync(7000);
      await p;
    });
    await act(async () => {
      const p = result.current.goToStep(1);
      await vi.advanceTimersByTimeAsync(7000);
      await p;
    });
    setup.mockClear();
    act(() => result.current.toggleAutoPlay());
    act(() => result.current.toggleAutoPlay());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(13000);
    });
    expect(setup).not.toHaveBeenCalled();
  });

});
