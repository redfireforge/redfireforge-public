import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  shouldShowWebDownloadCta,
  isDesktopOnlyTab,
  getBlockedDesktopFeature,
  featureRequiresDesktopReason,
} from './desktopFeatureGate';

const mockIsTauri = vi.fn(() => false);
const mockIsLocalhost = vi.fn(() => false);
const mockIsDesktopRuntimeAvailable = vi.fn(() => false);
vi.mock('@shared/utils/platform', () => ({
  isTauri: () => mockIsTauri(),
  isLocalhost: () => mockIsLocalhost(),
  isDesktopRuntimeAvailable: () => mockIsDesktopRuntimeAvailable(),
}));

describe('desktopFeatureGate', () => {
  beforeEach(() => {
    mockIsTauri.mockReturnValue(false);
    mockIsLocalhost.mockReturnValue(false);
    mockIsDesktopRuntimeAvailable.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldShowWebDownloadCta', () => {
    it('is true only on hosted web', () => {
      expect(shouldShowWebDownloadCta()).toBe(true);
    });

    it('is false on Tauri', () => {
      mockIsDesktopRuntimeAvailable.mockReturnValue(true);
      expect(shouldShowWebDownloadCta()).toBe(false);
    });

    it('is false on localhost / local clone', () => {
      mockIsDesktopRuntimeAvailable.mockReturnValue(true);
      expect(shouldShowWebDownloadCta()).toBe(false);
    });
  });

  describe('isDesktopOnlyTab', () => {
    it('flags API Mock, gRPC, and Kafka Studio', () => {
      expect(isDesktopOnlyTab('api-mock-studio')).toBe(true);
      expect(isDesktopOnlyTab('grpc-studio')).toBe(true);
      expect(isDesktopOnlyTab('kafka-message-studio')).toBe(true);
      expect(isDesktopOnlyTab('requests')).toBe(false);
      expect(isDesktopOnlyTab('graphql-studio')).toBe(false);
    });
  });

  describe('getBlockedDesktopFeature', () => {
    it('returns feature name on hosted web for desktop-only tabs', () => {
      expect(getBlockedDesktopFeature('api-mock-studio')).toBe('API Mock Server');
      expect(getBlockedDesktopFeature('grpc-studio')).toBe('gRPC Studio');
      expect(getBlockedDesktopFeature('kafka-message-studio')).toBe('Kafka Studio');
    });

    it('returns null for web-safe tabs', () => {
      expect(getBlockedDesktopFeature('requests')).toBeNull();
    });

    it('returns null on Tauri and localhost', () => {
      mockIsDesktopRuntimeAvailable.mockReturnValue(true);
      expect(getBlockedDesktopFeature('grpc-studio')).toBeNull();
    });
  });

  describe('featureRequiresDesktopReason', () => {
    it('returns specific reasons per feature', () => {
      expect(featureRequiresDesktopReason('API Mock Server')).toContain('local ports');
      expect(featureRequiresDesktopReason('gRPC Studio')).toContain('gRPC');
      expect(featureRequiresDesktopReason('Kafka Studio')).toContain('broker');
      expect(featureRequiresDesktopReason('Something Else')).toContain('Something Else');
    });
  });
});
