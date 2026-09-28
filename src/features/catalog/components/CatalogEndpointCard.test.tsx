/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { selectOption, getCustomSelectValue } from '@test-utils/customSelectHelper';
import CatalogEndpointCard from './CatalogEndpointCard';
import { resolveBaseUrl } from '../utils/catalogCurlGenerator';
import { makeEndpoint, makeServer, makeParam, makeResponse, makeHostConfig } from './catalogTestFactories';
import type { AuthConfig } from '@shared/types';
import type { EndpointCoverage } from '../utils/coverageChecker';

const httpFetchMock = vi.hoisted(() => vi.fn());
const applyAuthMock = vi.hoisted(() => vi.fn());
const copyMock = vi.hoisted(() => vi.fn());
const copiedState = vi.hoisted(() => ({ value: false }));
const buildCatalogCurlCommandMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve("curl -X POST \\\n  'https://api.example.com/users' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"a\":1}'")),
);
const buildCatalogCurlSingleLineMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve("curl -X POST 'https://api.example.com/users'")),
);

vi.mock('../utils/schemaStubGenerator', () => ({
  generateStubJson: () => '{\n  "stub": true\n}',
}));
vi.mock('../../../shared/utils/jsonHighlighter', () => ({
  highlightJson: (s: string) => s,
}));
vi.mock('../utils/catalogCurlGenerator', () => ({
  buildCatalogCurlCommand: buildCatalogCurlCommandMock,
  buildCatalogCurlSingleLine: buildCatalogCurlSingleLineMock,
  buildDefaultCurlCommand: () => Promise.resolve('curl default'),
  resolveBaseUrl: vi.fn(() => 'https://api.example.com'),
  buildFullUrl: () => 'https://api.example.com/users/123',
}));
vi.mock('../../../shared/utils/httpClient', () => ({
  httpFetch: httpFetchMock,
}));
vi.mock('../../../shared/utils/applyAuthHeaders', () => ({
  applyAuthHeaders: applyAuthMock,
}));
vi.mock('../../../shared/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => [copiedState.value, copyMock],
}));

const noAuth: AuthConfig = { type: 'none' };
const server = makeServer();
const hostConfig = makeHostConfig({ strategy: 'global' });

function renderCard(props: Partial<React.ComponentProps<typeof CatalogEndpointCard>> = {}) {
  const onValuesChange = vi.fn();
  const onExportSingle = vi.fn();
  const onSendToHarness = vi.fn();
  const onSetWorkflowExposure = vi.fn();
  const onNavigateToRequest = vi.fn();
  render(
    <CatalogEndpointCard
      endpoint={props.endpoint ?? makeEndpoint()}
      servers={[server]}
      hostConfig={props.hostConfig ?? hostConfig}
      auth={props.auth ?? noAuth}
      savedValues={props.savedValues}
      onValuesChange={onValuesChange}
      onExportSingle={onExportSingle}
      onSendToHarness={onSendToHarness}
      onSetWorkflowExposure={onSetWorkflowExposure}
      onNavigateToRequest={onNavigateToRequest}
      coverage={props.coverage}
    />,
  );
  return { onValuesChange, onExportSingle, onSendToHarness, onSetWorkflowExposure, onNavigateToRequest };
}

beforeEach(() => {
  resetAllMocks();
  copiedState.value = false;
  httpFetchMock.mockResolvedValue({ status: 200, statusText: 'OK', headers: { 'x-foo': 'bar' }, body: '{"ok":true}' });
  applyAuthMock.mockResolvedValue(undefined);
});

describe('CatalogEndpointCard', () => {
  it('renders collapsed header and expands on click', async () => {
    renderCard();
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('/users/{id}')).toBeInTheDocument();
    expect(screen.getByText('Get user')).toBeInTheDocument();
    await userEvent.click(screen.getByText('/users/{id}'));
    // No-parameter endpoints omit the empty Parameters section
    expect(screen.queryByText('No parameters')).not.toBeInTheDocument();
    expect(screen.getByTestId('catalog-tryit-btn')).toBeInTheDocument();
  });

  it('shows Parameters section only when the endpoint has parameters', async () => {
    renderCard({ endpoint: makeEndpoint({ parameters: [makeParam({ name: 'id', in: 'query' })] }) });
    await userEvent.click(screen.getByText('/users/{id}'));
    expect(screen.getByText('Parameters')).toBeInTheDocument();
    expect(screen.queryByText('No parameters')).not.toBeInTheDocument();
  });

  it('expands via keyboard Enter and space', () => {
    renderCard();
    const header = screen.getByText('/users/{id}').closest('.sw-header')!;
    fireEvent.keyDown(header, { key: 'Enter' });
    expect(screen.getByTestId('catalog-tryit-btn')).toBeInTheDocument();
    fireEvent.keyDown(header, { key: ' ' });
  });

  it('renders deprecated and lock badges', () => {
    renderCard({ endpoint: makeEndpoint({ deprecated: true, security: [{ name: 'apiKey', scopes: [] }] }) });
    expect(screen.getByText('deprecated')).toBeInTheDocument();
    expect(screen.getByText('🔒')).toBeInTheDocument();
  });

  it('shows coverage badge, opens popover and navigates', async () => {
    const coverage: EndpointCoverage = {
      exported: true,
      count: 2,
      locations: [
        { collectionId: 'c1', requestId: 'r1', folderPath: 'Coll / Folder' },
        { collectionId: 'c2', requestId: 'r2', folderPath: 'Coll / Other' },
      ],
    };
    const { onNavigateToRequest } = renderCard({ coverage });
    await userEvent.click(screen.getByText('IN REQUESTS (2)'));
    expect(screen.getByText('Exported to 2 requests')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Coll / Folder'));
    expect(onNavigateToRequest).toHaveBeenCalledWith('c1', 'r1');
  });

  it('toggles coverage popover via keyboard', () => {
    const coverage: EndpointCoverage = {
      exported: true,
      count: 1,
      locations: [{ collectionId: 'c1', requestId: 'r1', folderPath: 'Coll / F' }],
    };
    renderCard({ coverage });
    const badge = screen.getByText('IN REQUESTS');
    fireEvent.keyDown(badge, { key: 'Enter' });
    expect(screen.getByText('Exported to 1 request')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  });

  it('opens context menu and copies default curl', async () => {
    renderCard();
    const header = screen.getByText('/users/{id}').closest('.sw-header')!;
    fireEvent.contextMenu(header);
    const copyItem = screen.getByText('Copy as cURL');
    await userEvent.click(copyItem);
    await waitFor(() => expect(copyMock).toHaveBeenCalledWith('curl default'));
  });

  it('renders parameters with enum, default and try-it-out inputs', async () => {
    const endpoint = makeEndpoint({
      description: 'Fetch a user',
      parameters: [
        makeParam({ name: 'id', in: 'path', required: true, description: 'User id', example: 'abc' }),
        makeParam({ name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['a', 'b'], default: 'a' } }),
        makeParam({ name: 'X-Tok', in: 'header', required: false }),
      ],
    });
    renderCard({ endpoint });
    fireEvent.click(screen.getByText('/users/{id}'));
    expect(screen.getByText('Fetch a user')).toBeInTheDocument();
    expect(screen.getByText(/Available values:/)).toBeInTheDocument();
    expect(screen.getByText(/Default value:/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('Try it out'));
    const idInput = screen.getByPlaceholderText('abc') as HTMLInputElement;
    await userEvent.type(idInput, '123');
    expect(idInput.value).toBe('123');
    const enumSelect = document.querySelector('.cs-wrapper.sw-pinput')!;
    selectOption(enumSelect, 'b');
    expect(getCustomSelectValue(enumSelect)).toBe('b');
    await userEvent.click(screen.getByText('Cancel'));
  });

  it('calls onValuesChange when a parameter value changes', async () => {
    const endpoint = makeEndpoint({ parameters: [makeParam({ name: 'id', in: 'query' })] });
    const { onValuesChange } = renderCard({ endpoint });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.type(screen.getByPlaceholderText('id'), 'x');
    await waitFor(() => expect(onValuesChange).toHaveBeenCalled());
  });

  it('renders request body example and edits in try-it-out', async () => {
    const endpoint = makeEndpoint({
      method: 'POST',
      requestBody: { required: true, contentTypes: [{ mediaType: 'application/json', schema: { type: 'object' } }] },
    });
    renderCard({ endpoint });
    fireEvent.click(screen.getByText('/users/{id}'));
    expect(screen.getByText('Request body')).toBeInTheDocument();
    expect(screen.getByText('application/json')).toBeInTheDocument();
    expect(screen.getByText('required')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Try it out'));
    const ta = document.querySelector('textarea.sw-body-editor') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    fireEvent.change(ta, { target: { value: '{"x":1}' } });
    expect(ta.value).toBe('{"x":1}');
  });

  it('executes and shows a successful live response', async () => {
    const endpoint = makeEndpoint({ method: 'POST', requestBody: { required: false, contentTypes: [{ mediaType: 'application/json', schema: {} }] } });
    renderCard({ endpoint });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.click(screen.getByText('Execute'));
    await waitFor(() => expect(screen.getByText('Server response')).toBeInTheDocument());
    expect(screen.getAllByText('200').length).toBeGreaterThan(0);
    expect(screen.getByText('Response headers')).toBeInTheDocument();
  });

  it('shows Send to Harness button on a 2xx response', async () => {
    const { onSendToHarness } = renderCard();
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.click(screen.getByText('Execute'));
    await waitFor(() => expect(screen.getAllByText('Send to Harness').length).toBeGreaterThanOrEqual(1));
    const btns = screen.getAllByText('Send to Harness');
    await userEvent.click(btns[btns.length - 1]);
    expect(onSendToHarness).toHaveBeenCalledWith(expect.objectContaining({ id: 'ep1' }), true);
  });

  it('renders an auth failure error block', async () => {
    applyAuthMock.mockRejectedValue(new Error('bad token'));
    renderCard({ auth: { type: 'bearer', token: 'tok12345678' } });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.click(screen.getByText('Execute'));
    await waitFor(() => expect(screen.getByText('Request failed')).toBeInTheDocument());
    expect(screen.getByText(/Auth failed/)).toBeInTheDocument();
  });

  it('renders an ENOTFOUND error hint with empty body', async () => {
    httpFetchMock.mockResolvedValue({ status: 0, statusText: '', headers: {}, body: '', error: 'getaddrinfo ENOTFOUND host' });
    renderCard({ hostConfig: makeHostConfig({ strategy: 'inherited' }) });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.click(screen.getByText('Execute'));
    await waitFor(() => expect(screen.getByText('Request failed')).toBeInTheDocument());
    expect(screen.getByText(/spec server URL is unreachable/)).toBeInTheDocument();
  });

  it('shows and hides the cURL box and toggles single line', async () => {
    renderCard();
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.click(screen.getByText('cURL'));
    await waitFor(() => expect(screen.getByText('Curl')).toBeInTheDocument());
    await userEvent.click(screen.getByTitle('Single line'));
    await userEvent.click(screen.getByText('Copy'));
    expect(copyMock).toHaveBeenCalled();
    await userEvent.click(screen.getByText('Hide cURL'));
  });

  it('fires Export, Send to Harness and Workflow exposure callbacks', async () => {
    const { onExportSingle, onSendToHarness, onSetWorkflowExposure } = renderCard();
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.click(screen.getByText('Export to Requests'));
    expect(onExportSingle).toHaveBeenCalled();
    await userEvent.click(screen.getByText('Send to Harness'));
    expect(onSendToHarness).toHaveBeenCalledWith(expect.objectContaining({ id: 'ep1' }));
    const trigger = screen.getByTestId('catalog-expose-to-workflow').querySelector('.sw-wf-exposure-trigger')!;
    await userEvent.click(trigger);
    await userEvent.click(screen.getByText('Preview'));
    expect(onSetWorkflowExposure).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ep1' }),
      'preview',
      expect.objectContaining({ params: expect.any(Object) }),
    );
  });

  it('shows a host warning for placeholder spec URLs', async () => {
    renderCard({ hostConfig: makeHostConfig({ strategy: 'inherited' }) });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    expect(screen.getByText(/likely a placeholder/)).toBeInTheDocument();
  });

  it('renders spec responses with Model tab', async () => {
    const endpoint = makeEndpoint({
      responses: [
        makeResponse({
          statusCode: '200',
          description: 'A user',
          schema: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              meta: { type: 'object', properties: { k: { type: 'string' } } },
              role: { type: 'string', enum: ['admin', 'user'] },
            },
          },
        }),
      ],
    });
    renderCard({ endpoint });
    fireEvent.click(screen.getByText('/users/{id}'));
    expect(screen.getByText('Responses')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Model'));
    expect(screen.getByText('Example Value')).toBeInTheDocument();
  });

  it('updates header parameters and persists values via onValuesChange', async () => {
    const endpoint = makeEndpoint({ parameters: [makeParam({ name: 'X-Auth', in: 'header' })] });
    const { onValuesChange } = renderCard({ endpoint });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.type(screen.getByPlaceholderText('X-Auth'), 'tok');
    await waitFor(() => expect(onValuesChange).toHaveBeenCalledWith(
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Auth': 'tok' }) }),
    ));
  });

  it('shows host warning when inherited strategy has no base URL', async () => {
    vi.mocked(resolveBaseUrl).mockReturnValueOnce('');
    renderCard({ hostConfig: makeHostConfig({ strategy: 'inherited' }) });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    expect(screen.getByText(/No server URL configured/)).toBeInTheDocument();
  });

  it('shows localhost placeholder warning for inherited strategy', async () => {
    renderCard({
      hostConfig: makeHostConfig({ strategy: 'inherited' }),
      endpoint: makeEndpoint(),
    });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    expect(screen.getByText(/likely a placeholder/)).toBeInTheDocument();
  });

  it('renders oauth2, basic, and unknown auth status messages', async () => {
    renderCard({ auth: { type: 'oauth2', tokenUrl: 'https://auth.example.com', clientId: 'client12345' } });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    expect(screen.getByText(/OAuth2 client credentials/)).toBeInTheDocument();
    expect(screen.getByText(/client12345/)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/auth.example.com/)).toBeInTheDocument();
  });

  it('renders empty bearer token warning', async () => {
    renderCard({ auth: { type: 'bearer', token: '' } });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    expect(screen.getByText(/Bearer token empty/)).toBeInTheDocument();
  });

  it('toggles cURL to multiline mode', async () => {
    renderCard();
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.click(screen.getByText('cURL'));
    await waitFor(() => expect(screen.getByTitle('Multi-line')).toBeInTheDocument());
    await userEvent.click(screen.getByTitle('Multi-line'));
  });

  it('shows ECONNREFUSED hint for non-inherited host strategy', async () => {
    httpFetchMock.mockResolvedValue({ status: 0, statusText: '', headers: {}, body: '', error: 'ECONNREFUSED' });
    renderCard({ hostConfig: makeHostConfig({ strategy: 'hardcoded', hardcodedUrl: 'https://real.example.com' }) });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.click(screen.getByText('Execute'));
    await waitFor(() => expect(screen.getByText(/server could not be reached/)).toBeInTheDocument());
  });

  it('shows SSL and CORS error hints', async () => {
    httpFetchMock.mockResolvedValue({ status: 0, statusText: '', headers: {}, body: '', error: 'CERT_HAS_EXPIRED' });
    renderCard();
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.click(screen.getByText('Execute'));
    await waitFor(() => expect(screen.getByText(/SSL\/TLS certificate error/)).toBeInTheDocument());
  });

  it('copies live response body and shows empty body message', async () => {
    httpFetchMock.mockResolvedValue({ status: 204, statusText: 'No Content', headers: {}, body: '' });
    renderCard();
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.click(screen.getByText('Execute'));
    await waitFor(() => expect(screen.getByText('No response body')).toBeInTheDocument());
  });

  it('switches response row to Example Value tab', async () => {
    const endpoint = makeEndpoint({
      responses: [makeResponse({ statusCode: '200', description: 'OK', example: { id: '1' } })],
    });
    renderCard({ endpoint });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Example Value'));
    expect(screen.getByText(/"id"/)).toBeInTheDocument();
  });

  it('coverage popover toggles via Space key', () => {
    const coverage: EndpointCoverage = {
      exported: true,
      count: 1,
      locations: [{ collectionId: 'c1', requestId: 'r1', folderPath: 'Coll / F' }],
    };
    renderCard({ coverage });
    const badge = screen.getByText('IN REQUESTS');
    fireEvent.keyDown(badge, { key: ' ' });
    expect(screen.getByText('Exported to 1 request')).toBeInTheDocument();
  });

  it('uses fallback method color for unknown HTTP methods', () => {
    renderCard({ endpoint: makeEndpoint({ method: 'TRACE' as 'GET' }) });
    expect(screen.getByText('TRACE')).toBeInTheDocument();
  });

  it('renders oauth2 not configured and basic empty warnings', async () => {
    renderCard({ auth: { type: 'oauth2', tokenUrl: '', clientId: '' } });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    expect(screen.getByText(/OAuth2 not configured/)).toBeInTheDocument();
  });

  it('shows CORS and timeout error hints', async () => {
    httpFetchMock.mockResolvedValueOnce({ status: 0, statusText: '', headers: {}, body: '', error: 'Failed to fetch CORS' });
    renderCard();
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.click(screen.getByText('Execute'));
    await waitFor(() => expect(screen.getByText(/CORS error/)).toBeInTheDocument());

    httpFetchMock.mockResolvedValueOnce({ status: 0, statusText: '', headers: {}, body: '', error: 'request timeout exceeded' });
    await userEvent.click(screen.getByText('Execute'));
    await waitFor(() => expect(screen.getByText(/timed out/)).toBeInTheDocument());
  });

  it('copies response body from successful live response', async () => {
    renderCard();
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.click(screen.getByText('Execute'));
    await waitFor(() => expect(screen.getByText('Server response')).toBeInTheDocument());
    const copyBtns = screen.getAllByText('Copy');
    await userEvent.click(copyBtns[copyBtns.length - 1]);
    expect(copyMock).toHaveBeenCalled();
  });

  it('renders parameter example from schema when no param example', async () => {
    const endpoint = makeEndpoint({
      parameters: [makeParam({ name: 'q', in: 'query', schema: { type: 'string', example: 'schema-ex' } })],
    });
    renderCard({ endpoint });
    fireEvent.click(screen.getByText('/users/{id}'));
    expect(screen.getByText('schema-ex')).toBeInTheDocument();
  });

  it('renders apikey auth status when configured', async () => {
    renderCard({ auth: { type: 'apikey', apiKeyName: 'X-Key', apiKeyValue: 'secret12345', apiKeyIn: 'header' } });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    expect(screen.getByText(/X-Key/)).toBeInTheDocument();
  });

  it('renders empty apikey and basic auth warnings', async () => {
    renderCard({ auth: { type: 'apikey', apiKeyName: 'X-Key', apiKeyValue: '', apiKeyIn: 'header' } });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    expect(screen.getByText(/value empty/)).toBeInTheDocument();
  });

  it('renders basic auth with username', async () => {
    renderCard({ auth: { type: 'basic', username: 'alice', password: 'pw' } });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    expect(screen.getByText(/Basic alice/)).toBeInTheDocument();
  });

  it('renders unknown auth type fallback', async () => {
    renderCard({ auth: { type: 'custom' as AuthConfig['type'] } });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    expect(screen.getByText('? type=custom')).toBeInTheDocument();
  });

  it('shows generic error hint for unrecognized failures', async () => {
    httpFetchMock.mockResolvedValue({ status: 0, statusText: '', headers: {}, body: '', error: 'Unexpected server error' });
    renderCard();
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.click(screen.getByText('Execute'));
    await waitFor(() => expect(screen.getByText(/Check the URL, network connection/)).toBeInTheDocument());
  });

  it('renders buildModel for array root schema', async () => {
    const endpoint = makeEndpoint({
      responses: [
        makeResponse({
          statusCode: '200',
          description: 'Array items',
          schema: { type: 'array', items: { type: 'string' } },
        }),
      ],
    });
    renderCard({ endpoint });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Model'));
    expect(document.querySelector('.sw-model')?.textContent).toMatch(/\[string\]/);
  });

  it('truncates buildModel output when nesting exceeds max depth', async () => {
    const makeDeepSchema = (depth: number): NonNullable<ReturnType<typeof makeResponse>['schema']> => {
      if (depth <= 0) return { type: 'string' };
      return { type: 'object', properties: { nested: makeDeepSchema(depth - 1) } };
    };
    const endpoint = makeEndpoint({
      responses: [
        makeResponse({
          statusCode: '201',
          description: 'Deep object',
          schema: makeDeepSchema(8),
        }),
      ],
    });
    renderCard({ endpoint });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Model'));
    expect(document.querySelector('.sw-model')?.textContent).toContain('...');
  });

  it('highlights cURL tokens including plain quoted values and empty lines', async () => {
    buildCatalogCurlCommandMock.mockResolvedValueOnce(
      "curl -X GET \\\n\n  'plainvalue' \\\n  extraToken",
    );
    renderCard();
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.click(screen.getByText('cURL'));
    await waitFor(() => expect(document.querySelector('.sw-curl-hl')).toBeTruthy());
    expect(document.querySelector('.sw-hl-string')).toBeTruthy();
  });

  it('initializes from savedValues and shows parameter format', async () => {
    const endpoint = makeEndpoint({
      method: 'POST',
      requestBody: { required: false, contentTypes: [{ mediaType: 'application/json', schema: { type: 'object' } }] },
      parameters: [makeParam({ name: 'id', in: 'path', schema: { type: 'string', format: 'uuid' } })],
    });
    const { onValuesChange } = renderCard({
      endpoint,
      savedValues: { params: { id: 'saved-id' }, headers: { 'X-Tok': 'h' }, body: '{"saved":true}' },
    });
    fireEvent.click(screen.getByText('/users/{id}'));
    expect(screen.getByText('uuid', { exact: false })).toBeInTheDocument();
    await userEvent.click(screen.getByText('Try it out'));
    expect((screen.getByPlaceholderText('id') as HTMLInputElement).value).toBe('saved-id');
    expect((document.querySelector('textarea.sw-body-editor') as HTMLTextAreaElement).value).toBe('{"saved":true}');
    await userEvent.type(screen.getByPlaceholderText('id'), 'x');
    await waitFor(() => expect(onValuesChange).toHaveBeenCalled());
  });

  it('shows placeholder host warnings for .invalid and .local domains', async () => {
    vi.mocked(resolveBaseUrl).mockReturnValueOnce('https://api.test.local/v1');
    renderCard({ hostConfig: makeHostConfig({ strategy: 'inherited' }) });
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    expect(screen.getByText(/likely a placeholder/)).toBeInTheDocument();
  });

  it('shows executing state while request is in flight', async () => {
    let resolveFetch!: (v: unknown) => void;
    httpFetchMock.mockImplementationOnce(() => new Promise(r => { resolveFetch = r; }));
    renderCard();
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.click(screen.getByText('Execute'));
    expect(screen.getByText('Executing...')).toBeInTheDocument();
    resolveFetch({ status: 200, statusText: 'OK', headers: {}, body: '{}' });
    await waitFor(() => expect(screen.getByText('Execute')).toBeInTheDocument());
  });

  it('shows copied state on cURL copy button', async () => {
    copiedState.value = true;
    renderCard();
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    await userEvent.click(screen.getByText('cURL'));
    await waitFor(() => expect(screen.getByText('✓ Copied')).toBeInTheDocument());
  });
});

describe('stale publication badge', () => {
  it('shows stale badge when published and stale', () => {
    render(
      <CatalogEndpointCard
        endpoint={makeEndpoint()}
        servers={[server]}
        hostConfig={hostConfig}
        auth={noAuth}
        currentExposureMode="published"
        isPublicationStale={true}
      />,
    );
    expect(screen.getByTestId('catalog-stale-badge')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-stale-badge')).toHaveTextContent('⚠ Stale');
  });

  it('does not show stale badge when published and not stale', () => {
    render(
      <CatalogEndpointCard
        endpoint={makeEndpoint()}
        servers={[server]}
        hostConfig={hostConfig}
        auth={noAuth}
        currentExposureMode="published"
        isPublicationStale={false}
      />,
    );
    expect(screen.queryByTestId('catalog-stale-badge')).not.toBeInTheDocument();
  });

  it('does not show stale badge when preview mode even if stale', () => {
    render(
      <CatalogEndpointCard
        endpoint={makeEndpoint()}
        servers={[server]}
        hostConfig={hostConfig}
        auth={noAuth}
        currentExposureMode="preview"
        isPublicationStale={true}
      />,
    );
    expect(screen.queryByTestId('catalog-stale-badge')).not.toBeInTheDocument();
  });

  it('does not show stale badge when no exposure mode', () => {
    render(
      <CatalogEndpointCard
        endpoint={makeEndpoint()}
        servers={[server]}
        hostConfig={hostConfig}
        auth={noAuth}
        isPublicationStale={true}
      />,
    );
    expect(screen.queryByTestId('catalog-stale-badge')).not.toBeInTheDocument();
  });
});

describe('WorkflowExposureDropdown — permission gating', () => {
  it('disables Published option when canPublish is false', async () => {
    const onExposure = vi.fn();
    render(
      <CatalogEndpointCard
        endpoint={makeEndpoint()}
        servers={[server]}
        hostConfig={hostConfig}
        auth={noAuth}
        onSetWorkflowExposure={onExposure}
        publishPermission={{ canPublish: false, canUnpublish: true, canRepublish: true, reason: 'Admins only' }}
      />,
    );
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    const trigger = screen.getByTestId('catalog-expose-to-workflow').querySelector('.sw-wf-exposure-trigger')!;
    await userEvent.click(trigger);
    const publishedBtn = screen.getByTestId('catalog-expose-option-published');
    expect(publishedBtn).toBeDisabled();
    await userEvent.click(publishedBtn);
    expect(onExposure).not.toHaveBeenCalled();
  });

  it('disables downgrade options when canUnpublish is false', async () => {
    const onExposure = vi.fn();
    render(
      <CatalogEndpointCard
        endpoint={makeEndpoint()}
        servers={[server]}
        hostConfig={hostConfig}
        auth={noAuth}
        currentExposureMode="published"
        onSetWorkflowExposure={onExposure}
        publishPermission={{ canPublish: true, canUnpublish: false, canRepublish: true, reason: 'Cannot unpublish' }}
      />,
    );
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    const trigger = screen.getByTestId('catalog-expose-to-workflow').querySelector('.sw-wf-exposure-trigger')!;
    await userEvent.click(trigger);
    const previewBtn = screen.getByTestId('catalog-expose-option-preview');
    const noneBtn = screen.getByTestId('catalog-expose-option-none');
    expect(previewBtn).toBeDisabled();
    expect(noneBtn).toBeDisabled();
  });

  it('enables all options when no permission prop provided', async () => {
    const onExposure = vi.fn();
    render(
      <CatalogEndpointCard
        endpoint={makeEndpoint()}
        servers={[server]}
        hostConfig={hostConfig}
        auth={noAuth}
        onSetWorkflowExposure={onExposure}
      />,
    );
    fireEvent.click(screen.getByText('/users/{id}'));
    await userEvent.click(screen.getByText('Try it out'));
    const trigger = screen.getByTestId('catalog-expose-to-workflow').querySelector('.sw-wf-exposure-trigger')!;
    await userEvent.click(trigger);
    expect(screen.getByTestId('catalog-expose-option-published')).not.toBeDisabled();
    expect(screen.getByTestId('catalog-expose-option-preview')).not.toBeDisabled();
    expect(screen.getByTestId('catalog-expose-option-none')).not.toBeDisabled();
  });
});
