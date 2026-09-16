import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  onCurlImport: () => void;
  onCurlExport: () => void;
  onJsonImport: () => void;
  onJsonExport: () => void;
}

export default function RequestImportExportMenu({
  onCurlImport,
  onCurlExport,
  onJsonImport,
  onJsonExport,
}: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      if (!wasOpen && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
      }
      return !wasOpen;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.('[data-testid="req-action-dropdown"]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="req-action-menu-wrapper">
      <button
        ref={btnRef}
        type="button"
        className="req-action-menu-btn"
        data-testid="req-action-menu-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Import / Export"
        onClick={toggle}
      >
        Import / Export
      </button>
      {open && createPortal(
        <div
          className="req-action-dropdown req-action-dropdown--portal"
          data-testid="req-action-dropdown"
          style={{ top: pos.top, right: pos.right }}
          onClick={() => setOpen(false)}
        >
          <button type="button" data-testid="req-curl-import-btn" onClick={onCurlImport}>cURL Import</button>
          <button type="button" data-testid="req-curl-export-btn" onClick={onCurlExport}>cURL Export</button>
          <div className="req-dropdown-divider" />
          <button type="button" data-testid="req-json-import-btn" onClick={onJsonImport}>Import JSON</button>
          <button type="button" data-testid="req-json-export-btn" onClick={onJsonExport}>Export JSON</button>
        </div>,
        document.body,
      )}
    </div>
  );
}
