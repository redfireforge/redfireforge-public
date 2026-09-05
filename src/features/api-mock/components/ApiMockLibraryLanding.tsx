import type { ReactNode } from 'react';
import { isDesktopRuntimeAvailable } from '@shared/utils/platform';

interface Props {
  onCreate: () => void;
}

interface Feature {
  key: string;
  title: string;
  body: string;
  icon: ReactNode;
}

const FEATURES: Feature[] = [
  {
    key: 'routing',
    title: 'Rule-based routing',
    body: 'Match on method, path params, headers, query, and body. The highest-priority rule wins, so overlapping routes stay predictable.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="5" cy="6" r="2" />
        <circle cx="5" cy="18" r="2" />
        <circle cx="19" cy="12" r="2" />
        <path d="M7 6h5a5 5 0 0 1 5 5v.5M7 18h5a5 5 0 0 0 5-5v-.5" />
      </svg>
    ),
  },
  {
    key: 'templated',
    title: 'Templated responses',
    body: 'Return dynamic JSON with {{ }} helpers, custom status and headers, and per-variant selection — sequence, weighted, or stateful.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2" />
        <path d="M10 9l-1.5 3L10 15M14 9l1.5 3L14 15" />
      </svg>
    ),
  },
  {
    key: 'import',
    title: 'Import anything',
    body: 'Bootstrap a library from OpenAPI, cURL, WireMock, HAR, or captured requests. Everything lands as draft rules you review, then enable.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v11" />
        <path d="M8 10l4 4 4-4" />
        <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
    ),
  },
  {
    key: 'journal',
    title: 'Live request journal',
    body: 'Watch every incoming request in real time. Near-miss diagnostics explain why a request missed — promote a hit into a new rule in one click.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 9h8M8 13h8M8 17h5" />
      </svg>
    ),
  },
  {
    key: 'faults',
    title: 'Faults & latency',
    body: 'Inject timeouts, connection resets, and per-response delays so you can prove how a client behaves when the network turns hostile.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
        <path d="M12 12l3.5-3.5M12 12l-3.5 3.5" />
      </svg>
    ),
  },
  {
    key: 'conflicts',
    title: 'Conflict analysis',
    body: 'Static analysis flags duplicate, shadowed, and overlapping rules — with the winning selection outcome — before they ever reach a caller.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3l9 16H3l9-16z" />
        <path d="M12 10v4M12 17h.01" />
      </svg>
    ),
  },
  {
    key: 'simulate',
    title: 'Simulate & verify',
    body: 'Fire a request through the matcher without starting the server to see which rule wins and the exact reply. Save samples with expectations and replay them as a test suite.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 5v14l11-7-11-7z" />
      </svg>
    ),
  },
  {
    key: 'proxy',
    title: 'Proxy passthrough',
    body: 'Forward requests you have not mocked yet to a real upstream, then record the live responses back as draft rules you can trim and edit.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 8h13l-3-3M20 16H7l3 3" />
      </svg>
    ),
  },
  {
    key: 'cli',
    title: 'CLI & CI ready',
    body: 'Boot a mock server or run a simulation suite headless from the command line, then wire those checks straight into your CI pipeline.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 9l3 3-3 3M13 15h4" />
      </svg>
    ),
  },
];

/**
 * Shown when no mock server tab is open — including a brand-new empty library.
 * The Mock Servers list lives in the left sidebar; this pane explains what the
 * API Mock studio does with a request-flow diagram and a feature overview, then
 * offers the same "create server" action as the sidebar's + New button.
 */
export function ApiMockLibraryLanding({ onCreate }: Props) {
  const hostedWeb = !isDesktopRuntimeAvailable();

  return (
    <div className="am-library-landing" data-testid="api-mock-library-landing">
      {hostedWeb && (
        <div className="am-landing-desktop-notice" data-testid="api-mock-landing-desktop-notice" role="status">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
          <span>
            <strong>Server runtime requires the desktop app.</strong>{' '}
            You can explore routes and import specs in the browser, but starting a live server requires{' '}
            <a
              href="https://github.com/redfireforge/redfireforge-public/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="am-notice-link"
            >
              RedfireForge for desktop
            </a>.
          </span>
        </div>
      )}
      <div className="am-landing-inner">
        <header className="am-landing-hero">
          <div className="am-landing-hero-text">
            <span className="am-landing-eyebrow">API Mock Studio</span>
            <p>
              Stand up a local HTTP mock in seconds — rule-based routes, templated responses, and a live
              request journal. Pick a server from <strong>Mock Servers</strong> on the left, or start a new one.
            </p>
          </div>
          <div className="am-empty-actions am-landing-hero-actions">
            <button className="am-btn primary" onClick={onCreate} data-testid="api-mock-landing-create">
              New mock server
            </button>
          </div>
        </header>

        <section className="am-landing-flow" aria-label="How the mock answers a request">
          <h3 className="am-landing-section-title">How a request gets answered</h3>
          <svg
            className="am-landing-flow-svg"
            viewBox="0 0 780 232"
            role="img"
            aria-label="A client request is matched against rules, returns a templated response, and is recorded in the journal"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <marker id="amFlowArrow" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L6,3 L0,6 Z" fill="#74a7e8" />
              </marker>
            </defs>

            {/* Client */}
            <rect x="16" y="40" width="150" height="86" rx="10" fill="#1e293b" stroke="#3b4a60" />
            <text x="91" y="70" textAnchor="middle" fill="#f1f5f9" fontFamily="system-ui" fontSize="13" fontWeight="600">Your app</text>
            <text x="91" y="92" textAnchor="middle" fill="#a8b8cc" fontFamily="system-ui" fontSize="11">sends a request</text>
            <text x="91" y="110" textAnchor="middle" fill="#74a7e8" fontFamily="ui-monospace, monospace" fontSize="11">GET /orders/42</text>

            {/* arrow 1 */}
            <line x1="170" y1="83" x2="300" y2="83" stroke="#74a7e8" strokeWidth="1.6" markerEnd="url(#amFlowArrow)" />

            {/* Mock server / rule match */}
            <rect x="304" y="24" width="180" height="118" rx="10" fill="#1e293b" stroke="#55c2a3" />
            <text x="394" y="48" textAnchor="middle" fill="#55c2a3" fontFamily="system-ui" fontSize="13" fontWeight="600">Mock server</text>
            <text x="394" y="66" textAnchor="middle" fill="#a8b8cc" fontFamily="system-ui" fontSize="10.5">match by priority</text>
            <rect x="322" y="78" width="144" height="20" rx="5" fill="#0f172a" stroke="#3b4a60" />
            <text x="332" y="92" fill="#55c2a3" fontFamily="ui-monospace, monospace" fontSize="10">GET /orders/&#123;id&#125;</text>
            <rect x="322" y="104" width="144" height="20" rx="5" fill="#0f172a" stroke="#3b4a60" />
            <text x="332" y="118" fill="#a8b8cc" fontFamily="ui-monospace, monospace" fontSize="10">POST /orders</text>

            {/* arrow 2 */}
            <line x1="488" y1="83" x2="614" y2="83" stroke="#74a7e8" strokeWidth="1.6" markerEnd="url(#amFlowArrow)" />

            {/* Response */}
            <rect x="618" y="40" width="150" height="86" rx="10" fill="#1e293b" stroke="#a78bfa" />
            <text x="693" y="66" textAnchor="middle" fill="#a78bfa" fontFamily="system-ui" fontSize="13" fontWeight="600">Templated reply</text>
            <text x="693" y="88" textAnchor="middle" fill="#a8b8cc" fontFamily="system-ui" fontSize="10.5">status · headers · body</text>
            <text x="693" y="106" textAnchor="middle" fill="#22c55e" fontFamily="ui-monospace, monospace" fontSize="11">200 · JSON</text>

            {/* journal strip */}
            <line x1="394" y1="142" x2="394" y2="170" stroke="#64748b" strokeWidth="1.4" strokeDasharray="3 3" markerEnd="url(#amFlowArrow)" />
            <rect x="150" y="172" width="488" height="44" rx="8" fill="#131c2e" stroke="#3b4a60" />
            <text x="170" y="190" fill="#f1f5f9" fontFamily="system-ui" fontSize="11" fontWeight="600">Live journal</text>
            <text x="170" y="206" fill="#a8b8cc" fontFamily="system-ui" fontSize="10.5">records every hit and miss · replay it · promote a miss into a new rule</text>
            <circle cx="620" cy="194" r="4" fill="#22c55e" />
          </svg>
        </section>

        <section className="am-landing-features" aria-label="What the API Mock studio can do">
          <h3 className="am-landing-section-title">What you can build here</h3>
          <div className="am-landing-grid">
            {FEATURES.map((f) => (
              <article key={f.key} className="am-landing-card" data-testid={`api-mock-landing-feature-${f.key}`}>
                <span className="am-landing-card-icon" aria-hidden="true">{f.icon}</span>
                <div className="am-landing-card-body">
                  <h4>{f.title}</h4>
                  <p>{f.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
