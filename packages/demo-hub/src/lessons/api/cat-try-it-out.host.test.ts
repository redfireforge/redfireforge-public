/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  catTryItOutLesson,
  findPreferredEnvOption,
  findPreferredMicroserviceOption,
  readLinkedMicroserviceName,
} from './cat-try-it-out';

describe('CAT-2 Environment host strategy selection', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('prefers jsonplaceholder over the first product microservice', () => {
    document.body.innerHTML = `
      <div class="cat-dark-select__option"><span class="cat-dark-select__option-label">— None —</span></div>
      <div class="cat-dark-select__option"><span class="cat-dark-select__option-label">inventory-api</span></div>
      <div class="cat-dark-select__option"><span class="cat-dark-select__option-label">jsonplaceholder</span></div>
    `;
    const pick = findPreferredMicroserviceOption('jsonplaceholder');
    expect(pick?.textContent?.trim()).toBe('jsonplaceholder');
  });

  it('prefers the demo env with the JSONPlaceholder base URL', () => {
    document.body.innerHTML = `
      <div class="cs-item">101 (no base URL)</div>
      <div class="cs-item">demo — https://jsonplaceholder.typicode.com</div>
      <div class="cs-item">test — https://example.internal</div>
    `;
    const items = Array.from(document.querySelectorAll<HTMLElement>('.cs-item'));
    const pick = findPreferredEnvOption(items, 'demo');
    expect(pick?.textContent).toContain('demo');
    expect(pick?.textContent).toContain('jsonplaceholder');
  });

  it('reads linked microservice name without the Change button text', () => {
    document.body.innerHTML = `
      <span data-testid="catalog-host-svc-label">
        inventory-api
        <button data-testid="catalog-host-svc-change">Change</button>
      </span>
    `;
    expect(readLinkedMicroserviceName()).toBe('inventory-api');
  });
});

describe('catTryItOutLesson boot surface', () => {
  it('arms Endpoints landing so Start Demo skips Overview/Welcome hop', () => {
    expect(catTryItOutLesson.initialSurface).toEqual({ catalogView: 'endpoints' });
    expect(typeof catTryItOutLesson.prepareBeforeNavigate).toBe('function');
  });
});
