/** Demo Hub — full-panel tab content */
import DemoHubHeader from './DemoHubHeader';
import DomainSelector from './DomainSelector';
import LessonList from './LessonList';
import LessonPlayer from './LessonPlayer';
import StaleStackPrompt from './components/StaleStackPrompt';
import DockerImagePrefetchModal from './components/DockerImagePrefetchModal';
import { allDomains } from './lessons/index';
import type { useDemoHub } from './useDemoHub';

type HubActions = ReturnType<typeof useDemoHub>;

interface DemoHubProps {
  hub: HubActions;
}

export default function DemoHub({ hub }: DemoHubProps) {
  const { state, progress } = hub;

  return (
    <div className="demo-hub">
      <DemoHubHeader
        view={state.view}
        domain={state.selectedDomain}
        lesson={state.selectedLesson}
        onBack={hub.goBack}
        onBackToDomains={hub.goToDomains}
      />
      <div className="demo-hub-body">
        <DockerImagePrefetchModal />
        <StaleStackPrompt />
        {state.view === 'domains' && (
          <DomainSelector
            domains={allDomains}
            progress={progress}
            onSelect={hub.selectDomain}
          />
        )}
        {state.view === 'lessons' && state.selectedDomain && (
          <LessonList
            domain={state.selectedDomain}
            progress={progress}
            onSelect={hub.selectLesson}
            onBack={hub.goBack}
            onResetLesson={hub.resetLesson}
            onResetAll={hub.resetLessons}
            initialCategory={progress.lastCategory ?? state.selectedLesson?.category}
            onCategoryChange={hub.setLastCategory}
          />
        )}
        {/* Concept while reading Concept. Also keep it painted if Start has
            flipped view→live but the app tab has not left Demo Hub yet —
            otherwise the body is an empty blue hole during Preparing. */}
        {(state.view === 'concept' || (state.view === 'live' && hub.isDemoBootstrapping)) && state.selectedLesson && (
          <LessonPlayer
            lesson={state.selectedLesson}
            onStartDemo={hub.startLiveDemo}
            newStepsFrom={
              progress.completedLessons.includes(state.selectedLesson.id)
              && (state.selectedLesson.contentVersion ?? 1) > (progress.completedVersions?.[state.selectedLesson.id] ?? 1)
                ? progress.completedStepCounts?.[state.selectedLesson.id] ?? state.selectedLesson.previousStepCount
                : undefined
            }
          />
        )}
        {state.view === 'live' && state.selectedLesson && !hub.isDemoBootstrapping && (
          <div className="demo-hub-live-placeholder" data-testid="demo-hub-live-placeholder">
            <p className="demo-hub-live-placeholder-title">Live demo in progress</p>
            <p className="demo-hub-live-placeholder-desc">
              Follow the floating guide panel on the lesson tab, or press <kbd>Esc</kbd> to exit.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
