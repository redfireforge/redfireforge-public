/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Microservice } from '@shared/types';
import { EnvVarsModal } from './EnvVarsModal';
import { ProtocolVarsModal } from './ProtocolVarsModal';

const svc: Microservice = {
  id: 'svc-1',
  name: 'demo',
  baseUrls: { e1: 'https://api.example.com' },
  globalVars: { requestId: 'global' },
  envVars: { e1: { token: 'local' } },
};

describe('protocol vars modals coverage gaps', () => {
  it('ProtocolVarsModal shows empty state, Enter-add, overlay close, and save deletes', () => {
    const onClose = vi.fn();
    const onSetGlobalVar = vi.fn();
    const onDeleteGlobalVar = vi.fn();
    const bareSvc = { id: 'svc-1', name: 'demo', baseUrls: { e1: 'https://api.example.com' } } as Microservice;
    render(
      <ProtocolVarsModal
        svc={bareSvc}
        onClose={onClose}
        onSetGlobalVar={onSetGlobalVar}
        onDeleteGlobalVar={onDeleteGlobalVar}
      />,
    );

    expect(screen.getByText(/No protocol variables yet/)).toBeInTheDocument();

    const keyInput = screen.getByTestId('protocol-vars-key-input');
    const valInput = screen.getByTestId('protocol-vars-val-input');
    fireEvent.keyDown(keyInput, { key: 'Enter' });
    act(() => {
      fireEvent.change(keyInput, { target: { value: '   ' } });
    });
    fireEvent.keyDown(keyInput, { key: 'Enter' });
    act(() => {
      fireEvent.change(keyInput, { target: { value: 'traceId' } });
      fireEvent.change(valInput, { target: { value: 'abc-123' } });
    });
    fireEvent.click(screen.getByTestId('protocol-vars-add-btn'));
    fireEvent.keyDown(valInput, { key: 'Enter' });
    act(() => {
      fireEvent.change(keyInput, { target: { value: 'second' } });
      fireEvent.change(valInput, { target: { value: 'two' } });
    });
    fireEvent.keyDown(valInput, { key: 'Enter' });
    expect(screen.getByTestId('protocol-var-row-traceId')).toBeInTheDocument();
    expect(screen.getByText('2 variables')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('protocol-vars-modal'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId('protocol-vars-modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ProtocolVarsModal edits values, saves globals, and adds via key Enter', () => {
    const onClose = vi.fn();
    const onSetGlobalVar = vi.fn();
    const onDeleteGlobalVar = vi.fn();
    render(
      <ProtocolVarsModal
        svc={svc}
        onClose={onClose}
        onSetGlobalVar={onSetGlobalVar}
        onDeleteGlobalVar={onDeleteGlobalVar}
      />,
    );

    fireEvent.change(screen.getByTestId('protocol-var-value-requestId'), { target: { value: 'edited' } });
    fireEvent.click(screen.getByTestId('protocol-vars-save-btn'));
    expect(onSetGlobalVar).toHaveBeenCalledWith('requestId', 'edited');
    expect(onClose).toHaveBeenCalled();

    const keyInput = screen.getByTestId('protocol-vars-key-input');
    act(() => {
      fireEvent.change(keyInput, { target: { value: 'fromEnter' } });
    });
    fireEvent.keyDown(keyInput, { key: 'Enter' });
    expect(screen.getByTestId('protocol-var-row-fromEnter')).toBeInTheDocument();
    expect(screen.getByText('2 variables')).toBeInTheDocument();
  });

  it('ProtocolVarsModal keeps existing globals on save and shows singular footer', () => {
    const onClose = vi.fn();
    const onSetGlobalVar = vi.fn();
    const onDeleteGlobalVar = vi.fn();
    render(
      <ProtocolVarsModal
        svc={{ id: 'svc-1', name: 'demo', globalVars: { only: 'one' } } as Microservice}
        onClose={onClose}
        onSetGlobalVar={onSetGlobalVar}
        onDeleteGlobalVar={onDeleteGlobalVar}
      />,
    );

    expect(screen.getByText('1 variable')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('protocol-vars-save-btn'));
    expect(onDeleteGlobalVar).not.toHaveBeenCalled();
    expect(onSetGlobalVar).toHaveBeenCalledWith('only', 'one');
    expect(onClose).toHaveBeenCalled();
  });

  it('ProtocolVarsModal saves pending key/value without clicking Add', () => {
    const onClose = vi.fn();
    const onSetGlobalVar = vi.fn();
    const onDeleteGlobalVar = vi.fn();
    render(
      <ProtocolVarsModal
        svc={{ id: 'svc-1', name: 'demo', globalVars: {} } as Microservice}
        onClose={onClose}
        onSetGlobalVar={onSetGlobalVar}
        onDeleteGlobalVar={onDeleteGlobalVar}
      />,
    );

    fireEvent.change(screen.getByTestId('protocol-vars-key-input'), { target: { value: 'requestId' } });
    fireEvent.change(screen.getByTestId('protocol-vars-val-input'), { target: { value: 'req-1' } });
    fireEvent.click(screen.getByTestId('protocol-vars-save-btn'));

    expect(onSetGlobalVar).toHaveBeenCalledWith('requestId', 'req-1');
    expect(onDeleteGlobalVar).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('ProtocolVarsModal resizes and save removes deleted globals', () => {
    const onClose = vi.fn();
    const onSetGlobalVar = vi.fn();
    const onDeleteGlobalVar = vi.fn();
    render(
      <ProtocolVarsModal
        svc={svc}
        onClose={onClose}
        onSetGlobalVar={onSetGlobalVar}
        onDeleteGlobalVar={onDeleteGlobalVar}
      />,
    );

    fireEvent.click(screen.getByTestId('protocol-var-delete-requestId'));
    fireEvent.click(screen.getByTestId('protocol-vars-save-btn'));
    expect(onDeleteGlobalVar).toHaveBeenCalledWith('requestId');
    expect(onClose).toHaveBeenCalled();

    const handle = document.querySelector('.em-vars-modal-resize-handle');
    fireEvent.mouseDown(handle!, { clientX: 400, clientY: 300 });
    act(() => {
      fireEvent.mouseMove(document, { clientX: 460, clientY: 360 });
      fireEvent.mouseUp(document);
    });
  });

  it('EnvVarsModal handles empty overrides, Enter-add, overlay close, and save flow', () => {
    const onClose = vi.fn();
    const onSetEnvVar = vi.fn();
    const onDeleteEnvVar = vi.fn();
    render(
      <EnvVarsModal
        svc={{ ...svc, globalVars: {}, envVars: {} }}
        envId="e1"
        envName="test"
        onClose={onClose}
        onSetEnvVar={onSetEnvVar}
        onDeleteEnvVar={onDeleteEnvVar}
      />,
    );

    const emptyState = document.querySelector('.em-vars-modal-empty');
    expect(emptyState?.textContent?.replace(/\s+/g, ' ').trim()).toContain('No overrides for test');

    const keyInput = screen.getByTestId('env-vars-key-input');
    const valInput = screen.getByTestId('env-vars-val-input');
    fireEvent.keyDown(keyInput, { key: 'Enter' });
    fireEvent.change(keyInput, { target: { value: '   ' } });
    fireEvent.keyDown(keyInput, { key: 'Enter' });
    act(() => {
      fireEvent.change(keyInput, { target: { value: 'region' } });
      fireEvent.change(valInput, { target: { value: 'us-east' } });
    });
    fireEvent.keyDown(keyInput, { key: 'Enter' });
    fireEvent.keyDown(valInput, { key: 'Enter' });
    expect(screen.getByText('1 override')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('env-vars-modal'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId('env-vars-modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('env-vars-save-btn'));
    expect(onSetEnvVar).toHaveBeenCalledWith('e1', 'region', 'us-east');
  });

  it('EnvVarsModal deletes overrides, shows global refs, and resizes', () => {
    const onClose = vi.fn();
    const onSetEnvVar = vi.fn();
    const onDeleteEnvVar = vi.fn();
    render(
      <EnvVarsModal
        svc={svc}
        envId="e1"
        envName="test"
        onClose={onClose}
        onSetEnvVar={onSetEnvVar}
        onDeleteEnvVar={onDeleteEnvVar}
      />,
    );
    expect(screen.getByTestId('global-var-ref-row-requestId')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('env-var-delete-token'));
    fireEvent.click(screen.getByTestId('env-vars-save-btn'));
    expect(onDeleteEnvVar).toHaveBeenCalledWith('e1', 'token');

    const handle = document.querySelector('.em-vars-modal-resize-handle');
    fireEvent.mouseDown(handle!, { clientX: 200, clientY: 200 });
    act(() => {
      fireEvent.mouseMove(document, { clientX: 260, clientY: 260 });
      fireEvent.mouseUp(document);
    });
  });

  it('EnvVarsModal edits override values before save', () => {
    const onSetEnvVar = vi.fn();
    render(
      <EnvVarsModal
        svc={svc}
        envId="e1"
        envName="test"
        onClose={vi.fn()}
        onSetEnvVar={onSetEnvVar}
        onDeleteEnvVar={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('env-var-value-token'), { target: { value: 'updated' } });
    fireEvent.click(screen.getByTestId('env-vars-save-btn'));
    expect(onSetEnvVar).toHaveBeenCalledWith('e1', 'token', 'updated');
  });
});
