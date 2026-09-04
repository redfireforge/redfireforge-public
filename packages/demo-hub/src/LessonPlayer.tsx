/** Lesson Player — sidebar navigation + right-panel content view */
import { useCallback, useMemo, useState } from 'react';
import type { DemoLesson } from './types';
import ConceptSlide from './ConceptSlide';
import PrerequisiteGate from './components/PrerequisiteGate';
import DesktopOnlyGate from './components/DesktopOnlyGate';
import { renderMarkdown } from './ConceptSlide';
import { isGraphqlStudioLesson } from './adapters';
import { isLessonDesktopOnlyBlocked, isDockerLessonBlockedOnWeb } from './utils/lessonPlatform';
import { inferDockerStackKey } from './utils/dockerStack';
import LessonNotesEditor from './LessonNotesEditor';
import { useLessonNotesContext } from './LessonNotesContext';

interface LessonPlayerProps {
  lesson: DemoLesson;
  onStartDemo: () => void;
  /** Step index from which steps are "new" (added since user last completed).
   *  When set, steps at index >= newStepsFrom show a "New" indicator. */
  newStepsFrom?: number;
}

type SelectedPanel = 'concept' | 'notes' | number;

export default function LessonPlayer({ lesson, onStartDemo, newStepsFrom }: LessonPlayerProps) {
  const { getNote, hasNote, saveNote } = useLessonNotesContext();
  const gateKey = `prereq-gate-cleared:${lesson.id}`;
  const [dockerGateCleared, setDockerGateCleared] = useState(() => {
    try {
      return sessionStorage.getItem(gateKey) === '1';
    } catch {
      return false;
    }
  });
  const [downServiceLabels, setDownServiceLabels] = useState<string[]>([]);
  const [tabGateCleared, setTabGateCleared] = useState(false);
  const [selected, setSelected] = useState<SelectedPanel>('concept');

  const dockerEndpoints = useMemo(
    () => (lesson.dockerEndpoints?.length
      ? lesson.dockerEndpoints
      : lesson.dockerEndpoint
        ? [lesson.dockerEndpoint]
        : []),
    [lesson.dockerEndpoints, lesson.dockerEndpoint],
  );
  const needsDockerGate = dockerEndpoints.length > 0;

  const handleProbeStatus = useCallback((down: string[]) => {
    setDownServiceLabels((prev) => (
      prev.length === down.length && prev.every((v, i) => v === down[i]) ? prev : down
    ));
  }, []);
  const handleServerReady = useCallback(() => {
    setDockerGateCleared(true);
    try { sessionStorage.setItem(gateKey, '1'); } catch { /* quota */ }
  }, [gateKey]);
  const handleServerLost = useCallback(() => {
    setDockerGateCleared(false);
    try { sessionStorage.removeItem(gateKey); } catch { /* quota */ }
  }, [gateKey]);
  const handleTabCapacityReady = useCallback(() => setTabGateCleared(true), []);
  const tabBudget = lesson.tabBudget ?? 1;
  const needsTabGate = isGraphqlStudioLesson(lesson) && tabBudget > 1;
  const desktopBlocked = isLessonDesktopOnlyBlocked(lesson);
  const dockerBlockedOnWeb = isDockerLessonBlockedOnWeb(lesson);
  const canStart =
    !desktopBlocked
    && !dockerBlockedOnWeb
    && (!needsDockerGate || dockerGateCleared)
    && (!needsTabGate || tabGateCleared);

  const selectedStep = typeof selected === 'number' ? lesson.steps[selected] : null;
  const isFirstStep  = selected === 0;
  const isLastStep   = typeof selected === 'number' && selected === lesson.steps.length - 1;

  const waitingLabel = downServiceLabels.length > 0
    ? `⏳ Waiting for ${downServiceLabels.join(' + ')}…`
    : '⏳ Waiting for local services…';

  const startBtn = (
    <button
      className={`demo-start-btn ${(needsDockerGate || needsTabGate) && canStart ? 'demo-start-btn--ready' : ''}`}
      onClick={onStartDemo}
      disabled={!canStart}
      title={
        desktopBlocked || dockerBlockedOnWeb
          ? 'This demo requires the RedfireForge desktop app'
          : !canStart
            ? 'Complete the prerequisites above before starting'
            : undefined
      }
    >
      {desktopBlocked || dockerBlockedOnWeb
        ? 'Desktop app required'
        : needsDockerGate && !dockerGateCleared
          ? waitingLabel
          : 'Start Demo →'}
    </button>
  );

  return (
    <div className="demo-lesson-player">
      <div className="demo-lesson-player-sidebar">
        <div className="demo-sidebar-section">
          <button
            className={`demo-sidebar-nav-item ${selected === 'concept' ? 'active' : ''}`}
            onClick={() => setSelected('concept')}
            data-testid="demo-lesson-sidebar-concept"
          >
            <span className="demo-sidebar-nav-icon">📖</span>
            <span className="demo-sidebar-nav-label">Concept</span>
          </button>

          <button
            className={`demo-sidebar-nav-item demo-sidebar-nav-item--notes ${selected === 'notes' ? 'notes-active' : ''}`}
            onClick={() => setSelected('notes')}
            data-testid="demo-lesson-sidebar-notes"
          >
            <span className="demo-sidebar-nav-icon">📝</span>
            <span className="demo-sidebar-nav-label">
              Notes
              {hasNote(lesson.id) && (
                <span className="demo-sidebar-notes-dot" aria-label="Has saved notes" />
              )}
            </span>
          </button>

          <div className="demo-sidebar-steps-label">Steps</div>
          {lesson.steps.map((step, idx) => (
            <button
              key={step.id}
              className={`demo-sidebar-nav-item ${selected === idx ? 'active' : ''}`}
              onClick={() => setSelected(idx)}
            >
              <span className="demo-sidebar-step-num">{idx + 1}</span>
              <span className="demo-sidebar-nav-label">{step.title}</span>
              {newStepsFrom != null && idx >= newStepsFrom && (
                <span className="demo-sidebar-new-badge">New</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="demo-lesson-player-content">
        {selected === 'concept' ? (
          <ConceptSlide concept={lesson.concept} />
        ) : selected === 'notes' ? (
          <div className="demo-notes-inline">
            <LessonNotesEditor
              lessonId={lesson.id}
              lessonName={lesson.name}
              savedText={getNote(lesson.id)}
              onSave={(text) => saveNote(lesson.id, text)}
              onClose={() => setSelected('concept')}
              showHeader
            />
          </div>
        ) : selectedStep ? (
          <div className="demo-step-detail">
            <div className="demo-step-detail-header">
              <span className="demo-step-detail-num">Step {(selected as number) + 1}</span>
              <h2 className="demo-step-detail-title">{selectedStep.title}</h2>
            </div>
            <div
              className="demo-step-detail-body"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedStep.description) }}
            />
            {selectedStep.diagram && (
              <div
                className="demo-step-diagram"
                dangerouslySetInnerHTML={{ __html: selectedStep.diagram }}
              />
            )}
          </div>
        ) : null}

        {selected === 'concept' && (desktopBlocked || dockerBlockedOnWeb) && (
          <DesktopOnlyGate reason={dockerBlockedOnWeb ? 'docker-backend' : 'desktop-only'} />
        )}

        {needsDockerGate && !desktopBlocked && !dockerBlockedOnWeb && (
          <div hidden={selected !== 'concept'} data-testid="demo-lesson-prereq-wrap">
            <PrerequisiteGate
              endpoints={dockerEndpoints}
              endpointLabels={lesson.dockerEndpointLabels}
              dockerCommand={lesson.dockerCommand ?? `docker compose -f docker/websocket/socketio/docker-compose.yml up`}
              stackKey={
                lesson.dockerStack?.stackKey
                ?? inferDockerStackKey(
                  lesson.dockerCommand ?? 'docker compose -f docker/websocket/socketio/docker-compose.yml up',
                )
              }
              gateLabel={lesson.gateLabel}
              onServerReady={handleServerReady}
              onServerLost={handleServerLost}
              onProbeStatusChange={handleProbeStatus}
              tabBudget={needsTabGate ? tabBudget : undefined}
              onTabCapacityReady={needsTabGate ? handleTabCapacityReady : undefined}
              initiallyCleared={dockerGateCleared}
            />
          </div>
        )}

        <div className="demo-lesson-player-footer">
          {typeof selected === 'number' ? (
            <div className="demo-step-detail-nav">
              {!isFirstStep && (
                <button
                  className="demo-step-nav-btn"
                  onClick={() => setSelected((selected as number) - 1)}
                >
                  ← Prev
                </button>
              )}
              {!isLastStep && (
                <button
                  className="demo-step-nav-btn"
                  onClick={() => setSelected((selected as number) + 1)}
                >
                  Next →
                </button>
              )}
            </div>
          ) : (
            <span />
          )}
          {selected !== 'notes' && startBtn}
        </div>
      </div>
    </div>
  );
}
