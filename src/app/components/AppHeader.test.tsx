// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createRef } from 'react';
import type { RefObject } from 'react';
import AppHeader from './AppHeader';
import type { Environment, Microservice } from '@shared/types';
import type { KafkaConnectionSnapshot } from '@shared/kafka/kafkaConfig';
import type { Tab } from '../utils/appTabUtils';
import { persistSavedThemes, type SavedCustomTheme } from '../themeCustomizerUtils';

// Mock the Kafka indicator child so the header renders in isolation.
vi.mock('./KafkaConnectionIndicator', () => ({
  default: ({ hasClusters }: { hasClusters: boolean }) =>
    hasClusters ? <div data-testid="kafka-indicator">kafka</div> : null,
}));

const THEMES = [
  {
    group: 'Dark',
    items: [
      { id: 'dark', icon: '🌙', label: 'Dark', bg: '#111' },
      { id: 'midnight', icon: '🌃', label: 'Midnight', bg: '#001' },
    ],
  },
  {
    group: 'Light',
    items: [{ id: 'light', icon: '☀️', label: 'Light', bg: '#fff' }],
  },
] as const;

const THEME_ICONS: Record<string, string> = { dark: '🌙', light: '☀️' };

const kafkaConnection: KafkaConnectionSnapshot = { state: 'disconnected' };

interface Overrides {
  activeTab?: Tab;
  environments?: Environment[];
  microservices?: Microservice[];
  selectedEnvId?: string;
  selectedSvcId?: string;
  theme?: string;
  themePickerOpen?: boolean;
  kafkaHasClusters?: boolean;
}

function setup(over: Overrides = {}) {
  const setSelectedEnvId = vi.fn();
  const setSelectedSvcId = vi.fn();
  const setTheme = vi.fn();
  const setThemePickerOpen = vi.fn();
  const setShowCustomizer = vi.fn();
  const onNavigateToKafkaSettings = vi.fn();
  const headerRef = createRef<HTMLElement>() as RefObject<HTMLElement | null>;
  const themePickerRef = createRef<HTMLDivElement>() as RefObject<HTMLDivElement | null>;

  const utils = render(
    <AppHeader
      headerRef={headerRef}
      activeTab={over.activeTab ?? 'requests'}
      environments={over.environments ?? [{ id: 'e1', name: 'Dev' }]}
      microservices={over.microservices ?? [{ id: 's1', name: 'Orders', baseUrls: {} }]}
      selectedEnvId={over.selectedEnvId ?? ''}
      setSelectedEnvId={setSelectedEnvId}
      selectedSvcId={over.selectedSvcId ?? ''}
      setSelectedSvcId={setSelectedSvcId}
      theme={over.theme ?? 'dark'}
      setTheme={setTheme}
      themePickerOpen={over.themePickerOpen ?? false}
      setThemePickerOpen={setThemePickerOpen}
      themePickerRef={themePickerRef}
      THEMES={THEMES}
      THEME_ICONS={THEME_ICONS}
      setShowCustomizer={setShowCustomizer}
      kafkaConnection={kafkaConnection}
      kafkaClusterName={null}
      kafkaHasClusters={over.kafkaHasClusters ?? false}
      onNavigateToKafkaSettings={onNavigateToKafkaSettings}
    />,
  );

  return {
    ...utils,
    setSelectedEnvId,
    setSelectedSvcId,
    setTheme,
    setThemePickerOpen,
    setShowCustomizer,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('__APP_VERSION__', '9.9.9');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('AppHeader', () => {
  it('renders the version badge from the global', () => {
    setup();
    expect(screen.getByText('v9.9.9')).toBeTruthy();
  });

  it('routes environment and service select changes', () => {
    const { setSelectedEnvId, setSelectedSvcId } = setup();
    const envWrapper = document.querySelector('[data-testid="header-env-select"]') as HTMLElement;
    const svcWrapper = document.querySelector('[data-testid="header-svc-select"]') as HTMLElement;
    // Open env dropdown and select "Dev"
    fireEvent.click(envWrapper.querySelector('.cs-trigger')!);
    fireEvent.click(screen.getByText('Dev'));
    expect(setSelectedEnvId).toHaveBeenCalledWith('e1');
    // Open svc dropdown and select "Orders"
    fireEvent.click(svcWrapper.querySelector('.cs-trigger')!);
    fireEvent.click(screen.getByText('Orders'));
    expect(setSelectedSvcId).toHaveBeenCalledWith('s1');
  });

  it('renders the Additional group when a microservice has custom envs', () => {
    setup({
      microservices: [
        { id: 's1', name: 'Orders', baseUrls: {}, customEnvs: [{ id: 'ce1', name: 'QA Sandbox' }] },
      ],
    });
    const envWrapper = document.querySelector('[data-testid="header-env-select"]') as HTMLElement;
    fireEvent.click(envWrapper.querySelector('.cs-trigger')!);
    expect(screen.getByText('QA Sandbox (Orders)')).toBeTruthy();
    expect(screen.getByText('Additional')).toBeTruthy();
  });

  it('omits the Additional group when no microservice has custom envs', () => {
    setup({ microservices: [{ id: 's1', name: 'Orders', baseUrls: {} }] });
    const envWrapper = document.querySelector('[data-testid="header-env-select"]') as HTMLElement;
    fireEvent.click(envWrapper.querySelector('.cs-trigger')!);
    expect(screen.queryByText('Additional')).toBeNull();
  });

  it('hides the kafka indicator without clusters and shows it with clusters', () => {
    const { rerender } = setup({ kafkaHasClusters: false });
    expect(screen.queryByTestId('kafka-indicator')).toBeNull();
    rerender(
      <AppHeader
        headerRef={createRef<HTMLElement>() as RefObject<HTMLElement | null>}
        activeTab={'requests' as Tab}
        environments={[]}
        microservices={[]}
        selectedEnvId=""
        setSelectedEnvId={vi.fn()}
        selectedSvcId=""
        setSelectedSvcId={vi.fn()}
        theme="dark"
        setTheme={vi.fn()}
        themePickerOpen={false}
        setThemePickerOpen={vi.fn()}
        themePickerRef={createRef<HTMLDivElement>() as RefObject<HTMLDivElement | null>}
        THEMES={THEMES}
        THEME_ICONS={THEME_ICONS}
        setShowCustomizer={vi.fn()}
        kafkaConnection={kafkaConnection}
        kafkaClusterName={null}
        kafkaHasClusters
        onNavigateToKafkaSettings={vi.fn()}
      />,
    );
    expect(screen.getByTestId('kafka-indicator')).toBeTruthy();
  });

  it('toggles the theme picker open via the toggle button', () => {
    const { container, setThemePickerOpen } = setup({ theme: 'dark' });
    const toggle = container.querySelector('.theme-toggle') as HTMLButtonElement;
    expect(toggle.title).toBe('Theme: dark');
    expect(toggle.textContent).toContain('🌙');
    fireEvent.click(toggle);
    expect(setThemePickerOpen).toHaveBeenCalledTimes(1);
    // Exercise the functional updater passed to the setter.
    const updater = setThemePickerOpen.mock.calls[0][0] as (o: boolean) => boolean;
    expect(updater(false)).toBe(true);
  });

  it('falls back to the default icon for unknown themes', () => {
    const { container } = setup({ theme: 'midnight' });
    const toggle = container.querySelector('.theme-toggle') as HTMLButtonElement;
    expect(toggle.textContent).toContain('🎨');
  });

  it('adds the open class when the picker is open', () => {
    const { container } = setup({ themePickerOpen: true });
    expect(container.querySelector('.theme-picker')?.className).toContain('open');
  });

  it('selects a theme option and closes the picker', () => {
    const { container, setTheme, setThemePickerOpen } = setup({ theme: 'dark' });
    const lightOption = Array.from(container.querySelectorAll('.theme-option')).find(
      (el) => el.textContent?.includes('Light'),
    ) as HTMLButtonElement;
    fireEvent.click(lightOption);
    expect(setTheme).toHaveBeenCalledWith('light');
    expect(setThemePickerOpen).toHaveBeenCalledWith(false);
  });

  it('marks the active theme option', () => {
    const { container } = setup({ theme: 'light' });
    const active = container.querySelector('.theme-option.active');
    expect(active?.textContent).toContain('Light');
  });

  it('shows the active custom badge with the saved theme name', () => {
    const saved: SavedCustomTheme = { id: 'abc', name: 'Sunset', base: 'dark', overrides: {}, contrast: 0 };
    persistSavedThemes([saved]);
    const { container } = setup({ theme: 'custom:abc' });
    expect(screen.getByText('Sunset')).toBeTruthy();
    expect(screen.getByText('active')).toBeTruthy();
    expect(container.querySelector('.theme-customize-btn')?.className).toContain('active');
    const toggle = container.querySelector('.theme-toggle') as HTMLButtonElement;
    expect(toggle.title).toBe('Theme: Sunset');
  });

  it('falls back to "Custom" when the custom theme is not saved', () => {
    const { container } = setup({ theme: 'custom:missing' });
    expect(screen.getByText('Custom')).toBeTruthy();
    const toggle = container.querySelector('.theme-toggle') as HTMLButtonElement;
    expect(toggle.title).toBe('Theme: Custom');
  });

  it('opens the customizer and closes the picker from the Customize button', () => {
    const { container, setThemePickerOpen, setShowCustomizer } = setup({ theme: 'dark' });
    const btn = container.querySelector('.theme-customize-btn') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(setThemePickerOpen).toHaveBeenCalledWith(false);
    expect(setShowCustomizer).toHaveBeenCalledWith(true);
  });

  it('shows protocol indicator on websocket studio with explicit endpoint (AC-EM-14)', () => {
    setup({
      activeTab: 'websocket-studio',
      selectedEnvId: 'e1',
      selectedSvcId: 's1',
      microservices: [{
        id: 's1',
        name: 'Orders',
        baseUrls: { e1: 'https://api.example.com' },
        protocolEndpoints: { websocket: { e1: { baseUrl: 'wss://ws.example.com' } } },
      }],
    });
    const badge = screen.getByTestId('header-protocol-indicator');
    expect(badge.getAttribute('data-status')).toBe('explicit');
    expect(badge.textContent).toContain('wss://ws.example.com');
    expect(badge.textContent).toContain('✓');
    expect(badge.getAttribute('title')).toContain('Resolved: wss://ws.example.com');
  });

  it('shows fallback indicator when websocket derives from HTTP (AC-EM-15)', () => {
    setup({
      activeTab: 'websocket-studio',
      selectedEnvId: 'e1',
      selectedSvcId: 's1',
      microservices: [{ id: 's1', name: 'Orders', baseUrls: { e1: 'https://api.example.com' } }],
    });
    const badge = screen.getByTestId('header-protocol-indicator');
    expect(badge.getAttribute('data-status')).toBe('fallback');
    expect(badge.textContent).toContain('⚠');
    expect(badge.getAttribute('title')).toContain('HTTP');
  });

  it('hides protocol indicator on settings tabs', () => {
    setup({ activeTab: 'environments' });
    expect(screen.queryByTestId('header-protocol-indicator')).toBeNull();
  });

  it.each([
    'workflow',
    'gallery',
    'demo-hub',
    'kafka-message-studio',
  ] as const)('hides protocol indicator on %s tab', (activeTab) => {
    setup({ activeTab });
    expect(screen.queryByTestId('header-protocol-indicator')).toBeNull();
  });

  it('shows unresolved indicator when env/service not selected on protocol studio', () => {
    setup({ activeTab: 'sse-studio', selectedEnvId: '', selectedSvcId: '' });
    const badge = screen.getByTestId('header-protocol-indicator');
    expect(badge.getAttribute('data-status')).toBe('unresolved');
    expect(badge.textContent).toContain('✗');
    expect(badge.getAttribute('title')).toContain('Select an environment');
  });

  it('opens the keyboard shortcuts modal when ? is pressed', () => {
    setup();
    expect(screen.queryByTestId('keyboard-shortcuts-modal')).toBeNull();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByTestId('keyboard-shortcuts-modal')).toBeTruthy();
  });

  it('closes the keyboard shortcuts modal when ? is pressed a second time', () => {
    setup();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByTestId('keyboard-shortcuts-modal')).toBeTruthy();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.queryByTestId('keyboard-shortcuts-modal')).toBeNull();
  });

  it('closes the keyboard shortcuts modal when Escape is pressed', () => {
    setup();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByTestId('keyboard-shortcuts-modal')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('keyboard-shortcuts-modal')).toBeNull();
  });

  it('does not open the shortcuts modal when ? is typed inside an input', () => {
    setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: '?' });
    expect(screen.queryByTestId('keyboard-shortcuts-modal')).toBeNull();
    input.remove();
  });
});
