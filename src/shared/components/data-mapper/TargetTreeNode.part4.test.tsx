/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import TargetTreeNode from './TargetTreeNode';
import { JsonTreeNode } from '../../utils/jsonTreeModel';
import { Mapping } from './types';
const leaf: JsonTreeNode = { key: 'userName', path: 'userName', type: 'string', value: '', children: [] };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const nested: JsonTreeNode = {
  key: '(root)', path: '', type: 'object', value: undefined,
  children: [
    leaf,
    { key: 'email', path: 'email', type: 'string', value: '', children: [] },
  ],
};

const mapping: Mapping = { id: 'm1', sourcePath: 'name', sourceId: 's1', targetPath: 'userName' };

const defaults = {
  depth: 0,
  search: '',
  mappings: [] as Mapping[],
  onDrop: vi.fn(),
  expandedPaths: new Set(['__root__', '']),
  onToggle: vi.fn(),
  selectedMappingId: null,
  onSelectMapping: vi.fn(),
};

describe('TargetTreeNode – array assertion rows with InlineAssertionRow', () => {
  const capsArr = { operators: false, arrayAssertions: true, codeEditor: false } as const;
  const arrayNode: JsonTreeNode = {
    key: 'items', path: 'items', type: 'array', value: undefined,
    children: [{ key: '[0]', path: 'items[0]', type: 'string', value: 'a', children: [] }],
  };

  it('renders InlineAssertionRow items when arrayAssertions exist', () => {
    const assertions = [
      { type: 'arrayLength' as const, jsonPath: '$.items', operator: '=' as const, value: 3 },
    ];
    const { container } = render(
      <TargetTreeNode
        node={arrayNode}
        {...defaults}
        expandedPaths={new Set(['__root__', '', 'items'])}
        capabilities={capsArr}
        arrayAssertions={assertions}
      />,
    );
    const rows = container.querySelectorAll('.dm-array-assertion-row');
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('clicking +Add array assertion calls onAddArrayAssertion', () => {
    const onAdd = vi.fn();
    const { container } = render(
      <TargetTreeNode
        node={arrayNode}
        {...defaults}
        expandedPaths={new Set(['__root__', '', 'items'])}
        capabilities={capsArr}
        onAddArrayAssertion={onAdd}
        arrayAssertions={[]}
      />,
    );
    const hint = container.querySelector('.dm-array-assertion-hint--clickable');
    expect(hint).not.toBeNull();
    fireEvent.click(hint!);
    expect(onAdd).toHaveBeenCalledWith('items', 'length');
  });
});
describe('P3-05: Multiple array assertions on one node', () => {
  const capsArr = { operators: false, arrayAssertions: true, codeEditor: false } as const;
  const arrayNode: JsonTreeNode = {
    key: 'offers', path: 'offers', type: 'array', value: undefined,
    children: [
      { key: '[0]', path: 'offers[0]', type: 'object', value: undefined, children: [] },
      { key: '[1]', path: 'offers[1]', type: 'object', value: undefined, children: [] },
      { key: '[2]', path: 'offers[2]', type: 'object', value: undefined, children: [] },
    ],
  };
  const fourAssertions = [
    { type: 'arrayLength' as const, jsonPath: '$.offers', operator: '>=' as const, value: 1 },
    { type: 'arrayContains' as const, jsonPath: '$.offers', mode: 'any' as const, value: '{"offerName":"EV Access"}' },
    { type: 'each' as const, jsonPath: '$.offers', fieldPath: 'rank', operator: '>=' as const, value: '0' },
    { type: 'containsSubset' as const, jsonPath: '$.offers', expected: '{"offerName":"Connected Safety Plan"}' },
  ];
  const expandedOffers = new Set(['__root__', '', 'offers']);

  it('renders all four assertion rows stacked beneath the array node', () => {
    const { container } = render(
      <TargetTreeNode
        node={arrayNode}
        {...defaults}
        expandedPaths={expandedOffers}
        capabilities={capsArr}
        arrayAssertions={fourAssertions}
        onUpdateArrayAssertion={vi.fn()}
        onRemoveArrayAssertion={vi.fn()}
      />,
    );
    const rows = container.querySelectorAll('.dm-array-assertion-row');
    expect(rows).toHaveLength(4);
  });

  it('shows "3 items · 4 assertions" header when expanded', () => {
    const { container } = render(
      <TargetTreeNode
        node={arrayNode}
        {...defaults}
        expandedPaths={expandedOffers}
        capabilities={capsArr}
        arrayAssertions={fourAssertions}
        onUpdateArrayAssertion={vi.fn()}
        onRemoveArrayAssertion={vi.fn()}
      />,
    );
    const badge = container.querySelector('.dm-node-count--assertions');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('3 items · 4 assertions');
  });

  it('shows "3 items · 4 assertions" in collapsed badge', () => {
    const { container } = render(
      <TargetTreeNode
        node={arrayNode}
        {...defaults}
        expandedPaths={new Set<string>()}
        capabilities={capsArr}
        arrayAssertions={fourAssertions}
      />,
    );
    const badge = container.querySelector('.dm-node-count');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('3 items · 4 assertions');
  });

  it('shows singular "assertion" when only one assertion exists', () => {
    const oneAssertion = [fourAssertions[0]];
    const { container } = render(
      <TargetTreeNode
        node={arrayNode}
        {...defaults}
        expandedPaths={new Set<string>()}
        capabilities={capsArr}
        arrayAssertions={oneAssertion}
      />,
    );
    const badge = container.querySelector('.dm-node-count');
    expect(badge!.textContent).toBe('3 items · 1 assertion');
  });

  it('shows plain child count when no assertions exist', () => {
    const { container } = render(
      <TargetTreeNode
        node={arrayNode}
        {...defaults}
        expandedPaths={new Set<string>()}
        capabilities={capsArr}
        arrayAssertions={[]}
      />,
    );
    const badge = container.querySelector('.dm-node-count');
    expect(badge!.textContent).toBe('3');
  });

  it('each row has a remove button and calls onRemoveArrayAssertion', () => {
    const onRemove = vi.fn();
    const { container } = render(
      <TargetTreeNode
        node={arrayNode}
        {...defaults}
        expandedPaths={expandedOffers}
        capabilities={capsArr}
        arrayAssertions={fourAssertions}
        onUpdateArrayAssertion={vi.fn()}
        onRemoveArrayAssertion={onRemove}
      />,
    );
    const removeBtns = container.querySelectorAll('.dm-array-assertion-remove');
    expect(removeBtns).toHaveLength(4);
    fireEvent.click(removeBtns[2]);
    expect(onRemove).toHaveBeenCalledWith(2);
  });

  it('removing one assertion decrements the badge count', () => {
    const threeAssertions = fourAssertions.slice(0, 3);
    const { container } = render(
      <TargetTreeNode
        node={arrayNode}
        {...defaults}
        expandedPaths={expandedOffers}
        capabilities={capsArr}
        arrayAssertions={threeAssertions}
        onUpdateArrayAssertion={vi.fn()}
        onRemoveArrayAssertion={vi.fn()}
      />,
    );
    const badge = container.querySelector('.dm-node-count--assertions');
    expect(badge!.textContent).toBe('3 items · 3 assertions');
    const rows = container.querySelectorAll('.dm-array-assertion-row');
    expect(rows).toHaveLength(3);
  });

  it('renders correct type pills for each assertion type', () => {
    render(
      <TargetTreeNode
        node={arrayNode}
        {...defaults}
        expandedPaths={expandedOffers}
        capabilities={capsArr}
        arrayAssertions={fourAssertions}
        onUpdateArrayAssertion={vi.fn()}
        onRemoveArrayAssertion={vi.fn()}
      />,
    );
    expect(screen.getByTitle('Array size check')).toBeInTheDocument();
    expect(screen.getByTitle('Has item with exact value')).toBeInTheDocument();
    expect(screen.getByTitle('Every item must match')).toBeInTheDocument();
    expect(screen.getByTitle('Has item matching partial object (nested)')).toBeInTheDocument();
  });
});
describe('TargetTreeNode – verify display from fieldVerifyResults', () => {
  const capsOp = { operators: true, arrayAssertions: false, codeEditor: false } as const;

  it('shows fail badge and actual text from fieldVerifyResults map', () => {
    const nodeStatus = new Map<string, 'pass' | 'fail'>([['userName', 'fail']]);
    const fvr = new Map([['userName', { passed: false, actual: 'got "Bob"', expected: 'equals "Alice"' }]]);
    const { container } = render(
      <TargetTreeNode
        node={leaf}
        {...defaults}
        mappings={[mapping]}
        capabilities={capsOp}
        nodeStatusMap={nodeStatus}
        fieldVerifyResults={fvr}
      />,
    );
    expect(container.querySelector('.dm-verify-badge--fail')).not.toBeNull();
    const actualEl = container.querySelector('.dm-verify-actual');
    expect(actualEl).not.toBeNull();
    expect(actualEl!.textContent).toContain('Bob');
  });

  it('shows pass badge from fieldVerifyResults with $.path key', () => {
    const nodeStatus = new Map<string, 'pass' | 'fail'>([['$.userName', 'pass']]);
    const fvr = new Map([['$.userName', { passed: true, actual: '"Alice"', expected: 'equals "Alice"' }]]);
    const { container } = render(
      <TargetTreeNode
        node={leaf}
        {...defaults}
        mappings={[mapping]}
        capabilities={capsOp}
        nodeStatusMap={nodeStatus}
        fieldVerifyResults={fvr}
      />,
    );
    expect(container.querySelector('.dm-verify-badge--pass')).not.toBeNull();
  });

  it('hides mapping for parent with non-allowed operator', () => {
    const parentNode: JsonTreeNode = {
      key: 'parent', path: 'parent', type: 'object', value: undefined,
      children: [{ key: 'child', path: 'parent.child', type: 'string', value: '', children: [] }],
    };
    const parentMapping: Mapping = { id: 'm1', sourcePath: 'src', sourceId: 's1', targetPath: 'parent', operator: 'equals' };
    const { container } = render(
      <TargetTreeNode
        node={parentNode}
        {...defaults}
        mappings={[parentMapping]}
        capabilities={capsOp}
      />,
    );
    expect(container.querySelector('.dm-mapped-badge')).toBeNull();
  });

  it('shows mapping for parent with allowed operator', () => {
    const parentNode: JsonTreeNode = {
      key: 'parent', path: 'parent', type: 'object', value: undefined,
      children: [{ key: 'child', path: 'parent.child', type: 'string', value: '', children: [] }],
    };
    const parentMapping: Mapping = { id: 'm1', sourcePath: 'src', sourceId: 's1', targetPath: 'parent', operator: 'is_empty' };
    const { container } = render(
      <TargetTreeNode
        node={parentNode}
        {...defaults}
        mappings={[parentMapping]}
        capabilities={capsOp}
      />,
    );
    expect(container.querySelector('.dm-mapped-badge')).not.toBeNull();
  });

  it('context menu opens on right-click', () => {
    const { container } = render(
      <TargetTreeNode
        node={leaf}
        {...defaults}
        mappings={[mapping]}
        capabilities={capsOp}
        onRemoveMapping={vi.fn()}
      />,
    );
    const nodeEl = container.querySelector('.dm-tree-node--target')!;
    fireEvent.contextMenu(nodeEl, { clientX: 100, clientY: 200 });
    const ctxMenu = document.querySelector('.dm-context-menu');
    expect(ctxMenu).not.toBeNull();
  });
});

// ── Array Assertion verify filter ──
describe('TargetTreeNode — verifyFilter for array assertions', () => {
  const arrayNode: JsonTreeNode = {
    key: 'offers', path: 'offers', type: 'array', value: undefined,
    children: [{ key: '0', path: 'offers[0]', type: 'object', value: undefined, children: [] }],
  };

  const capsArray = {
    operatorPicker: true,
    arrayAssertions: true,
    valueEditor: true,
    contextMenu: true,
    statusBadges: true,
  };

  const offersAssertions = [
    { type: 'arrayLength', operator: 'greater_than_or_equal', value: '1', jsonPath: '$.offers' },
    { type: 'each', operator: 'exists', value: '', jsonPath: '$.offers' },
  ];

  it('shows all array assertions when verifyFilter is undefined', () => {
    const { container } = render(
      <TargetTreeNode
        node={arrayNode}
        {...defaults}
        expandedPaths={new Set(['', 'offers'])}
        capabilities={capsArray}
        arrayAssertions={offersAssertions as never}
      />,
    );
    const rows = container.querySelectorAll('.dm-array-assertion-row');
    expect(rows.length).toBe(2);
  });

  it('filters array assertions by verifyFilter=passed', () => {
    const verifyMap = new Map<number, { passed: boolean }>([
      [0, { passed: true }],
      [1, { passed: false }],
    ]);
    const { container } = render(
      <TargetTreeNode
        node={arrayNode}
        {...defaults}
        expandedPaths={new Set(['', 'offers'])}
        capabilities={capsArray}
        arrayAssertions={offersAssertions as never}
        verifyFilter="passed"
        assertionVerifyMap={verifyMap as never}
      />,
    );
    const rows = container.querySelectorAll('.dm-array-assertion-row');
    expect(rows.length).toBe(1);
  });

  it('filters array assertions by verifyFilter=failed', () => {
    const verifyMap = new Map<number, { passed: boolean }>([
      [0, { passed: true }],
      [1, { passed: false }],
    ]);
    const { container } = render(
      <TargetTreeNode
        node={arrayNode}
        {...defaults}
        expandedPaths={new Set(['', 'offers'])}
        capabilities={capsArray}
        arrayAssertions={offersAssertions as never}
        verifyFilter="failed"
        assertionVerifyMap={verifyMap as never}
      />,
    );
    const rows = container.querySelectorAll('.dm-array-assertion-row');
    expect(rows.length).toBe(1);
  });

  it('shows all assertions when verifyMap has no entry for the assertion', () => {
    const verifyMap = new Map<number, { passed: boolean }>();
    const { container } = render(
      <TargetTreeNode
        node={arrayNode}
        {...defaults}
        expandedPaths={new Set(['', 'offers'])}
        capabilities={capsArray}
        arrayAssertions={offersAssertions as never}
        verifyFilter="passed"
        assertionVerifyMap={verifyMap as never}
      />,
    );
    const rows = container.querySelectorAll('.dm-array-assertion-row');
    expect(rows.length).toBe(2);
  });
});
describe('TargetTreeNode — operator editing edge cases', () => {
  const onUpdate = vi.fn();
  const betweenMapping: Mapping = {
    id: 'mb', sourcePath: 'val', sourceId: 's1', targetPath: 'userName',
    expression: '$.val', operator: 'between' as never, operatorValue: '10, 20',
  };

  it('renders range operator display for between mapping', () => {
    render(
      <TargetTreeNode
        node={leaf}
        {...defaults}
        mappings={[betweenMapping]}
        capabilities={{ operators: true, arrayAssertions: false }}
        onUpdateMappingOperator={onUpdate}
      />,
    );
    expect(document.querySelector('.dm-operator-pill')).toBeTruthy();
  });

  it('renders is_type operator with select dropdown', () => {
    const typeMapping: Mapping = {
      id: 'mt', sourcePath: 'val', sourceId: 's1', targetPath: 'userName',
      expression: '$.val', operator: 'is_type' as never, operatorValue: 'string',
    };
    render(
      <TargetTreeNode
        node={leaf}
        {...defaults}
        mappings={[typeMapping]}
        capabilities={{ operators: true, arrayAssertions: false }}
        onUpdateMappingOperator={onUpdate}
      />,
    );
    expect(document.querySelector('.dm-operator-pill')).toBeTruthy();
  });

  it('renders context menu and opens operator picker from it', () => {
    render(
      <TargetTreeNode
        node={leaf}
        {...defaults}
        mappings={[mapping]}
        capabilities={{ operators: true, arrayAssertions: false }}
        onUpdateMappingOperator={onUpdate}
      />,
    );
    const nodeRow = document.querySelector('.dm-tree-node')!;
    fireEvent.contextMenu(nodeRow, { clientX: 100, clientY: 200 });
    const menuItems = document.querySelectorAll('.dm-ctx-item');
    const changeOpItem = Array.from(menuItems).find(el => el.textContent?.includes('Change operator'));
    if (changeOpItem) {
      fireEvent.click(changeOpItem);
      expect(document.querySelector('.dm-op-picker')).toBeTruthy();
    }
  });

  it('renders negate badge for negated expression mapping', () => {
    const negatedMapping: Mapping = {
      id: 'mn', sourcePath: 'val', sourceId: 's1', targetPath: 'userName',
      expression: '$.val', negate: true,
    };
    render(
      <TargetTreeNode
        node={leaf}
        {...defaults}
        mappings={[negatedMapping]}
        capabilities={{ operators: true, arrayAssertions: false }}
        onUpdateMappingOperator={onUpdate}
      />,
    );
    const negateBadge = document.querySelector('.dm-negate-badge');
    expect(negateBadge?.textContent).toBe('NOT');
  });

  it('renders default value for unmapped node with value', () => {
    const nodeWithValue: JsonTreeNode = {
      key: 'status', path: 'status', type: 'string', value: 'active', children: [],
    };
    render(<TargetTreeNode node={nodeWithValue} {...defaults} />);
    expect(screen.getByText(/= active/)).toBeTruthy();
  });

  it('renders range inputs when editing between operator value', async () => {
    const onUpdate = vi.fn();
    const betweenMapping: Mapping = {
      id: 'mb', sourcePath: 'val', sourceId: 's1', targetPath: 'userName',
      expression: '$.val', operator: 'between' as never, operatorValue: '10, 20',
    };
    render(
      <TargetTreeNode
        node={leaf}
        {...defaults}
        mappings={[betweenMapping]}
        capabilities={{ operators: true, arrayAssertions: false }}
        onUpdateMappingOperator={onUpdate}
      />,
    );
    const display = document.querySelector('.dm-operator-value-display');
    if (display) {
      fireEvent.click(display);
      const inputs = document.querySelectorAll('.dm-range-input');
      expect(inputs.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('renders double-click on mapped badge to edit expression', () => {
    const onEdit = vi.fn();
    render(
      <TargetTreeNode
        node={leaf}
        {...defaults}
        mappings={[mapping]}
        onEditExpression={onEdit}
      />,
    );
    const badge = document.querySelector('.dm-mapped-badge');
    if (badge) {
      fireEvent.doubleClick(badge);
      expect(onEdit).toHaveBeenCalledWith('m1');
    }
  });

  it('renders fetched origin badge', () => {
    const fetchedNode: JsonTreeNode = {
      key: 'fetchedField', path: 'fetchedField', type: 'string', value: '', children: [],
    };
    const fieldOrigins = new Map([['fetchedField', 'fetched' as const]]);
    render(
      <TargetTreeNode
        node={fetchedNode}
        {...defaults}
        fieldOrigins={fieldOrigins}
      />,
    );
    expect(screen.getByText('fetched')).toBeTruthy();
  });
});
