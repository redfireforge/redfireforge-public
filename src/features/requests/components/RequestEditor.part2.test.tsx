/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { installClipboardMock } from '@test-utils/clipboardMock';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import RequestEditor from './RequestEditor';
import type { ConsoleLine } from '../hooks/useResponseCache';
import type { RequestCollection, RequestItem, RequestEnv } from '@shared/types';
import { httpFetch } from '@shared/utils/httpClient';
import { serializeWithContentType } from '@shared/utils/bodySerializer';
import { parseCurl } from '@shared/utils/curlParser';
import { buildCurlCommand } from '@shared/utils/curlGenerator';
import type { HttpResponse } from '@shared/utils/httpClient';

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

  it('enters request title edit mode via display row', () => {
    const onUpdateRequest = vi.fn();
    render(<RequestEditor {...defaultProps} onUpdateRequest={onUpdateRequest} request={makeRequest({ name: 'Alpha' })} />);
    fireEvent.click(screen.getByText('Alpha'));
    const input = screen.getByDisplayValue('Alpha');
    fireEvent.change(input, { target: { value: 'Omega' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdateRequest).toHaveBeenCalledWith(expect.objectContaining({ name: 'Omega' }));
  });

  it('shows multi-env resolver hint whenever base urls stay empty', () => {
    render(
      <RequestEditor
        {...defaultProps}
        collection={makeCollection({ mode: 'multi-env', baseUrls: {} })}
        environments={makeEnvs()}
        selectedEnvId="env-1"
      />,
    );
    expect(screen.getByText(/Base URLs not configured/)).toBeInTheDocument();
  });

  it('pins environments from sub-collection context when provided', () => {
    render(
      <RequestEditor
        {...defaultProps}
        collection={makeCollection({ mode: 'multi-env' })}
        environments={makeEnvs()}
        parentSubCollection={{
          id: 'sc',
          name: 'Staging',
          requests: [],
          baseUrls: { 'env-1': 'https://staging.example/' },
          selectedEnvId: 'env-1',
        }}
      />,
    );
    expect(screen.getByTitle(/https:\/\/staging\.example/)).toBeInTheDocument();
  });

  it('captures Curl generation failures in the exporter textarea', async () => {
    vi.mocked(buildCurlCommand).mockRejectedValueOnce(new Error('signing failed'));

    render(
      <RequestEditor
        {...defaultProps}
        request={makeRequest({ url: 'https://api.example.com/x' })}
      />,
    );
    fireEvent.click(screen.getByTitle('Import / Export'));
    fireEvent.click(screen.getByRole('button', { name: 'cURL Export' }));

    await waitFor(() => {
      expect(screen.getByDisplayValue(/# Error: signing failed/)).toBeInTheDocument();
    });
  });

  it('styles intermediate HTTP responses with warn pills', async () => {
    vi.mocked(httpFetch).mockResolvedValue({
      status: 304,
      statusText: 'Not Modified',
      headers: {},
      body: '',
    });
    const view = render(
      <RequestEditor
        {...defaultProps}
        request={makeRequest({ url: 'https://etag.example/asset' })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    await waitFor(() => {
      const pill = view.container.querySelector('.req-status-pill.warn');
      expect(pill?.textContent ?? '').toContain('304');
    });
  });

  it('mentions Basic and API Key strategies inside console logs while sending', async () => {
    vi.mocked(httpFetch).mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, body: '{}' });

    const { rerender } = render(
      <RequestEditor
        {...defaultProps}
        request={makeRequest({
          url: 'https://svc.example/ping',
          auth: { type: 'basic', username: 'u', password: 'p' },
        })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    fireEvent.click(screen.getByRole('button', { name: /^Console\b/ }));

    await waitFor(() => {
      expect(screen.getByText(/Using Basic authentication/)).toBeInTheDocument();
    });

    rerender(
      <RequestEditor
        {...defaultProps}
        request={makeRequest({
          url: 'https://svc.example/ping',
          auth: { type: 'apikey', apiKeyName: 'k', apiKeyValue: 'v', apiKeyIn: 'query' },
        })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    fireEvent.click(screen.getByRole('button', { name: /^Console\b/ }));
    await waitFor(() => {
      expect(screen.getByText(/Using API Key in query/)).toBeInTheDocument();
    });
  });

  it('overrides Content-Type whenever multipart payloads ship custom boundaries', async () => {
    vi.mocked(serializeWithContentType).mockReturnValue({
      body: 'parts',
      contentType: 'multipart/form-data; boundary=abc123',
    });
    vi.mocked(httpFetch).mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{}',
    });

    render(
      <RequestEditor
        {...defaultProps}
        request={makeRequest({
          url: 'https://multipart.example/up',
          headers: [{ key: 'Content-Type', value: 'text/plain' }],
        })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    await waitFor(() => {
      const headersPassed = vi.mocked(httpFetch).mock.calls.at(-1)?.[2] as Record<string, string> | undefined;
      expect(headersPassed?.['Content-Type']).toContain('multipart/form-data');
    });
  });

  it('keeps Saved Query rows independent from URL fragments', async () => {
    const onUpdateRequest = vi.fn();
    render(
      <RequestEditor
        {...defaultProps}
        onUpdateRequest={onUpdateRequest}
        request={makeRequest({
          url: '/api/things?page=99',
          savedQueryParams: [
            { key: 'page', value: '99', enabled: false, description: '' },
          ],
        })}
      />,
    );

    const paramsRoot = screen.getByText('Query Parameters').closest('.params-editor')!;
    const pageInput = await within(paramsRoot).findByDisplayValue('99');
    fireEvent.change(pageInput, { target: { value: '100' } });

    await waitFor(() =>
      expect(onUpdateRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          savedQueryParams: expect.arrayContaining([
            expect.objectContaining({ key: 'page', enabled: false, value: '100' }),
          ]),
        }),
      ),
    );
  });

  it('reorders response search matches circularly via chevron controls', async () => {
    vi.mocked(httpFetch).mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: JSON.stringify({ a: 'needle', b: 'needle' }),
    });
    render(
      <RequestEditor
        {...defaultProps}
        request={makeRequest({ url: 'https://search.example/find' })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    const searchBox = await screen.findByPlaceholderText('Search response...');
    fireEvent.change(searchBox, { target: { value: 'needle' } });
    await waitFor(() => expect(screen.getByText('1/2')).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('Previous'));
    await waitFor(() => expect(screen.getByText('2/2')).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('Next'));
    await waitFor(() => expect(screen.getByText('1/2')).toBeInTheDocument());
  });

  it('focuses catalog path placeholders when endpoints declare templates', async () => {
    const meta = {
      operationId: 'vehicles',
      description: '',
      originalPath: '/fleet/{fleetId}',
      tags: [],
      parameters: [],
      expectedResponses: [],
    };
    render(
      <RequestEditor
        {...defaultProps}
        request={makeRequest({
          url: '/fleet/abc123',
          catalogMeta: meta,
          savedPathParams: [{ key: 'fleetId', value: 'abc123', required: false, description: '' }],
        })}
      />,
    );
    const pathInput = await screen.findByPlaceholderText('Enter fleetId');
    expect(pathInput).toHaveValue('abc123');
  });

  it('reveals bearer auth tab marker when auth diverges from collection defaults', () => {
    render(
      <RequestEditor
        {...defaultProps}
        request={makeRequest({
          auth: { type: 'bearer', token: 'masked' },
        })}
      />,
    );
    expect(document.querySelector('.req-tab-dot')).toBeTruthy();
  });

  it('fires delete-all headers via toolbar shortcut', async () => {
    const onUpdateRequest = vi.fn();
    render(
      <RequestEditor
        {...defaultProps}
        onUpdateRequest={onUpdateRequest}
        request={makeRequest({
          headers: [
            { key: 'Authorization', value: 'token' },
            { key: 'X-Trace', value: 'yes' },
          ],
        })}
      />,
    );
    const reqPaneLeft = screen.getByText('Query Parameters').closest('.req-pane-left')!;
    fireEvent.click(within(reqPaneLeft).getByRole('button', { name: /^Headers\b/ }));
    fireEvent.click(screen.getByTestId('req-headers-delete-all-btn'));
    expect(onUpdateRequest).toHaveBeenCalledWith({ headers: [{ key: '', value: '' }] });
  });

  it('renders pinned env pills when catalog links microservice mappings', async () => {
    render(
      <RequestEditor
        {...defaultProps}
        collection={
          makeCollection({
            mode: 'multi-env',
            microserviceId: 'svc-1',
            baseUrls: { 'env-1': 'https://tenant.dev.example/api' },
          })
        }
        appMicroservices={[{
          id: 'svc-1',
          name: 'Orders',
          baseUrls: { 'env-1': 'https://tenant.dev.example/api' },
        }]}
      />,
    );
    expect(screen.getAllByRole('button', { name: /Development/ })[0]).toBeTruthy();
    expect(screen.queryByText(/Base URLs not configured/)).toBeNull();
  });

  it('drops env pills lacking microservice mappings', () => {
    render(
      <RequestEditor
        {...defaultProps}
        collection={
          makeCollection({
            mode: 'multi-env',
            microserviceId: 'svc-1',
            baseUrls: {
              'env-1': 'https://tenant.dev.example/api',
            },
          })
        }
        environments={[
          ...makeEnvs(),
          { id: 'env-isolated', name: 'Sandbox' },
        ]}
        appMicroservices={[{
          id: 'svc-1',
          name: 'Orders',
          baseUrls: { 'env-1': 'https://tenant.dev.example/api' },
        }]}
      />,
    );
    expect(screen.getByRole('button', { name: /Development/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sandbox\b/ })).toBeNull();
  });

  it('folds pasted absolute URLs down to canonical relative paths', async () => {
    const onUpdateRequest = vi.fn();
    render(
      <RequestEditor
        {...defaultProps}
        onUpdateRequest={onUpdateRequest}
        collection={makeCollection({
          mode: 'multi-env',
          baseUrls: { 'env-1': 'https://multi.example/api/' },
        })}
        environments={makeEnvs()}
        selectedEnvId="env-1"
        request={makeRequest({ url: '/keep' })}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('/v1/endpoint'), {
      target: { value: 'https://multi.example/api/other?flag=1' },
    });
    await waitFor(() =>
      expect(onUpdateRequest).toHaveBeenCalledWith(
        expect.objectContaining({ url: '/other?flag=1' }),
      ),
    );
  });

  it('discards dangling curl drafts when navigating to another snapshot', async () => {
    const view = render(
      <RequestEditor
        {...defaultProps}
        request={makeRequest({ id: 'req-a', url: 'https://a.example/ping' })}
      />,
    );
    fireEvent.click(screen.getByTitle('Import / Export'));
    fireEvent.click(screen.getByRole('button', { name: 'cURL Import' }));
    fireEvent.change(screen.getByPlaceholderText(/curl -X POST/), {
      target: { value: 'curl https://x' },
    });

    view.rerender(
      <RequestEditor
        {...defaultProps}
        request={makeRequest({ id: 'req-b', url: 'https://b.example/pong' })}
      />,
    );

    await waitFor(() => expect(screen.queryByPlaceholderText(/curl -X POST/)).toBeNull());
  });

  it('shows Body authoring controls after switching tabs', () => {
    render(<RequestEditor {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /^Body\b/ }));
    expect(document.querySelector('.body-type-trigger')).toHaveTextContent(/No Body/u);
  });

  it('fires removeHeader for the earliest KV pairs', async () => {
    const onUpdateRequest = vi.fn();
    render(
      <RequestEditor
        {...defaultProps}
        onUpdateRequest={onUpdateRequest}
        request={makeRequest({
          headers: [
            { key: 'Alpha', value: '1' },
            { key: 'Beta', value: '2' },
          ],
        })}
      />,
    );
    const pane = screen.getByText('Query Parameters').closest('.req-pane-left')!;
    fireEvent.click(within(pane).getByRole('button', { name: /^Headers\b/ }));
    fireEvent.click(document.querySelector('.ws-connect-kv-remove-btn')!);

    await waitFor(() =>
      expect(onUpdateRequest).toHaveBeenCalledWith({
        headers: [{ key: 'Beta', value: '2' }],
      }),
    );
  });

  it('falls back to raw preview when payloads are not strict JSON', async () => {
    vi.mocked(httpFetch).mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{oops',
    });
    const view = render(
      <RequestEditor
        {...defaultProps}
        request={makeRequest({ url: 'https://parse.example/stream' })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    await waitFor(() =>
      expect(view.container.querySelector('.jt-raw')).toBeTruthy(),
    );
  });

  it('resets investigator search facets after dismiss control', async () => {
    vi.mocked(httpFetch).mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{"needle":true}',
    });
    const view = render(
      <RequestEditor {...defaultProps} request={makeRequest({ url: 'https://needle.example/find' })} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    const input = await screen.findByPlaceholderText('Search response...');
    fireEvent.change(input, { target: { value: 'needle' } });

    await waitFor(() => expect(view.container.querySelector('.req-resp-search-clear')).not.toBeNull());
    fireEvent.click(view.container.querySelector('.req-resp-search-clear')!);

    expect(input).toHaveValue('');
  });

  it('surfaces Headers tab empty hints for headerless payloads', async () => {
    vi.mocked(httpFetch).mockResolvedValue({
      status: 204,
      statusText: 'No Content',
      headers: {},
      body: '',
    });
    const view = render(
      <RequestEditor
        {...defaultProps}
        request={makeRequest({ url: 'https://nocontent.example/ok' })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    await waitFor(() =>
      expect(view.container.querySelector('.req-status-pill')).toHaveTextContent('204'),
    );

    const respPane = view.container.querySelector('.req-pane-right')!;
    fireEvent.click(within(respPane).getByRole('button', { name: /^Headers\b/ }));

    await waitFor(() =>
      expect(screen.getByText('No response headers')).toBeVisible(),
    );
  });

  it('removes pinned response visuals when deleting the active history snapshot', async () => {
    vi.mocked(httpFetch).mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{"a":true}',
    });
    const view = render(
      <RequestEditor {...defaultProps} request={makeRequest({ url: 'https://hist.example/ping' })} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    await waitFor(() =>
      expect(responseCacheHarness.history.length).toBeGreaterThanOrEqual(1),
    );

    fireEvent.click(screen.getByTitle('Response history'));
    fireEvent.click(screen.getByRole('button', { name: /Delete Current Response/ }));

    await waitFor(() => {
      expect(responseCacheHarness.response).toBeNull();
      expect(view.container.querySelector('.req-status-pill')).toBeNull();
    });
  });

  it('flushes persisted snapshots via clear history controls', async () => {
    vi.mocked(httpFetch).mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{}',
    });
    render(
      <RequestEditor {...defaultProps} request={makeRequest({ url: 'https://hist.example/x' })} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    await waitFor(() =>
      expect(responseCacheHarness.history.length).toBeGreaterThanOrEqual(1),
    );

    fireEvent.click(screen.getByTitle('Response history'));
    fireEvent.click(screen.getByRole('button', { name: /Clear History/ }));

    await waitFor(() => {
      expect(responseCacheHarness.history).toHaveLength(0);
      expect(responseCacheHarness.response).toBeNull();
    });

    expect(screen.getByTitle('Response history')).toBeDisabled();
  });

  it('guides cURL export when no sendable URL fragment exists yet', async () => {
    render(
      <RequestEditor
        {...defaultProps}
        request={makeRequest({ url: '   ', method: 'GET' })}
      />,
    );

    fireEvent.click(screen.getByTitle('Import / Export'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'cURL Export' }));
    });

    await waitFor(() =>
      expect(vi.mocked(buildCurlCommand)).not.toHaveBeenCalled(),
    );
    expect(screen.getByText('Set a URL first.')).toBeTruthy();
  });

});
