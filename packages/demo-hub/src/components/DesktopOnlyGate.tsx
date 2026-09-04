/**
 * DesktopOnlyGate — blocks desktop-only or Docker-dependent demo lessons in the web build.
 *
 * - `desktop-only`: lesson.desktopOnly — requires native desktop features (gRPC, etc.)
 * - `docker-backend`: lesson.dockerEndpoint — requires a local Docker service (GraphQL, Kafka, WS, gRPC)
 *
 * Parent keeps Start Demo disabled while this shows.
 */
import { DOCKER_DESKTOP_INSTALL_URL, LEARNING_HUB_DOWNLOAD_URL } from '../utils/dockerCommandDisplay';

interface DesktopOnlyGateProps {
  reason?: 'desktop-only' | 'docker-backend';
}

export default function DesktopOnlyGate({ reason = 'desktop-only' }: DesktopOnlyGateProps) {
  const isDocker = reason === 'docker-backend';

  return (
    <div className="prereq-gate prereq-gate--desktop" data-testid="desktop-only-gate">
      <div className="prereq-gate-header">
        <span aria-hidden="true">🖥</span>
        Desktop app required
      </div>
      <p className="prereq-instruction-title">
        {isDocker
          ? 'This demo requires a local backend service (Docker) that cannot run in a hosted web environment.'
          : 'This demo uses native desktop features built into the RedfireForge desktop app that are not available in the web version.'}
      </p>
      <p className="prereq-instruction-note" data-testid="desktop-only-gate-note">
        {isDocker
          ? 'Download the RedfireForge Learning Hub desktop app to run this lesson. You will also need Docker Desktop installed — once downloaded, the app will guide you through starting the required services.'
          : 'Open RedfireForge as a desktop app to run this lesson. You can still read the concept and steps here, but Start Demo stays disabled on web.'}
      </p>
      <a
        href={LEARNING_HUB_DOWNLOAD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="prereq-gate-download-link"
        data-testid="desktop-only-gate-download"
      >
        Download the Learning Hub desktop app →
      </a>
      {isDocker && (
        <p className="prereq-docker-hint" data-testid="desktop-only-gate-docker-hint">
          Don't have Docker Desktop?{' '}
          <a
            href={DOCKER_DESKTOP_INSTALL_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Install it free →
          </a>
          {' '}A restart may be required after installing on Windows.
        </p>
      )}
    </div>
  );
}
