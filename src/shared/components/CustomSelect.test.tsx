/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CustomSelect, CUSTOM_SELECT_SET_VALUE_EVENT } from './CustomSelect';

const simpleOptions = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma', detail: 'Third letter' },
];

const groupedOptions = [
  {
    label: 'Primary',
    options: [
      { value: 'r', label: 'Red' },
      { value: 'b', label: 'Blue' },
    ],
  },
  {
    label: 'Secondary',
    options: [
      { value: 'o', label: 'Orange' },
    ],
  },
];

describe('CustomSelect', () => {
  it('renders trigger with placeholder when no value', () => {
    render(<CustomSelect value="" onChange={vi.fn()} options={simpleOptions} placeholder="Pick one..." />);
    expect(screen.getByText('Pick one...')).toBeInTheDocument();
  });

  it('renders trigger with selected label when value is set', () => {
    render(<CustomSelect value="b" onChange={vi.fn()} options={simpleOptions} />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('shows selected detail in trigger when requested', () => {
    render(
      <CustomSelect
        value="c"
        onChange={vi.fn()}
        options={simpleOptions}
        showDetailInTrigger
      />,
    );
    expect(screen.getByText('Gamma')).toBeInTheDocument();
    expect(screen.getByText('(Third letter)')).toBeInTheDocument();
  });

  it('opens dropdown on click and shows all options', () => {
    render(<CustomSelect value="" onChange={vi.fn()} options={simpleOptions} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
  });

  it('locks menu width to the trigger when menuMatchTriggerWidth is set', () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value() {
        return {
          left: 40,
          width: 180,
          top: 80,
          bottom: 108,
          right: 220,
          height: 28,
          x: 40,
          y: 80,
          toJSON: () => ({}),
        };
      },
    });

    render(
      <CustomSelect
        value=""
        onChange={vi.fn()}
        options={simpleOptions}
        menuMatchTriggerWidth
        aria-label="match-width"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'match-width' }));
    const menu = screen.getByRole('listbox');
    expect(menu.style.width).toBe('180px');
    expect(menu.style.maxWidth).toBe('180px');
    expect(menu.style.minWidth).toBe('180px');

    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect,
    });
  });

  it('shows detail text for options that have it', () => {
    render(<CustomSelect value="" onChange={vi.fn()} options={simpleOptions} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Third letter')).toBeInTheDocument();
  });

  it('renders a colored swatch and label for method-style options', () => {
    const methodOptions = [
      { value: 'GET', label: 'GET', detail: 'Retrieve data', swatch: '#22c55e' },
      { value: 'POST', label: 'POST', detail: 'Create resource', swatch: '#f59e0b' },
    ];
    const { container } = render(
      <CustomSelect value="GET" onChange={vi.fn()} options={methodOptions} />,
    );
    const triggerSwatch = container.querySelector('.cs-trigger .cs-swatch') as HTMLElement;
    const triggerText = container.querySelector('.cs-trigger .cs-text') as HTMLElement;
    expect(triggerSwatch.style.backgroundColor).toBe('rgb(34, 197, 94)');
    expect(triggerText.style.color).toBe('rgb(34, 197, 94)');

    fireEvent.click(screen.getByRole('button'));
    const post = screen.getByRole('option', { name: /POST/ });
    expect(post).toHaveClass('cs-item--swatch');
    const postSwatch = post.querySelector('.cs-swatch') as HTMLElement;
    const postLabel = post.querySelector('.cs-item-label') as HTMLElement;
    expect(postSwatch.style.backgroundColor).toBe('rgb(245, 158, 11)');
    expect(postLabel.style.color).toBe('rgb(245, 158, 11)');
    expect(screen.getByText('Create resource')).toBeInTheDocument();
  });

  it('calls onChange and closes on option click', () => {
    const onChange = vi.fn();
    render(<CustomSelect value="" onChange={onChange} options={simpleOptions} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Beta'));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('exposes data-value on the wrapper for the current selection', () => {
    const { container } = render(
      <CustomSelect value="b" onChange={vi.fn()} options={simpleOptions} data-testid="cs-test" />,
    );
    expect(container.querySelector('.cs-wrapper')?.getAttribute('data-value')).toBe('b');
  });

  it('applies custom-select:set-value without opening the menu', () => {
    const onChange = vi.fn();
    const { container } = render(
      <CustomSelect value="a" onChange={onChange} options={simpleOptions} />,
    );
    const wrapper = container.querySelector('.cs-wrapper')!;
    wrapper.dispatchEvent(
      new CustomEvent(CUSTOM_SELECT_SET_VALUE_EVENT, { detail: { value: 'b' } }),
    );
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('ignores custom-select:set-value when value is already selected', () => {
    const onChange = vi.fn();
    const { container } = render(
      <CustomSelect value="b" onChange={onChange} options={simpleOptions} />,
    );
    container.querySelector('.cs-wrapper')!.dispatchEvent(
      new CustomEvent(CUSTOM_SELECT_SET_VALUE_EVENT, { detail: { value: 'b' } }),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks selected option as active with checkmark', () => {
    render(<CustomSelect value="a" onChange={vi.fn()} options={simpleOptions} />);
    fireEvent.click(screen.getByRole('button'));
    const activeOption = document.querySelector('.cs-item.active');
    expect(activeOption).toBeTruthy();
    expect(activeOption?.querySelector('.cs-check')).toBeTruthy();
    expect(activeOption?.getAttribute('aria-selected')).toBe('true');
  });

  it('renders grouped options with group labels', () => {
    render(<CustomSelect value="" onChange={vi.fn()} options={groupedOptions} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('Secondary')).toBeInTheDocument();
    expect(screen.getByText('Red')).toBeInTheDocument();
    expect(screen.getByText('Orange')).toBeInTheDocument();
  });

  it('selects from grouped options correctly', () => {
    const onChange = vi.fn();
    render(<CustomSelect value="" onChange={onChange} options={groupedOptions} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Orange'));
    expect(onChange).toHaveBeenCalledWith('o');
  });

  it('does not open when disabled', () => {
    render(<CustomSelect value="" onChange={vi.fn()} options={simpleOptions} disabled />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('ignores keyboard toggles when disabled', () => {
    render(<CustomSelect value="" onChange={vi.fn()} options={simpleOptions} disabled />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('sets aria-expanded correctly', () => {
    render(<CustomSelect value="" onChange={vi.fn()} options={simpleOptions} />);
    const trigger = screen.getByRole('button');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes on Escape key', () => {
    render(<CustomSelect value="" onChange={vi.fn()} options={simpleOptions} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('passes data-testid and aria-label', () => {
    render(
      <CustomSelect
        value=""
        onChange={vi.fn()}
        options={simpleOptions}
        data-testid="my-select"
        aria-label="Choose option"
      />,
    );
    expect(document.querySelector('[data-testid="my-select"]')).toBeTruthy();
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Choose option');
  });

  it('applies sm size class', () => {
    const { container } = render(
      <CustomSelect value="" onChange={vi.fn()} options={simpleOptions} size="sm" />,
    );
    expect(container.querySelector('.cs-sm')).toBeTruthy();
  });

  it('skips disabled options on click', () => {
    const onChange = vi.fn();
    const opts = [
      { value: 'a', label: 'Active' },
      { value: 'x', label: 'Locked', disabled: true },
    ];
    render(<CustomSelect value="" onChange={onChange} options={opts} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Locked'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes when clicking outside the wrapper', () => {
    render(<CustomSelect value="" onChange={vi.fn()} options={simpleOptions} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('toggles from keyboard input and scrolls the active option into view', () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
    });

    render(<CustomSelect value="b" onChange={vi.fn()} options={simpleOptions} />);
    const trigger = screen.getByRole('button');

    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

    fireEvent.keyDown(trigger, { key: ' ' });
    expect(screen.queryByRole('listbox')).toBeNull();

    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: original,
      configurable: true,
    });
  });

  it('does not re-scroll the active option when the user scrolls inside the menu', () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
    });

    const manyOptions = Array.from({ length: 20 }, (_, i) => ({
      value: `v${i}`,
      label: `Option ${i}`,
    }));
    render(<CustomSelect value="v19" onChange={vi.fn()} options={manyOptions} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    const menu = screen.getByRole('listbox');
    fireEvent.scroll(menu);
    fireEvent.scroll(menu);

    // Menu-internal scrolls must not trigger another scrollIntoView snap-back
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: original,
      configurable: true,
    });
  });

  it('closes other open CustomSelect menus when opening a different one', () => {
    render(
      <>
        <CustomSelect value="" onChange={vi.fn()} options={simpleOptions} aria-label="Distribution" />
        <CustomSelect value="" onChange={vi.fn()} options={simpleOptions} aria-label="Validation" />
      </>,
    );

    const [firstTrigger, secondTrigger] = screen.getAllByRole('button', { name: /Distribution|Validation/ });

    fireEvent.click(firstTrigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.click(secondTrigger);

    expect(screen.getAllByRole('listbox')).toHaveLength(1);
    expect(firstTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(secondTrigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('positions menu upward when there is not enough space below', () => {
    const originalInnerHeight = window.innerHeight;
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

    Object.defineProperty(window, 'innerHeight', { value: 180, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value() {
        return {
          left: 20,
          width: 120,
          top: 160,
          bottom: 170,
          right: 140,
          height: 10,
          x: 20,
          y: 160,
          toJSON: () => ({}),
        };
      },
    });

    render(<CustomSelect value="" onChange={vi.fn()} options={simpleOptions} aria-label="up-select" />);
    fireEvent.click(screen.getByRole('button', { name: 'up-select' }));

    const menu = document.querySelector('.cs-menu') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.classList.contains('cs-menu-up')).toBe(true);
    expect(menu.style.bottom).not.toBe('');

    Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect,
    });
  });

  it('anchors menu to the right edge when trigger is in right half of viewport, overriding CSS left:0 default', () => {
    const originalInnerWidth = window.innerWidth;
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value() {
        return {
          left: 880,
          width: 80,
          top: 50,
          bottom: 60,
          right: 960,
          height: 10,
          x: 880,
          y: 50,
          toJSON: () => ({}),
        };
      },
    });

    render(<CustomSelect value="" onChange={vi.fn()} options={simpleOptions} aria-label="right-select" />);
    fireEvent.click(screen.getByRole('button', { name: 'right-select' }));

    const menu = document.querySelector('.cs-menu') as HTMLElement;
    expect(menu).toBeTruthy();
    // right-anchored: right must be the distance from viewport's right edge
    expect(menu.style.right).toBe('40px'); // 1000 - 960
    // left MUST be explicitly 'auto' — otherwise the .cs-menu class's
    // hardcoded `left: 0` wins the left/right/width over-constraint and
    // pins the menu to the far-left of the viewport (the reported bug).
    expect(menu.style.left).toBe('auto');

    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect,
    });
  });

  it('recomputes anchored position on resize while open', () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    let top = 100;

    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value() {
        return {
          left: 10,
          width: 130,
          top,
          bottom: top + 20,
          right: 140,
          height: 20,
          x: 10,
          y: top,
          toJSON: () => ({}),
        };
      },
    });

    render(<CustomSelect value="" onChange={vi.fn()} options={simpleOptions} aria-label="resize-select" />);
    fireEvent.click(screen.getByRole('button', { name: 'resize-select' }));

    const menuBefore = document.querySelector('.cs-menu') as HTMLElement;
    const beforeTop = menuBefore.style.top;

    top = 150;
    fireEvent(window, new Event('resize'));

    const menuAfter = document.querySelector('.cs-menu') as HTMLElement;
    expect(menuAfter.style.top).not.toBe(beforeTop);

    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect,
    });
  });

  it('bails out of setMenuPos when position is unchanged on resize (stable dimensions)', () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

    // Fixed rect — every call returns the same dimensions.
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value() {
        return { left: 10, width: 130, top: 100, bottom: 120, right: 140, height: 20, x: 10, y: 100, toJSON: () => ({}) };
      },
    });

    render(<CustomSelect value="" onChange={vi.fn()} options={simpleOptions} aria-label="stable-select" />);
    fireEvent.click(screen.getByRole('button', { name: 'stable-select' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    // First resize: position changes from null → computed value.
    fireEvent(window, new Event('resize'));
    // Second resize: same rect → setMenuPos callback returns prev (line 159 bail-out).
    fireEvent(window, new Event('resize'));

    expect(screen.getByRole('listbox')).toBeInTheDocument();

    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect,
    });
  });

  it('closes the menu and clears position when trigger becomes hidden during resize', () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalGetComputedStyle = window.getComputedStyle.bind(window);

    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value() {
        return { left: 10, width: 130, top: 100, bottom: 120, right: 140, height: 20, x: 10, y: 100, toJSON: () => ({}) };
      },
    });

    const { container } = render(<CustomSelect value="" onChange={vi.fn()} options={simpleOptions} aria-label="hide-select" />);
    fireEvent.click(screen.getByRole('button', { name: 'hide-select' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    // Hide the wrapper so isSelectTriggerLaidOut returns false.
    const wrapper = container.firstElementChild as HTMLElement;
    wrapper.style.display = 'none';

    // Trigger recomputeMenuPos via resize — should close the menu.
    fireEvent(window, new Event('resize'));

    expect(screen.queryByRole('listbox')).toBeNull();

    // Restore
    wrapper.style.display = '';
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect,
    });
    vi.spyOn(window, 'getComputedStyle').mockRestore?.();
    Object.defineProperty(window, 'getComputedStyle', { configurable: true, value: originalGetComputedStyle });
  });

  const longOptions = Array.from({ length: 8 }, (_, i) => ({
    value: `v${i}`,
    label: `Option ${i}`,
    detail: i === 5 ? 'Form field exact' : undefined,
  }));

  it('shows a filter field for long lists and narrows grouped results', () => {
    const onChange = vi.fn();
    render(
      <CustomSelect
        value="v0"
        onChange={onChange}
        options={[
          { label: 'Text', options: longOptions.slice(0, 4) },
          { label: 'Form', options: longOptions.slice(4) },
        ]}
        data-testid="op-select"
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    const search = screen.getByTestId('op-select-search');
    expect(search).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'field' } });
    expect(screen.queryByText('Text')).toBeNull();
    expect(screen.getByText('Form')).toBeInTheDocument();
    expect(screen.getByText('Option 5')).toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('v5');
  });

  it('shows an empty state and Escape clears then closes', () => {
    render(<CustomSelect value="" onChange={vi.fn()} options={longOptions} searchable data-testid="long-select" />);
    fireEvent.click(screen.getByRole('button'));
    const search = screen.getByTestId('long-select-search');
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(screen.getByTestId('cs-empty')).toHaveTextContent('No matching options');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens a wide menu to the right of the trigger when menuPlacement is end', () => {
    const originalInnerWidth = window.innerWidth;
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value() {
        return {
          left: 200, width: 120, top: 80, bottom: 108, right: 320, height: 28,
          x: 200, y: 80, toJSON: () => ({}),
        };
      },
    });

    render(
      <CustomSelect
        value=""
        onChange={vi.fn()}
        options={simpleOptions}
        menuPlacement="end"
        menuMinWidth={420}
        aria-label="end-select"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'end-select' }));
    const menu = document.querySelector('.cs-menu') as HTMLElement;
    expect(menu.classList.contains('cs-menu--end')).toBe(true);
    expect(menu.style.left).toBe('326px');
    expect(menu.style.width).toBe('420px');
    expect(menu.style.top).toBe('80px');

    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect,
    });
  });

  it('opens below the trigger and left-aligns when menuAlign is start', () => {
    const originalInnerWidth = window.innerWidth;
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value() {
        return {
          left: 880, width: 210, top: 80, bottom: 112, right: 1090, height: 32,
          x: 880, y: 80, toJSON: () => ({}),
        };
      },
    });

    render(
      <CustomSelect
        value=""
        onChange={vi.fn()}
        options={simpleOptions}
        menuAlign="start"
        menuMinWidth={420}
        aria-label="below-select"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'below-select' }));
    const menu = document.querySelector('.cs-menu') as HTMLElement;
    expect(menu.classList.contains('cs-menu--end')).toBe(false);
    expect(menu.style.left).toBe('880px');
    expect(menu.style.top).toBe('118px');

    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect,
    });
  });

  it('can hide search even on long lists', () => {
    render(<CustomSelect value="" onChange={vi.fn()} options={longOptions} searchable={false} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByTestId('cs-search')).toBeNull();
  });
});
