/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { selectOptionByTestId, getCustomSelectValue } from '@test-utils/customSelectHelper';
import { KafkaTopicDetailPanel } from './KafkaTopicDetailPanel';
import type { KafkaTopicDetail } from './useTopicExplorer';
import type { UseTopicMessageBrowserReturn } from './useTopicMessageBrowser';

function makeDetail(overrides?: Partial<KafkaTopicDetail>): KafkaTopicDetail {
  return {
    name: 'orders.created',
    partitionCount: 3,
    replicationFactor: 3,
    isInternal: false,
    partitions: [{
      partitionId: 0,
      leader: 1,
      replicas: [1, 2, 3],
      isr: [1, 2, 3],
      earliestOffset: '0',
      latestOffset: '1000',
      messageCount: 1000,
    }],
    consumerGroups: [
      { groupId: 'order-processor', state: 'Stable', totalLag: 0 },
    ],
    config: {
      'retention.ms': '604800000',
      'cleanup.policy': 'delete',
      'compression.type': 'lz4',
    },
    healthStatus: 'healthy',
    ...overrides,
  };
}

function makeBrowser(overrides?: Partial<UseTopicMessageBrowserReturn>): UseTopicMessageBrowserReturn {
  return {
    draft: {
      groupId: 'redfireforge-debug-test',
      timeWindow: 'latest',
      partition: '',
      timeoutMs: '10000',
      maxMessages: '50',
      keyEquals: '',
      headerMatch: '',
      jsonPath: '',
      jsonPathEquals: '',
      sortOrder: 'asc',
    },
    setDraft: vi.fn(),
    loading: false,
    result: null,
    timedOut: false,
    messageCount: 0,
    error: null,
    selectedIndex: null,
    selectedMessage: null,
    selectMessage: vi.fn(),
    consumeOnce: vi.fn().mockResolvedValue(undefined),
    clearResult: vi.fn(),
    ...overrides,
  };
}

describe('KafkaTopicDetailPanel', () => {
  it('renders loading state', () => {
    render(
      <KafkaTopicDetailPanel
        detail={null}
        loading
        error={null}
        browser={makeBrowser()}
      />,
    );
    expect(screen.getByText('Loading topic details…')).toBeTruthy();
  });

  it('renders degraded health badge on detail header', () => {
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail({ healthStatus: 'degraded' })}
        loading={false}
        error={null}
        browser={makeBrowser()}
      />,
    );
    expect(screen.getByText('⚠ Warn')).toBeTruthy();
  });

  it('renders unknown health badge on detail header', () => {
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail({ healthStatus: 'unknown' })}
        loading={false}
        error={null}
        browser={makeBrowser()}
      />,
    );
    expect(screen.getByText('? Unknown')).toBeTruthy();
  });

  it('renders error state', () => {
    render(
      <KafkaTopicDetailPanel
        detail={null}
        loading={false}
        error={{ kind: 'server', code: 'ERR', message: 'Topic load failed', retryable: true }}
        browser={makeBrowser()}
      />,
    );
    expect(screen.getByText('Topic load failed')).toBeTruthy();
  });

  it('renders empty state when no detail', () => {
    render(
      <KafkaTopicDetailPanel
        detail={null}
        loading={false}
        error={null}
        browser={makeBrowser()}
      />,
    );
    expect(screen.getByText('Select a topic to view details')).toBeTruthy();
  });

  it('default tab is Messages with metrics row', () => {
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={makeBrowser()}
      />,
    );

    const messagesTab = screen.getByTestId('detail-messages-tab');
    expect(messagesTab).toBeTruthy();
    expect(messagesTab.querySelector('.kafka-explorer-metrics-row')).toBeTruthy();
    expect(messagesTab.textContent).toContain('Total Messages');
    expect(messagesTab.textContent).toContain('1,000');
    expect(screen.getByRole('button', { name: 'Messages' }).className).toContain('active');
  });

  it('tab switching shows correct content', () => {
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={makeBrowser()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Partitions' }));
    expect(screen.getByTestId('detail-partitions-tab')).toBeTruthy();
    expect(screen.queryByTestId('detail-messages-tab')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Consumer Groups' }));
    expect(screen.getByTestId('detail-groups-tab')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Config' }));
    expect(screen.getByTestId('detail-config-tab')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Messages' }));
    expect(screen.getByTestId('detail-messages-tab')).toBeTruthy();
  });

  it('partitions tab: ISR fraction amber when isr.length < replicas.length', () => {
    const detail = makeDetail({
      partitions: [{
        partitionId: 0,
        leader: 1,
        replicas: [1, 2, 3],
        isr: [1, 2],
        earliestOffset: '0',
        latestOffset: '100',
        messageCount: 10,
      }],
    });

    render(
      <KafkaTopicDetailPanel
        detail={detail}
        loading={false}
        error={null}
        browser={makeBrowser()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Partitions' }));

    const isr = screen.getByText('2 / 3');
    expect(isr.className).toContain('kafka-isr-amber');
  });

  it('consumer groups tab: state badge color correct', () => {
    const detail = makeDetail({
      consumerGroups: [
        { groupId: 'g-stable', state: 'Stable', totalLag: 0 },
        { groupId: 'g-rebalance', state: 'PreparingRebalance', totalLag: 5 },
        { groupId: 'g-other', state: 'Dead', totalLag: 0 },
      ],
    });

    render(
      <KafkaTopicDetailPanel
        detail={detail}
        loading={false}
        error={null}
        browser={makeBrowser()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Consumer Groups' }));

    expect(screen.getByText('Stable').className).toContain('kafka-cg-state-green');
    expect(screen.getByText('PreparingRebalance').className).toContain('kafka-cg-state-amber');
    expect(screen.getByText('Dead').className).toContain('kafka-cg-state-grey');
  });

  it('consumer groups tab: counts repeated group ids and shrinks each section', () => {
    const detail = makeDetail({
      consumerGroups: [
        { groupId: 'shadow', state: 'Stable', totalLag: 0 },
        { groupId: 'shadow', state: 'Stable', totalLag: 0 },
        { groupId: 'billing', state: 'Stable', totalLag: 4 },
      ],
    });
    render(
      <KafkaTopicDetailPanel
        detail={detail}
        loading={false}
        error={null}
        browser={makeBrowser()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Consumer Groups' }));

    const counts = screen.getByTestId('cg-counts');
    expect(counts.textContent).toContain('Same group IDs');
    expect(counts.textContent).toContain('2');
    const rows = screen.getAllByTestId('cg-count-row');
    expect(rows[0].textContent).toContain('shadow');
    expect(rows[0].textContent).toContain('2');
    expect(rows[1].textContent).toContain('billing');
    expect(rows[1].textContent).toContain('1');
    expect(screen.getByTestId('cg-detail').textContent).toContain('Detail');
    expect(screen.getAllByText('shadow')).toHaveLength(3);

    fireEvent.click(screen.getByTestId('cg-counts-toggle'));
    expect(screen.getByTestId('cg-counts').querySelector('.is-shrunk')).toBeTruthy();
    expect(screen.queryAllByTestId('cg-count-row')).toHaveLength(0);
    expect(screen.getByTestId('cg-counts-toggle').textContent).toContain('Expand');

    fireEvent.click(screen.getByTestId('cg-detail-toggle'));
    expect(screen.getByTestId('cg-detail').querySelector('.is-shrunk')).toBeTruthy();
    expect(screen.getByTestId('cg-detail-toggle').textContent).toContain('Expand');
  });

  it('consumer groups tab: empty state when length === 0', () => {
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail({ consumerGroups: [] })}
        loading={false}
        error={null}
        browser={makeBrowser()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Consumer Groups' }));
    expect(screen.getByText('No consumer groups found for this topic.')).toBeTruthy();
  });

  it('config tab: empty state when config is {}', () => {
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail({ config: {} })}
        loading={false}
        error={null}
        browser={makeBrowser()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Config' }));
    expect(screen.getByText('No configuration data available.')).toBeTruthy();
  });

  it('config tab: all config keys present', () => {
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={makeBrowser()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Config' }));

    expect(screen.getByText('retention.ms')).toBeTruthy();
    expect(screen.getByText('604800000')).toBeTruthy();
    expect(screen.getByText('cleanup.policy')).toBeTruthy();
    expect(screen.getByText('compression.type')).toBeTruthy();
    expect(screen.getByText('lz4')).toBeTruthy();
  });

  it('partitions tab: ISR fraction not amber when fully in sync', () => {
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={makeBrowser()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Partitions' }));
    const isr = screen.getByText('3 / 3');
    expect(isr.className).not.toContain('kafka-isr-amber');
  });

  it('messages tab: shows results, timed out badge, and message selection', () => {
    const rows = [
      { topic: 'orders.created', partition: 0, offset: '10', value: '{"id":1}', key: 'k1' },
    ];
    const browser = makeBrowser({
      result: rows,
      messageCount: 1,
      selectedIndex: 0,
      selectedMessage: rows[0],
      timedOut: true,
    });

    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={browser}
      />,
    );

    expect(screen.getByTestId('detail-results')).toBeTruthy();
    expect(screen.getByText('timed out')).toBeTruthy();
    expect(screen.getByTestId('detail-row-0')).toBeTruthy();
    expect(screen.getByTestId('kafka-message-detail-modal')).toBeTruthy();

    fireEvent.click(screen.getByTestId('detail-row-0'));
    expect(browser.selectMessage).toHaveBeenCalled();
  });

  it('messages tab: shows browser error and empty results', () => {
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={makeBrowser({
          result: [],
          messageCount: 0,
          error: { kind: 'server', code: 'X', message: 'Consume failed', retryable: false },
        })}
      />,
    );

    expect(screen.getByText('Consume failed')).toBeTruthy();
  });

  it('messages tab: shows no messages received when result is empty', () => {
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={makeBrowser({ result: [], messageCount: 0 })}
      />,
    );

    expect(screen.getByText('No messages received')).toBeTruthy();
  });

  it('messages tab: export, clear, copy actions, and headers in detail modal', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const rows = [
      {
        topic: 'orders.created',
        partition: 0,
        offset: '10',
        value: '{"id":1}',
        key: 'my-key',
        headers: { 'x-trace': 'abc' },
      },
    ];
    const browser = makeBrowser({
      result: rows,
      messageCount: 1,
      selectedIndex: 0,
      selectedMessage: rows[0],
    });

    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={browser}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(browser.clearResult).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('kmd-copy-key'));
    fireEvent.click(screen.getByTestId('kmd-copy-payload'));
    expect(writeText).toHaveBeenCalledWith('my-key');
    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ id: 1 }, null, 2));

    expect(screen.getByTestId('kmd-headers').textContent).toContain('x-trace');
    fireEvent.click(screen.getByTestId('kmd-close-btn'));
    expect(browser.selectMessage).toHaveBeenCalledWith(null);
  });

  it('messages tab: draft controls call setDraft', () => {
    const browser = makeBrowser();
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={browser}
      />,
    );

    const tab = screen.getByTestId('detail-messages-tab');
    const keyInput = tab.querySelector('#detail-key-match') as HTMLInputElement;

    selectOptionByTestId('detail-time-window', 'Last 1 Hour');
    selectOptionByTestId('detail-partition', '0');
    selectOptionByTestId('detail-sort-order', 'Newest First');
    fireEvent.change(keyInput, { target: { value: 'order-1' } });
    fireEvent.change(screen.getByTestId('detail-header-match'), { target: { value: 'x-trace=abc' } });
    fireEvent.change(screen.getByTestId('detail-jsonpath'), { target: { value: '$.name' } });
    fireEvent.change(screen.getByTestId('detail-jsonpath-expected'), { target: { value: 'expected-value' } });
    fireEvent.change(screen.getByTestId('detail-body-contains'), { target: { value: 'login' } });
    fireEvent.change(screen.getByTestId('detail-max-messages'), { target: { value: '25' } });
    fireEvent.change(screen.getByTestId('detail-timeout'), { target: { value: '5000' } });

    expect(browser.setDraft).toHaveBeenCalledWith({ timeWindow: 'last-1h' });
    expect(browser.setDraft).toHaveBeenCalledWith({ partition: '0' });
    expect(browser.setDraft).toHaveBeenCalledWith({ keyEquals: 'order-1' });
    expect(browser.setDraft).toHaveBeenCalledWith({ headerMatch: 'x-trace=abc' });
    expect(browser.setDraft).toHaveBeenCalledWith({ jsonPath: '$.name' });
    expect(browser.setDraft).toHaveBeenCalledWith({ jsonPathEquals: 'expected-value' });
    expect(browser.setDraft).toHaveBeenCalledWith({ bodyContains: 'login' });
    expect(browser.setDraft).toHaveBeenCalledWith({ maxMessages: '25' });
    expect(browser.setDraft).toHaveBeenCalledWith({ timeoutMs: '5000' });
    expect(browser.setDraft).toHaveBeenCalledWith({ sortOrder: 'desc' });
  });

  it('messages tab: shows Consuming… while loading', () => {
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={makeBrowser({ loading: true })}
      />,
    );
    expect(screen.getByTestId('detail-consume-btn').textContent).toBe('Consuming…');
  });

  it('messages tab: consume button calls browser.consumeOnce', () => {
    const browser = makeBrowser();
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={browser}
      />,
    );

    fireEvent.click(screen.getByTestId('detail-consume-btn'));
    expect(browser.consumeOnce).toHaveBeenCalledOnce();
  });

  it('messages tab: formats timestamp in results table', () => {
    const ts = String(new Date(2026, 5, 4, 14, 30, 45).getTime());
    const rows = [{ topic: 't', partition: 0, offset: '1', value: '{}', timestamp: ts }];
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={makeBrowser({ result: rows, messageCount: 1 })}
      />,
    );
    expect(screen.getByTestId('detail-results').textContent).toContain('2026-06-04');
  });

  it('messages tab: shows em dash for missing timestamp', () => {
    const rows = [{ topic: 't', partition: 0, offset: '1', value: '{}' }];
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={makeBrowser({ result: rows, messageCount: 1 })}
      />,
    );
    const row = screen.getByTestId('detail-row-0');
    expect(row.textContent).toContain('—');
  });

  it('messages tab: invalid JSON value shown as raw string in detail modal', () => {
    const rows = [{ topic: 't', partition: 0, offset: '1', value: 'not-json', key: undefined }];
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={makeBrowser({
          result: rows,
          messageCount: 1,
          selectedIndex: 0,
          selectedMessage: rows[0],
        })}
      />,
    );
    expect(screen.getByTestId('kmd-body').textContent).toBe('not-json');
  });

  it('messages tab: invalid or non-positive timestamps render em dash', () => {
    const rows = [
      { topic: 't', partition: 0, offset: '1', value: '{}', timestamp: '0' },
      { topic: 't', partition: 0, offset: '2', value: '{}', timestamp: 'not-a-number' },
    ];
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={makeBrowser({ result: rows, messageCount: 2 })}
      />,
    );
    expect(screen.getByTestId('detail-row-0').textContent).toContain('—');
    expect(screen.getByTestId('detail-row-1').textContent).toContain('—');
  });

  it('messages tab: each filter trigger toggles closed on second click', () => {
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={makeBrowser()}
      />,
    );

    const timeTrigger = screen.getByTestId('detail-time-window').querySelector('.cs-trigger')!;
    fireEvent.click(timeTrigger);
    expect(timeTrigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(timeTrigger);
    expect(timeTrigger.getAttribute('aria-expanded')).toBe('false');

    const partitionTrigger = screen.getByTestId('detail-partition').querySelector('.cs-trigger')!;
    fireEvent.click(partitionTrigger);
    expect(partitionTrigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(partitionTrigger);
    expect(partitionTrigger.getAttribute('aria-expanded')).toBe('false');

    const sortTrigger = screen.getByTestId('detail-sort-order').querySelector('.cs-trigger')!;
    fireEvent.click(sortTrigger);
    expect(sortTrigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(sortTrigger);
    expect(sortTrigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('messages tab: click selected row toggles selection back to null', () => {
    const row = { topic: 't', partition: 0, offset: '1', value: '{}' };
    const browser = makeBrowser({
      result: [row],
      messageCount: 1,
      selectedIndex: 0,
      selectedMessage: row,
    });
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={browser}
      />,
    );
    fireEvent.click(screen.getByTestId('detail-row-0'));
    expect(browser.selectMessage).toHaveBeenCalledWith(null);
  });

  it('messages tab: load more button calls loadMore and shows loading label', () => {
    const loadMore = vi.fn().mockResolvedValue(undefined);
    const browser = makeBrowser({
      result: [{ topic: 't', partition: 0, offset: '1', value: '{}' }],
      messageCount: 1,
      hasMore: true,
      loadMore,
    });
    const { rerender } = render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={browser}
      />,
    );
    fireEvent.click(screen.getByTestId('detail-load-more-btn'));
    expect(loadMore).toHaveBeenCalledOnce();

    rerender(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={makeBrowser({
          result: [{ topic: 't', partition: 0, offset: '1', value: '{}' }],
          messageCount: 1,
          hasMore: true,
          loadMoreLoading: true,
        })}
      />,
    );
    expect(screen.getByTestId('detail-load-more-btn').textContent).toBe('Loading…');
  });

  it('CustomSelect closes on outside click and Escape', () => {
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={makeBrowser()}
      />,
    );

    const timeTrigger = screen.getByTestId('detail-time-window').querySelector('.cs-trigger')!;
    fireEvent.click(timeTrigger);
    expect(timeTrigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.mouseDown(document.body);
    expect(timeTrigger.getAttribute('aria-expanded')).toBe('false');

    const partitionTrigger = screen.getByTestId('detail-partition').querySelector('.cs-trigger')!;
    fireEvent.click(partitionTrigger);
    expect(partitionTrigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(partitionTrigger, { key: 'Escape' });
    expect(partitionTrigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('falls back to default selected labels for unknown draft values', () => {
    render(
      <KafkaTopicDetailPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        browser={makeBrowser({
          draft: {
            ...makeBrowser().draft,
            timeWindow: 'not-real' as never,
            partition: '99',
            sortOrder: 'desc',
          },
        })}
      />,
    );

    expect(getCustomSelectValue(screen.getByTestId('detail-time-window'))).toContain('Latest');
    expect(getCustomSelectValue(screen.getByTestId('detail-partition'))).toContain('Any');
    expect(getCustomSelectValue(screen.getByTestId('detail-sort-order'))).toContain('Newest First');
  });
});
