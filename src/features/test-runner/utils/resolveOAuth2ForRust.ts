import type { AuthConfig, Scenario } from '@shared/types';
import { acquireOAuth2Token } from '@engine/core/tokenManager';

function oauth2CredKey(auth: AuthConfig): string {
  return `${auth.tokenUrl ?? ''}|${auth.clientId ?? ''}|${auth.clientSecret ?? ''}`;
}

export function scenarioUsesOAuth2(scenario: Scenario): boolean {
  return scenario.auth?.type === 'oauth2';
}

/**
 * Acquire OAuth2 client-credentials tokens once and rewrite those scenarios
 * as bearer so the Rust executor can send Authorization headers.
 *
 * Unique token URL / client pairs share one acquire call. The Rust executor
 * does not refresh tokens mid-run — callers should use this for short
 * Rust-only modes (constant-arrival), not long JS-refreshable pool runs.
 */
export async function resolveOAuth2ScenariosForRust(scenarios: Scenario[]): Promise<Scenario[]> {
  const pending = new Map<string, Promise<string>>();

  const tokenFor = (auth: AuthConfig): Promise<string> => {
    const key = oauth2CredKey(auth);
    let inflight = pending.get(key);
    if (!inflight) {
      inflight = acquireOAuth2Token(auth);
      pending.set(key, inflight);
    }
    return inflight;
  };

  return Promise.all(scenarios.map(async (scenario) => {
    if (!scenarioUsesOAuth2(scenario)) return scenario;
    const token = await tokenFor(scenario.auth);
    return {
      ...scenario,
      auth: { type: 'bearer', token, prefix: 'Bearer' },
    };
  }));
}
