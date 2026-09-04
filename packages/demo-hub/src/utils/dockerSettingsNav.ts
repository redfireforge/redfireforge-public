/** Custom event + pending flag so the lesson gate can open Settings → Docker. */

export const OPEN_DOCKER_SETTINGS_EVENT = 'rff-open-docker-settings';

let pendingDockerSettings = false;

export function requestOpenDockerSettings(): void {
  pendingDockerSettings = true;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPEN_DOCKER_SETTINGS_EVENT));
  }
}

export function consumeOpenDockerSettingsRequest(): boolean {
  if (!pendingDockerSettings) return false;
  pendingDockerSettings = false;
  return true;
}

/** Test helper — do not call from product code. */
export function resetDockerSettingsNav(): void {
  pendingDockerSettings = false;
}
