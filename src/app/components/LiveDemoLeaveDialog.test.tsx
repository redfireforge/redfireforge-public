/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LiveDemoLeaveDialog from './LiveDemoLeaveDialog';

describe('LiveDemoLeaveDialog', () => {
  it('calls onStay from Stay and Escape', () => {
    const onStay = vi.fn();
    render(<LiveDemoLeaveDialog onStay={onStay} onLeave={vi.fn()} />);
    fireEvent.click(screen.getByTestId('live-demo-leave-stay'));
    expect(onStay).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onStay).toHaveBeenCalledTimes(2);
  });

  it('calls onLeave from Leave demo', () => {
    const onLeave = vi.fn();
    render(<LiveDemoLeaveDialog onStay={vi.fn()} onLeave={onLeave} />);
    fireEvent.click(screen.getByTestId('live-demo-leave-leave'));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('ignores non-Escape keys', () => {
    const onStay = vi.fn();
    const onLeave = vi.fn();
    render(<LiveDemoLeaveDialog onStay={onStay} onLeave={onLeave} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onStay).not.toHaveBeenCalled();
    expect(onLeave).not.toHaveBeenCalled();
  });
});
