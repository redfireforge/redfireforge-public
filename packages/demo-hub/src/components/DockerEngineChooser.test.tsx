/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import DockerEngineChooser from './DockerEngineChooser';

describe('DockerEngineChooser', () => {
  it('marks the selected engine with a distinct pressed style', () => {
    const onChoose = vi.fn();
    render(<DockerEngineChooser selected="orbstack" onChoose={onChoose} />);
    const orbstack = screen.getByTestId('prereq-choose-orbstack');
    const desktop = screen.getByTestId('prereq-choose-desktop');
    expect(orbstack).toHaveClass('prereq-open-docker-btn--selected');
    expect(orbstack).toHaveAttribute('aria-pressed', 'true');
    expect(desktop).not.toHaveClass('prereq-open-docker-btn--selected');
    expect(desktop).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(desktop);
    expect(onChoose).toHaveBeenCalledWith('desktop');
  });
});
