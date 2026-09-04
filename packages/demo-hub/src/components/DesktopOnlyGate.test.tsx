/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DesktopOnlyGate from './DesktopOnlyGate';
import { DOCKER_DESKTOP_INSTALL_URL, LEARNING_HUB_DOWNLOAD_URL } from '../utils/dockerCommandDisplay';

describe('DesktopOnlyGate', () => {
  it('docker-backend copy mentions Docker Desktop and does not claim the app includes everything', () => {
    render(<DesktopOnlyGate reason="docker-backend" />);
    const note = screen.getByTestId('desktop-only-gate-note');
    expect(note.textContent).toMatch(/Docker Desktop/i);
    expect(note.textContent).not.toMatch(/includes everything/i);
    expect(screen.getByTestId('desktop-only-gate-download')).toHaveAttribute(
      'href',
      LEARNING_HUB_DOWNLOAD_URL,
    );
    expect(LEARNING_HUB_DOWNLOAD_URL).not.toMatch(/\/releases\/latest$/);
    expect(screen.getByTestId('desktop-only-gate-download').textContent).toMatch(
      /Download the Learning Hub desktop app/,
    );
    const hint = screen.getByTestId('desktop-only-gate-docker-hint');
    expect(hint.querySelector('a')).toHaveAttribute('href', DOCKER_DESKTOP_INSTALL_URL);
  });

  it('desktop-only copy stays about native features and does not mention Docker Desktop', () => {
    render(<DesktopOnlyGate reason="desktop-only" />);
    const note = screen.getByTestId('desktop-only-gate-note');
    expect(note.textContent).toMatch(/desktop app/i);
    expect(note.textContent).not.toMatch(/Docker Desktop/i);
    expect(note.textContent).not.toMatch(/includes everything/i);
    expect(screen.getByTestId('desktop-only-gate-download')).toHaveAttribute(
      'href',
      LEARNING_HUB_DOWNLOAD_URL,
    );
    expect(screen.queryByTestId('desktop-only-gate-docker-hint')).toBeNull();
  });
});
