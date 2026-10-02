const EVENT_HUB_HOST_SUFFIX = '.servicebus.windows.net';

function brokerHost(broker: string): string {
  const trimmed = broker.trim();
  const colon = trimmed.lastIndexOf(':');
  if (colon > 0 && /^\d{2,5}$/.test(trimmed.slice(colon + 1))) {
    return trimmed.slice(0, colon);
  }
  return trimmed;
}

/**
 * Azure Event Hubs Kafka resource for `az account get-access-token --resource`.
 * Derived from the first `*.servicebus.windows.net` bootstrap host.
 */
export function eventHubResourceFromBrokers(brokers: readonly string[]): string | null {
  for (const broker of brokers) {
    const host = brokerHost(broker).toLowerCase();
    if (!host.endsWith(EVENT_HUB_HOST_SUFFIX) || host.includes('/') || host.includes(' ')) {
      continue;
    }
    return `https://${host}`;
  }
  return null;
}
