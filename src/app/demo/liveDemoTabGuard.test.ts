/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { shouldExitDemoForTabChange, isHumanDemoTabExit } from './liveDemoTabGuard';
import { demoHubRuntimeRef } from './demoHubRuntimeRef';
import { beginDemoUiAction, endDemoUiAction } from '@shared/utils/demoUiAction';

const mockDemoEnabled = vi.hoisted(() => ({ value: true }));
vi.mock('../../config/features', () => ({ get DEMO_HUB_ENABLED() { return mockDemoEnabled.value; } }));

describe('shouldExitDemoForTabChange', () => {
  const lesson = {
    initialTab: 'workflow',
    allowedTabs: ['workflow', 'workflow-runner'],
  };

  it('returns false when re-selecting the same tab', () => {
    expect(shouldExitDemoForTabChange('workflow', 'workflow', lesson)).toBe(false);
  });

  it('returns false for the lesson initial tab', () => {
    expect(shouldExitDemoForTabChange('workflow', 'demo-hub', lesson)).toBe(false);
  });

  it('returns false for an allowed lesson tab', () => {
    expect(shouldExitDemoForTabChange('workflow-runner', 'workflow', lesson)).toBe(false);
  });

  it('returns true when leaving to an unrelated tab', () => {
    expect(shouldExitDemoForTabChange('requests', 'workflow', lesson)).toBe(true);
    expect(shouldExitDemoForTabChange('test-runner', 'workflow', lesson)).toBe(true);
  });

  it('returns true when lesson has no tab hints', () => {
    expect(shouldExitDemoForTabChange('requests', 'workflow', null)).toBe(true);
  });
});

describe('isHumanDemoTabExit', () => {
  beforeEach(() => {
    mockDemoEnabled.value = true;
    demoHubRuntimeRef.current = {
      state: {
        view: 'live',
        selectedLesson: { initialTab: 'requests', allowedTabs: ['requests'] },
        stepIndex: 0,
        isPlaying: false,
        speed: 1,
      },
      stepPhase: 'done',
      exitLiveDemo: async () => {},
      nextStep: () => {},
      toggleAutoPlay: () => {},
      skipReading: () => {},
      restartDemo: () => {},
      confirmLessonComplete: () => {},
      suppressLiveTabExitRef: { current: false },
    };
  });

  afterEach(() => {
    document.body.removeAttribute('data-rf-demo-ui-action');
  });

  it('is true for a human click to an unrelated tab', () => {
    expect(isHumanDemoTabExit('workflow', 'requests')).toBe(true);
  });

  it('is false for the lesson initial or allowed tab', () => {
    expect(isHumanDemoTabExit('requests', 'requests')).toBe(false);
    demoHubRuntimeRef.current.state.selectedLesson = {
      initialTab: 'requests',
      allowedTabs: ['requests', 'environments'],
    };
    expect(isHumanDemoTabExit('environments', 'requests')).toBe(false);
  });

  it('is false when demo hub is disabled', () => {
    mockDemoEnabled.value = false;
    expect(isHumanDemoTabExit('workflow', 'requests')).toBe(false);
  });

  it('is false when not in live view', () => {
    demoHubRuntimeRef.current.state.view = 'concept';
    expect(isHumanDemoTabExit('workflow', 'requests')).toBe(false);
  });

  it('is false while a demo ctx.click is in flight', () => {
    beginDemoUiAction();
    try {
      expect(isHumanDemoTabExit('workflow', 'requests')).toBe(false);
    } finally {
      endDemoUiAction();
    }
  });

  it('is false when suppressLiveTabExitRef is set', () => {
    demoHubRuntimeRef.current.suppressLiveTabExitRef = { current: true };
    expect(isHumanDemoTabExit('workflow', 'requests')).toBe(false);
  });
});
