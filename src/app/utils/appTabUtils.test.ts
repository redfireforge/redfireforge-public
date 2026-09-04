import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isHarnessTab,
  isWorkflowTab,
  isGalleryTab,
  isApiTab,
  isSettingsTab,
  domainOf,
  readTabFromUrl,
  writeTabToUrl,
  getLastProtocolsTab,
  setLastProtocolsTab,
  PROTOCOLS_DEFAULT_TAB,
} from './appTabUtils';

describe('appTabUtils', () => {
  describe('tab type guards', () => {
    describe('isHarnessTab', () => {
      it('returns true for harness tabs', () => {
        expect(isHarnessTab('scenarios')).toBe(true);
        expect(isHarnessTab('runner')).toBe(true);
        expect(isHarnessTab('workflow-runner')).toBe(true);
        expect(isHarnessTab('results')).toBe(true);
      });

      it('returns false for non-harness tabs', () => {
        expect(isHarnessTab('requests')).toBe(false);
        expect(isHarnessTab('workflow')).toBe(false);
        expect(isHarnessTab('gallery')).toBe(false);
        expect(isHarnessTab('environments')).toBe(false);
      });
    });

    describe('isWorkflowTab', () => {
      it('returns true for workflow tabs', () => {
        expect(isWorkflowTab('workflow')).toBe(true);
        expect(isWorkflowTab('workflow-executions')).toBe(true);
        expect(isWorkflowTab('webhook-deliveries')).toBe(true);
      });

      it('returns false for non-workflow tabs', () => {
        expect(isWorkflowTab('requests')).toBe(false);
        expect(isWorkflowTab('runner')).toBe(false);
        expect(isWorkflowTab('workflow-runner')).toBe(false);
      });
    });

    describe('isGalleryTab', () => {
      it('returns true for gallery tabs', () => {
        expect(isGalleryTab('gallery')).toBe(true);
        expect(isGalleryTab('training')).toBe(true);
      });

      it('returns false for non-gallery tabs', () => {
        expect(isGalleryTab('requests')).toBe(false);
        expect(isGalleryTab('runner')).toBe(false);
      });
    });

    describe('isApiTab', () => {
      it('returns true for api tabs', () => {
        expect(isApiTab('requests')).toBe(true);
        expect(isApiTab('catalog')).toBe(true);
      });

      it('returns false for non-api tabs', () => {
        expect(isApiTab('workflow')).toBe(false);
        expect(isApiTab('runner')).toBe(false);
      });
    });

    describe('isSettingsTab', () => {
      it('returns true for settings tabs', () => {
        expect(isSettingsTab('environments')).toBe(true);
        expect(isSettingsTab('preferences')).toBe(true);
        expect(isSettingsTab('kafka-settings')).toBe(true);
      });

      it('returns false for non-settings tabs', () => {
        expect(isSettingsTab('requests')).toBe(false);
        expect(isSettingsTab('workflow')).toBe(false);
      });
    });
  });

  describe('domainOf', () => {
    it('returns "api" for api tabs', () => {
      expect(domainOf('requests')).toBe('api');
      expect(domainOf('catalog')).toBe('api');
    });

    it('returns "workflow" for workflow tabs', () => {
      expect(domainOf('workflow')).toBe('workflow');
      expect(domainOf('workflow-executions')).toBe('workflow');
      expect(domainOf('webhook-deliveries')).toBe('workflow');
    });

    it('returns "gallery" for gallery tabs', () => {
      expect(domainOf('gallery')).toBe('gallery');
      expect(domainOf('training')).toBe('gallery');
    });

    it('returns "testing" for harness tabs', () => {
      expect(domainOf('scenarios')).toBe('testing');
      expect(domainOf('runner')).toBe('testing');
      expect(domainOf('workflow-runner')).toBe('testing');
      expect(domainOf('results')).toBe('testing');
    });

    it('returns "settings" for settings tabs', () => {
      expect(domainOf('environments')).toBe('settings');
      expect(domainOf('preferences')).toBe('settings');
      expect(domainOf('kafka-settings')).toBe('settings');
    });

    it('returns "api-mock" for the API Mock studio', () => {
      expect(domainOf('api-mock-studio')).toBe('api-mock');
    });

    it('returns "protocols" for protocol studio tabs', () => {
      expect(domainOf('kafka-message-studio')).toBe('protocols');
      expect(domainOf('graphql-studio')).toBe('protocols');
      expect(domainOf('grpc-studio')).toBe('protocols');
    });
  });

  describe('last protocols tab memory', () => {
    beforeEach(() => {
      setLastProtocolsTab(PROTOCOLS_DEFAULT_TAB);
    });

    it('defaults to kafka-message-studio', () => {
      expect(getLastProtocolsTab()).toBe('kafka-message-studio');
    });

    it('remembers the last protocols sub-tab', () => {
      setLastProtocolsTab('graphql-studio');
      expect(getLastProtocolsTab()).toBe('graphql-studio');
    });

    it('ignores non-protocols tabs', () => {
      setLastProtocolsTab('graphql-studio');
      setLastProtocolsTab('demo-hub');
      expect(getLastProtocolsTab()).toBe('graphql-studio');
    });
  });

  describe('readTabFromUrl', () => {
    const originalWindow = global.window;

    beforeEach(() => {
      // @ts-expect-error - mock window
      global.window = {
        location: {
          search: '',
        },
      };
    });

    afterEach(() => {
      global.window = originalWindow;
    });

    it('returns default tab (requests) when no query param', () => {
      global.window.location.search = '';
      expect(readTabFromUrl()).toBe('requests');
    });

    it('returns tab from query param when valid', () => {
      global.window.location.search = '?tab=workflow';
      expect(readTabFromUrl()).toBe('workflow');
    });

    it('returns kafka-settings when query param is kafka-settings', () => {
      global.window.location.search = '?tab=kafka-settings';
      expect(readTabFromUrl()).toBe('kafka-settings');
    });

    it('returns api-mock-studio so a refresh stays on the API Mock studio', () => {
      global.window.location.search = '?tab=api-mock-studio';
      expect(readTabFromUrl()).toBe('api-mock-studio');
    });

    it('returns default tab for invalid tab value', () => {
      global.window.location.search = '?tab=invalid-tab';
      expect(readTabFromUrl()).toBe('requests');
    });

    it('handles other query params correctly', () => {
      global.window.location.search = '?other=value&tab=runner&more=params';
      expect(readTabFromUrl()).toBe('runner');
    });

    it('returns default when URLSearchParams throws', () => {
      // @ts-expect-error - deliberately break window.location
      global.window.location = null;
      expect(readTabFromUrl()).toBe('requests');
    });
  });

  describe('writeTabToUrl', () => {
    const originalWindow = global.window;
    let replaceStateMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      replaceStateMock = vi.fn();
      // @ts-expect-error - mock window
      global.window = {
        location: {
          href: 'http://localhost:5173/',
          pathname: '/',
          search: '',
          hash: '',
        },
        history: {
          state: null,
          replaceState: replaceStateMock,
        },
      };
    });

    afterEach(() => {
      global.window = originalWindow;
    });

    it('deletes tab param for default tab (requests)', () => {
      global.window.location.href = 'http://localhost:5173/?tab=workflow';
      global.window.location.search = '?tab=workflow';
      
      writeTabToUrl('requests');
      
      expect(replaceStateMock).toHaveBeenCalledWith(null, '', '/');
    });

    it('sets tab param for non-default tab', () => {
      writeTabToUrl('workflow');
      
      expect(replaceStateMock).toHaveBeenCalledWith(null, '', '/?tab=workflow');
    });

    it('sets tab param for kafka settings tab', () => {
      writeTabToUrl('kafka-settings');

      expect(replaceStateMock).toHaveBeenCalledWith(null, '', '/?tab=kafka-settings');
    });

    it('does not call replaceState if URL is unchanged', () => {
      global.window.location.href = 'http://localhost:5173/?tab=workflow';
      global.window.location.search = '?tab=workflow';
      global.window.location.pathname = '/';
      
      writeTabToUrl('workflow');
      
      expect(replaceStateMock).not.toHaveBeenCalled();
    });

    it('preserves hash in URL', () => {
      global.window.location.href = 'http://localhost:5173/#section';
      global.window.location.hash = '#section';
      
      writeTabToUrl('runner');
      
      expect(replaceStateMock).toHaveBeenCalledWith(null, '', '/?tab=runner#section');
    });

    it('handles errors gracefully', () => {
      // @ts-expect-error - deliberately break window.location
      global.window.location = null;
      
      // Should not throw
      expect(() => writeTabToUrl('workflow')).not.toThrow();
    });

    it('does not touch history inside the Tauri webview', () => {
      (global.window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};
      writeTabToUrl('workflow');
      expect(replaceStateMock).not.toHaveBeenCalled();
    });
  });
});
