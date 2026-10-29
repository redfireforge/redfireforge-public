import { describe, expect, it } from 'vitest';
import { formatKafkaHeadersForClipboard, parseKafkaHeadersClipboard } from './kafkaHeaderClipboard';

describe('kafkaHeaderClipboard', () => {
  it('round-trips a header record through JSON', () => {
    const text = formatKafkaHeadersForClipboard({
      'deployment.env': 'd01',
      'application.name': 'ons-enrollment-core',
    });
    expect(parseKafkaHeadersClipboard(text)).toEqual([
      { key: 'deployment.env', value: 'd01' },
      { key: 'application.name', value: 'ons-enrollment-core' },
    ]);
  });

  it('parses an object map and tab-separated table text', () => {
    expect(parseKafkaHeadersClipboard('{"cei.environment":"idt1"}')).toEqual([
      { key: 'cei.environment', value: 'idt1' },
    ]);
    expect(parseKafkaHeadersClipboard('Key\tValue\napplication.name\tons-enrollment-core')).toEqual([
      { key: 'application.name', value: 'ons-enrollment-core' },
    ]);
  });

  it('rejects empty clipboard text', () => {
    expect(parseKafkaHeadersClipboard('   ')).toBeNull();
    expect(parseKafkaHeadersClipboard('not headers')).toBeNull();
    expect(parseKafkaHeadersClipboard('[]')).toBeNull();
    expect(parseKafkaHeadersClipboard('1')).toBeNull();
    expect(parseKafkaHeadersClipboard('{" ": "blank"}')).toBeNull();
  });

  it('formats tuple rows and keeps named or numeric values', () => {
    expect(formatKafkaHeadersForClipboard([['ce-type', 'order']])).toContain('"key": "ce-type"');
    expect(parseKafkaHeadersClipboard(JSON.stringify([
      null,
      4,
      { key: '  ' },
      { name: 'ce-type', value: null },
      { key: 'count', value: 3 },
    ]))).toEqual([
      { key: 'ce-type', value: '' },
      { key: 'count', value: '3' },
    ]);
  });

  it('parses equals and colon lines and skips a header row', () => {
    expect(parseKafkaHeadersClipboard([
      'Key\tValue',
      '\tskipped',
      'application.name\tons\tcore',
      '',
      'Key: ignored',
      'cei.environment=idt1',
      'domain: ONS',
      '=novalue',
    ].join('\r\n'))).toEqual([
      { key: 'application.name', value: 'ons\tcore' },
      { key: 'cei.environment', value: 'idt1' },
      { key: 'domain', value: 'ONS' },
    ]);
  });
});
