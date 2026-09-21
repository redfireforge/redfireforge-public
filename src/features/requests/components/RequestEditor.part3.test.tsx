/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { installClipboardMock } from '@test-utils/clipboardMock';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import RequestEditor from './RequestEditor';
import { ConsoleLine } from '../hooks/useResponseCache';
import { RequestCollection, RequestItem, RequestEnv } from '@shared/types';
import { httpFetch } from '@shared/utils/httpClient';
import { serializeWithContentType } from '@shared/utils/bodySerializer';
import { parseCurl } from '@shared/utils/curlParser';
import { buildCurlCommand } from '@shared/utils/curlGenerator';
import { HttpResponse } from '@shared/utils/httpClient';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

const responseCacheHarness = vi.hoisted(() => {
  type SendAllRow = { envName: string; response: HttpResponse; time: number };
  type HistPayload = Omit<import('../hooks/useResponseCache').ResponseHistoryEntry, 'id'>;

  const subscribers = new Set<() => void>();
  const notify = () => subscribers.forEach((cb) => cb());

  let histSeq = 0;

  const layer = {
    response: null as HttpResponse | null,
    responseTime: 0,
    sendAllResults: null as null | SendAllRow[],
    consoleLines: [] as ConsoleLine[],
    history: [] as Array<HistPayload & { id: string }>,
    pushHistory(entry: HistPayload) {
      const id = `h-${++histSeq}`;
      const full = { ...entry, id };
      layer.history = [full, ...layer.history];
      notify();
      return id;
    },
    setResponse(next: HttpResponse | null) {
      layer.response = next;
      notify();
    },
    setResponseTime(next: number) {
      layer.responseTime = next;
      notify();
    },
    setSendAllResults(next: null | SendAllRow[]) {
      layer.sendAllResults = next;
      notify();
    },
    setConsoleLines(next: ConsoleLine[]) {
      layer.consoleLines = next;
      notify();
    },
    restoreFromHistory: vi.fn(function restoreFromHistory(this: void, id: string) {
      const hit = layer.history.find(h => h.id === id);
      if (!hit) return;
      layer.response = hit.response;
      layer.responseTime = hit.responseTime;
      layer.consoleLines = hit.consoleLines;
      notify();
    }),
    deleteHistoryEntry: vi.fn((id: string) => {
      layer.history = layer.history.filter(h => h.id !== id);
      notify();
    }),
    clearHistory: vi.fn(() => {
      layer.history = [];
      layer.response = null;
      notify();
    }),
    reset() {
      histSeq = 0;
      layer.response = null;
      layer.responseTime = 0;
      layer.sendAllResults = null;
      layer.consoleLines = [];
      layer.history = [];
      vi.mocked(layer.deleteHistoryEntry).mockClear();
      vi.mocked(layer.clearHistory).mockClear();
      vi.mocked(layer.restoreFromHistory).mockClear();
      notify();
    },
    subscribe(fn: () => void) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
  return layer;
});

const responseCacheLayer = responseCacheHarness;

vi.mock('../../../shared/utils/fileSaver', () => ({
  saveFile: vi.fn(),
}));

vi.mock('../../../shared/utils/httpClient', () => ({
  httpFetch: vi.fn(),
}));

vi.mock('../../../shared/utils/bodySerializer', () => ({
  serializeWithContentType: vi.fn(() => ({ body: '', contentType: null })),
}));

vi.mock('../../../shared/utils/curlParser', () => ({
  parseCurl: vi.fn(),
}));

vi.mock('../../../shared/utils/curlGenerator', () => ({
  buildCurlCommand: vi.fn(),
}));

vi.mock('../../../shared/utils/applyAuthHeaders', () => ({
  applyAuthHeaders: vi.fn(),
}));

import { applyAuthHeaders } from '@shared/utils/applyAuthHeaders';

vi.mock('../../scenarios/utils/testEditorUtils', () => ({
  pickJsonFile: vi.fn(),
  unwrapImport: vi.fn(),
}));

vi.mock('../hooks/useResponseCache', async () => {
  const React = await import('react');

  function useBridgedLayer() {
    const [, bump] = React.useState(0);
    React.useEffect(
      () =>
        responseCacheHarness.subscribe(() => {
          bump((v) => v + 1);
        }),
      [],
    );
    return responseCacheHarness;
  }

  return {
    useResponseCache: (_id?: string) => useBridgedLayer(),
  };
});

const toastLayer = vi.hoisted(() => ({
  show: vi.fn(),
}));

vi.mock('../../../shared/hooks/useToast', () => ({
  useToast: () => toastLayer,
}));

function makeCollection(overrides?: Partial<RequestCollection>): RequestCollection {
  return {
    id: 'col-1',
    name: 'Test Collection',
    mode: 'direct',
    requests: [],
    auth: { type: 'none' },
    ...overrides,
  };
}

function makeRequest(overrides?: Partial<RequestItem>): RequestItem {
  return {
    id: 'req-1',
    name: 'Test Request',
    method: 'GET',
    url: '/api/users',
    headers: [{ key: '', value: '' }],
    body: '',
    auth: { type: 'none' },
    ...overrides,
  };
}

function makeEnvs(): RequestEnv[] {
  return [
    { id: 'env-1', name: 'Development' },
    { id: 'env-2', name: 'Production' },
  ];
}

const defaultProps = {
  collection: makeCollection(),
  request: makeRequest(),
  environments: makeEnvs(),
  onEnvChange: vi.fn(),
  onUpdateRequest: vi.fn(),
  appGlobalAuthProfiles: [],
};

describe('RequestEditor interaction branches', () => {

  beforeEach(() => {
    responseCacheLayer.reset();
    toastLayer.show.mockClear();
    vi.mocked(httpFetch).mockReset();
    vi.mocked(parseCurl).mockReset();
    vi.mocked(buildCurlCommand).mockReset();
    vi.mocked(serializeWithContentType).mockReturnValue({ body: '', contentType: null });
    vi.mocked(applyAuthHeaders).mockResolvedValue(undefined);
    resetAllMocks();
    installClipboardMock();
  });

  it('mirrors OAuth2-linked microservices into Authorization headers via global profiles', async () => {
    vi.mocked(httpFetch).mockResolvedValue({
      status: 204,
      statusText: '',
      headers: {},
      body: '',
    });
    render(
      <RequestEditor
        {...defaultProps}
        collection={makeCollection({
          mode: 'multi-env',
          microserviceId: 'svc-99',
          baseUrls: {},
        })}
        appMicroservices={[{
          id: 'svc-99',
          name: 'Bridge',
          baseUrls: { 'env-wb': 'https://bridge.example/api' },
          customEnvs: [],
          authProfileIds: { 'env-wb': 'gp-z' },
        }]}
        environments={[{ id: 'env-wb', name: 'WorkbenchEnv' }]}
        selectedEnvId="env-wb"
        request={makeRequest({ url: '/rel', auth: { type: 'inherit' } })}
        appGlobalAuthProfiles={[
          { id: 'gp-z', name: 'Z', auth: { type: 'bearer', token: 'jwt-z' } },
        ]}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    await waitFor(() =>
      expect(vi.mocked(applyAuthHeaders)).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'bearer', token: 'jwt-z' }),
        expect.any(Object),
      ),
    );

    await waitFor(() =>
      expect(vi.mocked(httpFetch)).toHaveBeenCalled(),
    );
    expect(screen.getByTitle('Response history')).not.toBeDisabled();
  });

  it('fans out JSON explorer controls after expandable payloads land', async () => {
    vi.mocked(httpFetch).mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{"tier":{"leaf":true}}',
    });

    render(
      <RequestEditor {...defaultProps} request={makeRequest({ url: 'https://tier.example/obj' })} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Expand All' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Expand All' }));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse All' }));
  });

  it('propagates body editor mutations back into the persisted request envelope', async () => {
    const onUpdateRequest = vi.fn();
    const panel = render(
      <RequestEditor
        {...defaultProps}
        onUpdateRequest={onUpdateRequest}
        request={makeRequest({ bodyType: 'json', body: '{}' })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Body\b/ }));

    const ta = panel.container.querySelector('.body-code-textarea') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    fireEvent.change(ta, { target: { value: '{"draft":42}' } });

    await waitFor(() =>
      expect(onUpdateRequest).toHaveBeenCalledWith(expect.objectContaining({ body: '{"draft":42}' })),
    );
  });

  it('copies regenerated cURL text through the clipboard bridge', async () => {
    vi.mocked(buildCurlCommand).mockResolvedValue('curl https://snippet');
    render(<RequestEditor {...defaultProps} request={makeRequest({ url: '/copy-sample' })} />);

    fireEvent.click(screen.getByTitle('Import / Export'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'cURL Export' }));
    });

    const curlPanel = document.querySelector('.req-curl-panel')!;

    await waitFor(() =>
      expect(within(curlPanel as HTMLElement).getByRole('button', { name: 'Refresh' })).toBeTruthy(),
    );

    await waitFor(() =>
      expect(within(curlPanel as HTMLElement).getByDisplayValue('curl https://snippet')).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.click(within(curlPanel as HTMLElement).getByRole('button', { name: 'Copy' }));
    });

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('curl https://snippet'),
    );
  });

  it('surfaces curl generation failures beside the exporter controls', async () => {
    vi.mocked(buildCurlCommand).mockRejectedValue(new Error('curl boom'));
    render(<RequestEditor {...defaultProps} request={makeRequest({ url: '/boom' })} />);

    fireEvent.click(screen.getByTitle('Import / Export'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'cURL Export' }));
    });

    await waitFor(() =>
      expect(screen.getByDisplayValue(/# Error: curl boom/u)).toBeTruthy(),
    );
  });

  it('reloads archived traffic into the investigator when picking prior history rows', async () => {
    vi.mocked(httpFetch).mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{"first":true}',
    });
    vi.mocked(httpFetch).mockResolvedValueOnce({
      status: 201,
      statusText: '',
      headers: {},
      body: '{"second":true}',
    });

    render(
      <RequestEditor {...defaultProps} request={makeRequest({ url: 'https://hist.example/track' })} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    await waitFor(() =>
      expect(responseCacheHarness.history.length).toBeGreaterThanOrEqual(1),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    await waitFor(() =>
      expect(responseCacheHarness.history.length).toBeGreaterThanOrEqual(2),
    );

    fireEvent.click(screen.getByTitle('Response history'));

    const entries = document.querySelectorAll('.resp-history-entry');
    expect(entries.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(entries[entries.length - 1] as HTMLElement);

    await waitFor(() =>
      expect(screen.queryByText('"first"')).toBeInTheDocument(),
    );
    expect(responseCacheHarness.restoreFromHistory).toHaveBeenCalled();
  });

  it('honors authPerEnv bearer overrides before collection defaults during sends', async () => {
    vi.mocked(httpFetch).mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, body: '{}' });
    render(
      <RequestEditor
        {...defaultProps}
        collection={makeCollection({
          mode: 'multi-env',
          baseUrls: { 'env-1': 'https://per-env.example/' },
          auth: { type: 'bearer', token: 'default' },
          authPerEnv: { 'env-1': { type: 'bearer', token: 'scoped' } },
        })}
        environments={makeEnvs()}
        selectedEnvId="env-1"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    await waitFor(() =>
      expect(vi.mocked(applyAuthHeaders)).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'scoped' }),
        expect.any(Object),
      ),
    );
  });

  it('falls back to raw stripping when pasted hosts are not tethered microservice prefixes', async () => {
    const onUpdateRequest = vi.fn();
    const pasted = 'https://%00.example/bad%%%';
    render(
      <RequestEditor
        {...defaultProps}
        onUpdateRequest={onUpdateRequest}
        collection={makeCollection({
          mode: 'multi-env',
          baseUrls: { 'env-1': 'https://known.example/api' },
        })}
        environments={makeEnvs()}
        selectedEnvId="env-1"
        request={makeRequest({ url: '/' })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('/v1/endpoint'), {
      target: { value: pasted },
    });

    await waitFor(() =>
      expect(onUpdateRequest).toHaveBeenCalledWith(expect.objectContaining({ url: pasted })),
    );
  });

  it('closes raw cURL import panels when cancelling back to builder state', async () => {
    render(<RequestEditor {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Import / Export'));
    fireEvent.click(screen.getByRole('button', { name: 'cURL Import' }));
    fireEvent.change(screen.getByPlaceholderText(/curl -X POST/), {
      target: { value: 'curl https://scratch.example/start' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByPlaceholderText(/curl -X POST/)).toBeNull();
  });

  it('updates templated URLs when catalog path placeholders change', async () => {
    const onUpdateRequest = vi.fn();
    render(
      <RequestEditor
        {...defaultProps}
        onUpdateRequest={onUpdateRequest}
        collection={makeCollection({
          mode: 'multi-env',
          baseUrls: { 'env-1': 'https://svc.test/api' },
        })}
        environments={makeEnvs()}
        selectedEnvId="env-1"
        request={makeRequest({
          url: '/widgets/LEGACY',
          savedPathParams: [{ key: 'widgetId', value: 'LEGACY', description: 'id', required: true }],
          catalogMeta: {
            operationId: 'w',
            originalPath: '/widgets/{widgetId}',
            tags: [],
            parameters: [],
            expectedResponses: [],
          },
        })}
      />,
    );

    const pathInput = await screen.findByPlaceholderText(/Enter widgetId/i);
    fireEvent.change(pathInput, { target: { value: 'NEXT' } });

    await waitFor(() =>
      expect(onUpdateRequest).toHaveBeenCalledWith(
        expect.objectContaining({ url: '/widgets/NEXT' }),
      ),
    );
  });

  it('extends header rows via the scaffold add-row control', async () => {
    const onUpdateRequest = vi.fn();
    render(
      <RequestEditor
        {...defaultProps}
        onUpdateRequest={onUpdateRequest}
        request={makeRequest({ headers: [{ key: 'A', value: '1' }] })}
      />,
    );

    const left = screen.getByText('Query Parameters').closest('.req-pane-left')!;
    fireEvent.click(within(left).getByRole('button', { name: /^Headers\b/ }));

    fireEvent.click(within(left).getByTestId('req-headers-add-btn'));

    await waitFor(() =>
      expect(onUpdateRequest).toHaveBeenCalledWith({
        headers: [
          { key: 'A', value: '1' },
          { key: '', value: '' },
        ],
      }),
    );
  });

  it('pins sidebar environment labels when drilling into sub-collections', () => {
    const { container } = render(
      <RequestEditor
        {...defaultProps}
        collection={makeCollection({
          mode: 'multi-env',
          baseUrls: { 'env-parent': 'https://parent.example/api' },
        })}
        environments={[
          { id: 'env-parent', name: 'ParentEnv' },
          { id: 'env-child', name: 'PinnedBox' },
        ]}
        parentSubCollection={{
          id: 'folder-1',
          name: 'PinnedBox',
          requests: [],
          isSubCollection: true,
          baseUrls: { 'env-parent': 'https://nested.example/host' },
        }}
      />,
    );

    expect(container.querySelector('.req-env-pill.pinned')).toHaveTextContent('PinnedBox');
  });

  it('captures outbound failures as synthetic zero-status responses while logging context', async () => {
    vi.mocked(httpFetch).mockRejectedValue(new Error('network offline'));
    const view = render(
      <RequestEditor {...defaultProps} request={makeRequest({ url: 'https://boom.example/down' })} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    await waitFor(() => {
      const pill = view.container.querySelector('.req-status-pill');
      expect(pill?.textContent ?? '').toMatch(/Error/);
      expect(pill).toHaveClass('error');
    });
    await waitFor(() =>
      expect(responseCacheHarness.history.length).toBeGreaterThanOrEqual(1),
    );
  });

  it('suppresses phantom microservice mappings when referenced auth profiles are absent', async () => {
    vi.mocked(httpFetch).mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, body: '{}' });

    render(
      <RequestEditor
        {...defaultProps}
        collection={makeCollection({
          mode: 'multi-env',
          microserviceId: 'svc-x',
          baseUrls: {},
        })}
        appMicroservices={[{
          id: 'svc-x',
          name: 'X',
          baseUrls: { 'env-wb': 'https://ghost.example/api' },
          authProfileIds: { 'env-wb': 'missing-profile' },
        }]}
        environments={[{ id: 'env-wb', name: 'WorkbenchEnv' }]}
        selectedEnvId="env-wb"
        appGlobalAuthProfiles={[]}
        request={makeRequest({ url: '/rel' })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    await waitFor(() =>
      expect(vi.mocked(httpFetch)).toHaveBeenCalled(),
    );

    expect(
      vi.mocked(applyAuthHeaders).mock.calls.filter((c) => (c[0] as { type?: string }).type !== 'none'),
    ).toHaveLength(0);
  });

  it('captures asynchronous curl generation faults in preview text', async () => {
    vi.mocked(buildCurlCommand).mockRejectedValueOnce(new Error('boom'));
    render(
      <RequestEditor
        {...defaultProps}
        request={makeRequest({ url: '/ok' })}
      />,
    );
    fireEvent.click(screen.getByTitle('Import / Export'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'cURL Export' }));
    });
    await waitFor(() => {
      const ta = document.querySelector('.req-curl-export') as HTMLTextAreaElement | null;
      expect(ta?.value ?? '').toMatch(/# Error: boom/);
    });
  });

  it('prefers bearer auth pinned on parent subcollections over inherited collection defaults', async () => {
    vi.mocked(httpFetch).mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, body: '{}' });
    render(
      <RequestEditor
        {...defaultProps}
        request={makeRequest({ url: 'https://svc.example/route', auth: { type: 'inherit' } })}
        collection={makeCollection({
          auth: { type: 'bearer', token: 'collection' },
        })}
        parentSubCollection={{
          id: 'nested',
          name: 'Partners',
          requests: [],
          auth: { type: 'bearer', token: 'subcol' },
        }}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    await waitFor(() =>
      expect(vi.mocked(applyAuthHeaders)).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'subcol' }),
        expect.any(Object),
      ),
    );
  });

  it('shows response header placeholder state when payloads omit headers', async () => {
    vi.mocked(httpFetch).mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '"ok"',
    });
    render(<RequestEditor {...defaultProps} request={makeRequest({ url: 'https://hdr.example/p' })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    const respTabs = document.querySelector('.req-resp-tabs');
    expect(respTabs).toBeTruthy();
    fireEvent.click(within(respTabs as HTMLElement).getByRole('button', { name: /^Headers\b/ }));

    await waitFor(() =>
      expect(screen.getByText('No response headers')).toBeInTheDocument(),
    );
  });

  it('shows request auth inspector when the Auth tab is activated', () => {
    const onUpdateRequest = vi.fn();
    render(
      <RequestEditor
        {...defaultProps}
        onUpdateRequest={onUpdateRequest}
        request={makeRequest({ auth: { type: 'bearer', token: 'keep' } })}
      />,
    );
    const requestTabs = document.querySelector('.req-pane-left .req-tabs');
    fireEvent.click(within(requestTabs as HTMLElement).getByRole('button', { name: /^Auth\b/ }));
    fireEvent.click(screen.getByRole('button', { name: /Bearer Token/i }));
    fireEvent.click(screen.getByRole('option', { name: /No Auth/i }));
    expect(onUpdateRequest).toHaveBeenCalledWith({ auth: { type: 'none' } });
  });

  it('renders an empty definition history explainer when snapshots are missing', () => {
    render(<RequestEditor {...defaultProps} request={makeRequest()} />);
    const requestTabs = document.querySelector('.req-pane-left .req-tabs');
    fireEvent.click(within(requestTabs as HTMLElement).getByRole('button', { name: /^History\b/ }));
    expect(screen.getByText('No definition history yet')).toBeInTheDocument();
  });

  it('strips the lone header row via the inline remove control', () => {
    const onUpdateRequest = vi.fn();
    const { container } = render(
      <RequestEditor
        {...defaultProps}
        onUpdateRequest={onUpdateRequest}
        request={makeRequest({ headers: [{ key: 'Solo', value: '1' }] })}
      />,
    );
    const requestTabs = document.querySelector('.req-pane-left .req-tabs');
    fireEvent.click(within(requestTabs as HTMLElement).getByRole('button', { name: /^Headers\b/ }));
    const removeBtn = (container.querySelector('.req-headers-editor') as HTMLElement).querySelector('button.ws-connect-kv-remove-btn');
    fireEvent.click(removeBtn!);
    expect(onUpdateRequest).toHaveBeenCalledWith({ headers: [] });
  });

  it('stacks another header row via the add control beside the bulk actions', () => {
    const onUpdateRequest = vi.fn();
    const { container } = render(
      <RequestEditor
        {...defaultProps}
        onUpdateRequest={onUpdateRequest}
        request={makeRequest({ headers: [{ key: 'First', value: '1' }] })}
      />,
    );
    const requestTabs = document.querySelector('.req-pane-left .req-tabs');
    fireEvent.click(within(requestTabs as HTMLElement).getByRole('button', { name: /^Headers\b/ }));

    fireEvent.click(within(container.querySelector('.req-headers-editor') as HTMLElement).getByTestId('req-headers-add-btn'));

    expect(onUpdateRequest).toHaveBeenCalledWith({
      headers: [
        { key: 'First', value: '1' },
        { key: '', value: '' },
      ],
    });
  });

  it('flushes structured headers via the sidebar delete-all control', () => {
    const onUpdateRequest = vi.fn();
    render(
      <RequestEditor
        {...defaultProps}
        onUpdateRequest={onUpdateRequest}
        request={makeRequest({ headers: [{ key: 'Gamma', value: 'value' }] })}
      />,
    );
    const requestTabs = document.querySelector('.req-pane-left .req-tabs');
    expect(requestTabs).toBeTruthy();
    fireEvent.click(within(requestTabs as HTMLElement).getByRole('button', { name: /^Headers\b/ }));
    fireEvent.click(screen.getByTestId('req-headers-delete-all-btn'));
    expect(onUpdateRequest).toHaveBeenCalledWith({ headers: [{ key: '', value: '' }] });
  });

  it('forwards pinned definition version deletes and rename commits', () => {
    const snapshot = {
      name: 'R',
      url: '/',
      method: 'GET' as const,
      headers: [{ key: 'Hdr', value: '1' }],
      body: '',
      auth: { type: 'none' as const },
    };
    const onUpdateRequest = vi.fn();

    render(
      <RequestEditor
        {...defaultProps}
        onUpdateRequest={onUpdateRequest}
        request={makeRequest({
          definitionVersions: [
            {
              id: 'ver-target',
              timestamp: 555,
              label: 'Quarterly checkpoint',
              snapshot,
            },
          ],
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^History\b/ }));

    const rail = screen.getByText('Request Definition History').closest('.test-def-version-panel')!;
    const row = rail.querySelector('.test-def-version-item') as HTMLElement;

    fireEvent.click(within(row).getByRole('button', { name: /Rename/ }));
    const labelInput = within(row).getByPlaceholderText('Version label…');
    fireEvent.change(labelInput, { target: { value: 'GA release' } });
    fireEvent.keyDown(labelInput, { key: 'Enter' });
    expect(onUpdateRequest).toHaveBeenCalled();

    vi.mocked(onUpdateRequest).mockClear();

    fireEvent.click(within(row).getByRole('button', { name: /Delete/ }));
    expect(onUpdateRequest).toHaveBeenCalled();
  });

});
