/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ApiMockServerBar } from './ApiMockServerBar';
import { DEFAULT_SETTINGS } from '@shared/api-mock/defaults';
import type { ApiMockServerDefinitionV1 } from '@shared/api-mock/contracts';
import { isDesktopRuntimeAvailable, isTauri } from '@shared/utils/platform';
import { analyzeNativeUnsupported } from '@shared/api-mock/nativeCapabilities';

vi.mock('../../../shared/utils/platform', () => ({
  isTauri: vi.fn(() => false),
  isE2eDesktopShim: vi.fn(() => false),
  isLocalhost: vi.fn(() => false),
  isDesktopRuntimeAvailable: vi.fn(() => false),
}));

vi.mock('../../../shared/api-mock/nativeCapabilities', () => ({
  analyzeNativeUnsupported: vi.fn(() => []),
}));

const ts = '2026-08-12T00:00:00.000Z';

function makeServer(): ApiMockServerDefinitionV1 {
  return {
    id: 'srv-1',
    name: 'Mock Server 1',
    enabled: true,
    host: '127.0.0.1',
    port: 4600,
    basePath: '/api',
    folders: [],
    routes: [],
    samples: [],
    variables: [],
    settings: { ...DEFAULT_SETTINGS },
    createdAt: ts,
    updatedAt: ts,
  };
}

describe('ApiMockServerBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(global.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders stopped state with desktop-required gate on hosted web', () => {
    const onStart = vi.fn();
    render(<ApiMockServerBar server={makeServer()} onUpdate={vi.fn()} onStart={onStart} />);

    expect(screen.getByText('Stopped')).toBeTruthy();
    expect(screen.getByTestId('api-mock-address').textContent).toContain('http://127.0.0.1:4600/api');
    const startBtn = screen.getByTestId('api-mock-start');
    expect(startBtn).toBeDisabled();
    expect(startBtn).toHaveAttribute('title', 'Starting a mock server requires the RedfireForge desktop app');
    expect(screen.getByTestId('api-mock-desktop-required')).toBeTruthy();
    fireEvent.click(startBtn);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('enables Start on a local clone (localhost web companion)', () => {
    vi.mocked(isDesktopRuntimeAvailable).mockReturnValue(true);
    const onStart = vi.fn();
    render(<ApiMockServerBar server={makeServer()} onUpdate={vi.fn()} onStart={onStart} />);

    const startBtn = screen.getByTestId('api-mock-start');
    expect(startBtn).toBeEnabled();
    expect(screen.queryByTestId('api-mock-desktop-required')).toBeNull();
    fireEvent.click(startBtn);
    expect(onStart).toHaveBeenCalled();
  });

  it('renders stopped state and starts the server in Tauri (desktop) mode', () => {
    vi.mocked(isDesktopRuntimeAvailable).mockReturnValue(true);
    vi.mocked(isTauri).mockReturnValue(true);
    const onStart = vi.fn();
    render(<ApiMockServerBar server={makeServer()} onUpdate={vi.fn()} onStart={onStart} />);

    expect(screen.getByText('Stopped')).toBeTruthy();
    expect(screen.getByTestId('api-mock-address').textContent).toContain('http://127.0.0.1:4600/api');
    expect(screen.getByTestId('api-mock-start')).toHaveAttribute(
      'title',
      'Start the listener. With no rules, every request returns 404 until you add one.',
    );
    fireEvent.click(screen.getByTestId('api-mock-start'));
    expect(onStart).toHaveBeenCalled();
  });

  it('renders running controls, dirty badge, generation, and error message (Tauri mode)', () => {
    vi.mocked(isDesktopRuntimeAvailable).mockReturnValue(true);
    vi.mocked(isTauri).mockReturnValue(true);
    const onApply = vi.fn();
    const onRestart = vi.fn();
    const onStop = vi.fn();
    const onSettings = vi.fn();
    render(
      <ApiMockServerBar
        server={makeServer()}
        onUpdate={vi.fn()}
        status="running"
        dirty
        generation={7}
        error="Validation warning"
        onApply={onApply}
        onRestart={onRestart}
        onStop={onStop}
        onSettings={onSettings}
      />,
    );

    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByTestId('api-mock-dirty-badge')).toHaveTextContent('Draft changed');
    expect(screen.getByText('Generation 7')).toBeTruthy();
    expect(screen.getByTestId('api-mock-server-error')).toHaveTextContent('Validation warning');

    fireEvent.click(screen.getByTestId('api-mock-apply'));
    fireEvent.click(screen.getByTestId('api-mock-restart'));
    fireEvent.click(screen.getByTestId('api-mock-stop'));
    fireEvent.click(screen.getByTestId('api-mock-settings'));

    expect(onApply).toHaveBeenCalled();
    expect(onRestart).toHaveBeenCalled();
    expect(onStop).toHaveBeenCalled();
    expect(onSettings).toHaveBeenCalled();
  });

  it('shows the full companion-unavailable diagnostic without truncating', () => {
    const full =
      'Companion unavailable: The companion runtime is not reachable. Start it with `npm run server:dev`, then retry.';
    render(
      <ApiMockServerBar
        server={makeServer()}
        onUpdate={vi.fn()}
        status="error"
        error={full}
        onStart={vi.fn()}
      />,
    );
    const el = screen.getByTestId('api-mock-server-error');
    expect(el).toHaveTextContent(full);
    expect(el.textContent).not.toMatch(/\.\.\.$/);
    expect(el.getAttribute('role')).toBe('alert');
  });

  it('disables start while busy and shows the transitional label', () => {
    render(<ApiMockServerBar server={makeServer()} onUpdate={vi.fn()} status="starting" onStart={vi.fn()} />);
    const start = screen.getByTestId('api-mock-start');
    expect(start).toBeDisabled();
    expect(start).toHaveTextContent('Starting…');
  });

  it.each([
    ['draining', 'Draining…'],
    ['applying', 'Applying…'],
  ] as const)('marks %s as busy with label %s', (status, label) => {
    render(<ApiMockServerBar server={makeServer()} onUpdate={vi.fn()} status={status} onStart={vi.fn()} />);
    const start = screen.getByTestId('api-mock-start');
    expect(start).toBeDisabled();
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('copies a client-reachable address for LAN binds and TLS', () => {
    const server = makeServer();
    server.host = '0.0.0.0';
    server.settings = {
      ...server.settings,
      tls: { enabled: true, certPem: 'CERT', keyPem: 'KEY' },
    };
    render(<ApiMockServerBar server={server} onUpdate={vi.fn()} />);
    expect(screen.getByTestId('api-mock-address').textContent).toContain('https://127.0.0.1:4600/api');
    expect(screen.getByTestId('api-mock-listen-url')).toContainElement(screen.getByTestId('api-mock-address'));
    expect(screen.getByTestId('api-mock-http2-badge')).toHaveTextContent('HTTP/2');
    fireEvent.click(screen.getByTestId('api-mock-copy-address'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://127.0.0.1:4600/api');
  });

  it('shows HTTP/2 on Tauri TLS with no native capability warnings', () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const server = makeServer();
    server.settings = {
      ...server.settings,
      tls: { enabled: true, certPem: 'CERT', keyPem: 'KEY' },
      fallback: { ...server.settings.fallback, mode: 'proxy' },
    };
    render(<ApiMockServerBar server={server} onUpdate={vi.fn()} />);
    expect(screen.getByTestId('api-mock-http2-badge')).toHaveTextContent('HTTP/2');
    expect(screen.queryByTestId('api-mock-native-warnings')).not.toBeInTheDocument();
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it('shows native warnings and open routes when requested', () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(analyzeNativeUnsupported).mockReturnValue([{ code: 'tls', message: 'TLS unavailable' }]);
    render(<ApiMockServerBar server={makeServer()} onUpdate={vi.fn()} onOpenRoutes={vi.fn()} />);

    expect(screen.getByTestId('api-mock-native-warnings')).toHaveTextContent('TLS unavailable');
    expect(screen.getByTestId('api-mock-open-routes')).toBeTruthy();
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(analyzeNativeUnsupported).mockReturnValue([]);
  });

  it('copies the address and toggles the button label', async () => {
    render(<ApiMockServerBar server={makeServer()} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('api-mock-copy-address'));

    expect(screen.queryByTestId('api-mock-http2-badge')).not.toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://127.0.0.1:4600/api');
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('api-mock-copy-address')).toHaveAttribute('title', 'Copied!');
    act(() => { vi.runAllTimers(); });
    expect(screen.getByTestId('api-mock-copy-address')).toHaveAttribute('title', 'Copy address');
  });

  it('swallows clipboard failures without crashing', () => {
    Object.defineProperty(global.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<ApiMockServerBar server={makeServer()} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('api-mock-copy-address'));
    expect(screen.getByTestId('api-mock-copy-address')).toHaveAttribute('title', 'Copy address');
  });
});
