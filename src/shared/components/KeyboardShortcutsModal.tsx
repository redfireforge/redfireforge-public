import AppModalFrame from './AppModalFrame';
import { GLOBAL_SHORTCUTS } from '@app/hooks/useAppShortcuts';
import { SHORTCUTS as WORKFLOW_SHORTCUTS } from '@workflow/components/canvas/WorkflowShortcutsOverlay';
import { REQUEST_SHORTCUTS } from '../../features/requests/hooks/useRequestShortcuts';
import type { ShortcutDef } from '@app/hooks/useAppShortcuts';

interface Props {
  onClose: () => void;
}

const ALL_SHORTCUTS: ShortcutDef[] = [
  ...GLOBAL_SHORTCUTS,
  ...WORKFLOW_SHORTCUTS,
  ...REQUEST_SHORTCUTS,
];

const CATEGORY_ORDER = ['Global', 'Canvas', 'Editing', 'Workflow', 'Requests'];

function getCategories(): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const cat of CATEGORY_ORDER) {
    if (ALL_SHORTCUTS.some((s) => s.category === cat)) {
      seen.add(cat);
      ordered.push(cat);
    }
  }
  for (const s of ALL_SHORTCUTS) {
    if (!seen.has(s.category)) {
      seen.add(s.category);
      ordered.push(s.category);
    }
  }
  return ordered;
}

function parseKeyParts(display: string): string[] {
  // Split on '+' but treat a trailing empty token as an artifact and
  // replace any remaining empty tokens with the literal '+' key.
  // e.g. '⌘++' → ['⌘','',''] → remove last '' → ['⌘',''] → map '' → ['⌘','+']
  const raw = display.split('+');
  const trimmed =
    raw.length > 1 && raw[raw.length - 1] === '' ? raw.slice(0, -1) : raw;
  return trimmed.map((p) => (p === '' ? '+' : p));
}

function ShortcutRow({ shortcut }: { shortcut: ShortcutDef }) {
  const parts = parseKeyParts(shortcut.display);
  return (
    <div className="ks-modal-row">
      <span className="ks-modal-label">{shortcut.label}</span>
      <div className="ks-modal-keys">
        {parts.map((part, i) => (
          <span key={i} className="ks-key-wrap">
            {i > 0 && <span className="ks-modal-sep" aria-hidden>+</span>}
            <kbd className="ks-modal-key">{part}</kbd>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function KeyboardShortcutsModal({ onClose }: Props) {
  const categories = getCategories();

  return (
    <AppModalFrame
      title="Keyboard shortcuts"
      onClose={onClose}
      overlayClassName="ks-modal-overlay"
      dialogClassName="ks-modal-shell"
      headerClassName="ks-modal-header"
      bodyClassName="ks-modal-body"
      footerClassName="ks-modal-footer"
      closeButtonKind="none"
      constrainDragToViewport
      dragViewportPadding={12}
      showResizeHandles={false}
      showExpandButton={false}
      titleId="ks-modal-title"
      dialogTestId="keyboard-shortcuts-modal"
      footer={
        <>
          <p className="ks-modal-hint">Esc to close · drag the title bar to move</p>
          <button
            type="button"
            className="btn btn-sm ks-modal-close-btn"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
          >
            Close
          </button>
        </>
      }
    >
      {categories.map((cat) => (
        <section key={cat} className="ks-modal-section">
          <h4 className="ks-modal-section-title">{cat}</h4>
          {ALL_SHORTCUTS.filter((s) => s.category === cat).map((s) => (
            <ShortcutRow key={s.key} shortcut={s} />
          ))}
        </section>
      ))}
    </AppModalFrame>
  );
}
