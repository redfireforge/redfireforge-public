import type { ShortcutDef } from '@app/hooks/useAppShortcuts';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl';

export const REQUEST_SHORTCUTS: ShortcutDef[] = [
  { key: 'mod+enter', category: 'Requests', label: 'Send request', display: `${MOD_LABEL}+↵` },
  { key: 'mod+t', category: 'Requests', label: 'New tab', display: `${MOD_LABEL}+T` },
  { key: 'mod+w', category: 'Requests', label: 'Close tab', display: `${MOD_LABEL}+W` },
  { key: 'mod+shift+i', category: 'Requests', label: 'Introspect schema (GraphQL)', display: `${MOD_LABEL}+⇧+I` },
];
