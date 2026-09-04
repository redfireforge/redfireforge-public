/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  consumeOpenDockerSettingsRequest,
  OPEN_DOCKER_SETTINGS_EVENT,
  requestOpenDockerSettings,
  resetDockerSettingsNav,
} from './dockerSettingsNav';

describe('dockerSettingsNav', () => {
  beforeEach(() => {
    resetDockerSettingsNav();
  });

  it('consume is false until requested', () => {
    expect(consumeOpenDockerSettingsRequest()).toBe(false);
  });

  it('request sets pending and consume clears it once', () => {
    requestOpenDockerSettings();
    expect(consumeOpenDockerSettingsRequest()).toBe(true);
    expect(consumeOpenDockerSettingsRequest()).toBe(false);
  });

  it('dispatches a window event', () => {
    let seen = false;
    const onOpen = () => { seen = true; };
    window.addEventListener(OPEN_DOCKER_SETTINGS_EVENT, onOpen);
    requestOpenDockerSettings();
    window.removeEventListener(OPEN_DOCKER_SETTINGS_EVENT, onOpen);
    expect(seen).toBe(true);
  });
});
