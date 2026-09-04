import { useMemo, useState, type RefObject } from 'react';
import type { Environment, Microservice } from '@shared/types';
import type { KafkaConnectionSnapshot } from '@shared/kafka/kafkaConfig';
import { isCustomThemeId, findSavedTheme } from '../themeCustomizerUtils';
import type { Tab } from '../utils/appTabUtils';
import { resolveHeaderProtocolIndicator } from '../utils/headerProtocolUtils';
import { CustomSelect, type CustomSelectItems } from '@shared/components/CustomSelect';
import HeaderProtocolIndicator from './HeaderProtocolIndicator';
import KafkaConnectionIndicator from './KafkaConnectionIndicator';
import { DesktopDownloadButton } from './DesktopDownloadButton';
import { useAppShortcuts } from '../hooks/useAppShortcuts';
import KeyboardShortcutsModal from '@shared/components/KeyboardShortcutsModal';

interface ThemeItem {
  readonly id: string;
  readonly icon: string;
  readonly label: string;
  readonly bg: string;
}

interface ThemeGroup {
  readonly group: string;
  readonly items: readonly ThemeItem[];
}

interface AppHeaderProps {
  headerRef: RefObject<HTMLElement | null>;
  activeTab: Tab;
  environments: Environment[];
  microservices: Microservice[];
  selectedEnvId: string;
  setSelectedEnvId: (id: string) => void;
  selectedSvcId: string;
  setSelectedSvcId: (id: string) => void;
  theme: string;
  setTheme: (id: string) => void;
  themePickerOpen: boolean;
  setThemePickerOpen: (fn: boolean | ((prev: boolean) => boolean)) => void;
  themePickerRef: RefObject<HTMLDivElement | null>;
  THEMES: readonly ThemeGroup[];
  THEME_ICONS: Record<string, string>;
  setShowCustomizer: (show: boolean) => void;
  kafkaConnection: KafkaConnectionSnapshot;
  kafkaClusterName: string | null;
  kafkaHasClusters: boolean;
  onNavigateToKafkaSettings: () => void;
}

export default function AppHeader({
  headerRef,
  activeTab,
  environments,
  microservices,
  selectedEnvId,
  setSelectedEnvId,
  selectedSvcId,
  setSelectedSvcId,
  theme,
  setTheme,
  themePickerOpen,
  setThemePickerOpen,
  themePickerRef,
  THEMES,
  THEME_ICONS,
  setShowCustomizer,
  kafkaConnection,
  kafkaClusterName,
  kafkaHasClusters,
  onNavigateToKafkaSettings,
}: AppHeaderProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  useAppShortcuts(() => setShowShortcuts((v) => !v));

  const selectedSvc = microservices.find((s) => s.id === selectedSvcId);
  const protocolIndicator = resolveHeaderProtocolIndicator(
    activeTab,
    selectedSvc,
    selectedEnvId,
    environments,
  );

  const hasCustomEnvs = microservices.some(s => (s.customEnvs ?? []).length > 0);
  const envOptions: CustomSelectItems = useMemo(() => {
    const main = environments.map(env => ({ value: env.id, label: env.name }));
    if (!hasCustomEnvs) return main;
    const additional = microservices.flatMap(s =>
      (s.customEnvs ?? []).map(ce => ({ value: ce.id, label: `${ce.name} (${s.name})` })),
    );
    return [
      { label: 'Environments', options: main },
      { label: 'Additional', options: additional },
    ];
  }, [environments, microservices, hasCustomEnvs]);

  const svcOptions = useMemo(
    () => microservices.map(svc => ({ value: svc.id, label: svc.name })),
    [microservices],
  );

  return (
    <header ref={headerRef} className="app-header">
      <h1>🔥 RedfireForge
        <span style={{ fontSize: '0.4em', fontWeight: 400, opacity: 0.5, marginLeft: '0.6em', verticalAlign: 'middle', background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: '10px' }}>v{__APP_VERSION__}</span>
      </h1>
      <div className="header-selectors" data-testid="header-selectors">
        <div className="header-select-group header-select-group--env">
          <CustomSelect
            data-testid="header-env-select"
            value={selectedEnvId}
            onChange={setSelectedEnvId}
            options={envOptions}
            placeholder="Environment…"
            size="sm"
            className="header-env-select"
          />
        </div>
        <div className="header-select-group header-select-group--svc">
          <CustomSelect
            data-testid="header-svc-select"
            value={selectedSvcId}
            onChange={setSelectedSvcId}
            options={svcOptions}
            placeholder="Service…"
            size="sm"
            className="header-svc-select"
          />
        </div>
        {protocolIndicator && <HeaderProtocolIndicator state={protocolIndicator} />}
        <KafkaConnectionIndicator
          connection={kafkaConnection}
          clusterName={kafkaClusterName}
          hasClusters={kafkaHasClusters}
          onNavigateToSettings={onNavigateToKafkaSettings}
        />

        <DesktopDownloadButton />

        <div className={`theme-picker${themePickerOpen ? ' open' : ''}`} ref={themePickerRef}>
          <button className="theme-toggle" onClick={() => setThemePickerOpen((o: boolean) => !o)}
            title={`Theme: ${isCustomThemeId(theme) ? (findSavedTheme(theme)?.name ?? 'Custom') : theme}`}>
            {THEME_ICONS[theme] ?? '🎨'}
          </button>
          <div className="theme-dropdown">
            {THEMES.map(g => (
              <div key={g.group}>
                <div className="theme-dropdown-label">{g.group}</div>
                {g.items.map(t => (
                  <button key={t.id} className={`theme-option${theme === t.id ? ' active' : ''}`}
                    onClick={() => { setTheme(t.id); setThemePickerOpen(false); }}>
                    <span className="theme-opt-icon">{t.icon}</span>
                    {t.label}
                    <span className="theme-opt-swatch" style={{ background: t.bg }} />
                  </button>
                ))}
              </div>
            ))}
            <div className="theme-dropdown-divider" />
            {isCustomThemeId(theme) && (
              <div className="theme-active-custom">
                <span className="theme-opt-icon">🎨</span>
                {findSavedTheme(theme)?.name ?? 'Custom'}
                <span className="theme-active-badge">active</span>
              </div>
            )}
            <button className={`theme-customize-btn${isCustomThemeId(theme) ? ' active' : ''}`}
              onClick={() => { setThemePickerOpen(false); setShowCustomizer(true); }}>
              🎨 Customize…
            </button>
          </div>
        </div>
      </div>
      {showShortcuts && (
        <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />
      )}
    </header>
  );
}

declare const __APP_VERSION__: string;
