import { describe, expect, it } from 'vitest';
import { eventHubResourceFromBrokers } from './azureEventHubResource';

describe('eventHubResourceFromBrokers', () => {
  it('uses the Event Hubs namespace host as the token resource', () => {
    expect(eventHubResourceFromBrokers([
      'a218876-t01-musea2-evhns.servicebus.windows.net:9093',
    ])).toBe('https://a218876-t01-musea2-evhns.servicebus.windows.net');
  });

  it('skips local brokers and uses the first Event Hubs host', () => {
    expect(eventHubResourceFromBrokers([
      '127.0.0.1:19092',
      'A218876-T01-MUSEA2-EVHNS.servicebus.windows.net:9093',
    ])).toBe('https://a218876-t01-musea2-evhns.servicebus.windows.net');
  });

  it('accepts a host without a port', () => {
    expect(eventHubResourceFromBrokers([
      'a218876-t01-musea2-evhns.servicebus.windows.net',
    ])).toBe('https://a218876-t01-musea2-evhns.servicebus.windows.net');
  });

  it('returns null when no broker is an Event Hubs namespace', () => {
    expect(eventHubResourceFromBrokers(['127.0.0.1:9092', 'kafka.internal:9093'])).toBeNull();
    expect(eventHubResourceFromBrokers(['not-eventhub.servicebus.windows.net.example.com:9093'])).toBeNull();
    expect(eventHubResourceFromBrokers([])).toBeNull();
  });
});
