import { describe, it, expect } from 'vitest';
import { resolvePathParamUrl, findUrlPrefix } from './pathParamResolver';

describe('findUrlPrefix', () => {
  it('finds prefix for absolute URL with server path prefix', () => {
    expect(findUrlPrefix(
      'https://orders.example.com/api/v1/orders/management/{orderId}/fulfillment/offers',
      '/orders/management/{orderId}/fulfillment/offers',
    )).toBe('https://orders.example.com/api/v1');
  });

  it('finds prefix for relative URL', () => {
    expect(findUrlPrefix(
      '/api/v2/pet/123/uploadImage',
      '/pet/{petId}/uploadImage',
    )).toBe('/api/v2');
  });

  it('returns empty when originalPath is the full URL path', () => {
    expect(findUrlPrefix(
      '/orders/management/{orderId}/fulfillment/offers',
      '/orders/management/{orderId}/fulfillment/offers',
    )).toBe('');
  });

  it('returns empty prefix when anchor token is absent from URL', () => {
    expect(findUrlPrefix('/other/things', '/api/pet/{id}')).toBe('');
  });

  it('returns empty prefix when template is purely placeholders', () => {
    expect(findUrlPrefix('/foo/bar', '{a}/{b}')).toBe('');
  });

  it('returns empty prefix when anchor exists in template but occurs before pathname in oddly shaped urls', () => {
    expect(findUrlPrefix('/z/y/x', '/a/b')).toBe('');
  });

  it('extracts prefix when first concrete segment follows leading placeholders', () => {
    expect(findUrlPrefix(
      '/service/v99/{tenant}/data',
      '/{tenant}/data',
    )).toBe('/service/v99');
  });
});

describe('resolvePathParamUrl', () => {
  const realOriginalPath = '/orders/management/{orderId}/fulfillment/offers';
  const realBaseUrl = 'https://order-api.example.com/v1';

  describe('normal URL with placeholder', () => {
    const normalUrl = `${realBaseUrl}/orders/management/{orderId}/fulfillment/offers`;

    it('substitutes orderId value', () => {
      const result = resolvePathParamUrl(normalUrl, realOriginalPath, [
        { key: 'orderId', value: 'ORD-1001' },
      ]);
      expect(result).toBe(
        `${realBaseUrl}/orders/management/ORD-1001/fulfillment/offers`,
      );
      expect(result).not.toContain('{orderId}');
    });

    it('leaves placeholder when value is empty', () => {
      const result = resolvePathParamUrl(normalUrl, realOriginalPath, [
        { key: 'orderId', value: '' },
      ]);
      expect(result).toBe(normalUrl);
      expect(result).toContain('{orderId}');
    });
  });

  describe('URL with previously filled value', () => {
    const filledUrl = `${realBaseUrl}/orders/management/ORD-1001/fulfillment/offers`;

    it('restores placeholder when value is cleared', () => {
      const result = resolvePathParamUrl(filledUrl, realOriginalPath, [
        { key: 'orderId', value: '' },
      ]);
      expect(result).toBe(
        `${realBaseUrl}/orders/management/{orderId}/fulfillment/offers`,
      );
    });

    it('changes to a different value', () => {
      const result = resolvePathParamUrl(filledUrl, realOriginalPath, [
        { key: 'orderId', value: 'ABC999' },
      ]);
      expect(result).toBe(
        `${realBaseUrl}/orders/management/ABC999/fulfillment/offers`,
      );
    });
  });

  describe('corrupted URL recovery', () => {
    const corruptedUrl = `${realBaseUrl}ORD-1001/orders/management/ORD-1001/fulfillment/offers`;

    it('rebuilds path portion correctly even if prefix is corrupted', () => {
      const result = resolvePathParamUrl(corruptedUrl, realOriginalPath, [
        { key: 'orderId', value: 'NEW-ID' },
      ]);
      expect(result).toContain('/orders/management/NEW-ID/fulfillment/offers');
      expect(result).not.toContain('/management/ORD-1001/');
    });

    it('restores placeholder in path portion when value is cleared', () => {
      const result = resolvePathParamUrl(corruptedUrl, realOriginalPath, [
        { key: 'orderId', value: '' },
      ]);
      expect(result).toContain('/orders/management/{orderId}/fulfillment/offers');
      expect(result).not.toContain('/management/ORD-1001/');
    });
  });

  describe('with query string', () => {
    it('preserves query string when substituting', () => {
      const url = `${realBaseUrl}/orders/management/{orderId}/fulfillment/offers?channel=WEB&country=US`;
      const result = resolvePathParamUrl(url, realOriginalPath, [
        { key: 'orderId', value: 'ORD-123' },
      ]);
      expect(result).toBe(
        `${realBaseUrl}/orders/management/ORD-123/fulfillment/offers?channel=WEB&country=US`,
      );
    });

    it('preserves query string when clearing', () => {
      const url = `${realBaseUrl}/orders/management/ORD-123/fulfillment/offers?channel=WEB&country=US`;
      const result = resolvePathParamUrl(url, realOriginalPath, [
        { key: 'orderId', value: '' },
      ]);
      expect(result).toContain('{orderId}');
      expect(result).toContain('?channel=WEB&country=US');
    });

    it('handles multiple query question marks conservatively', () => {
      const url = `${realBaseUrl}/orders/management/{orderId}/fulfillment/offers?raw=q1?q2=q3`;
      const result = resolvePathParamUrl(url, realOriginalPath, [{ key: 'orderId', value: 'ZZ' }]);
      expect(result).toContain('/orders/management/ZZ/fulfillment/offers');
      expect(result).toContain('?raw=q1?q2=q3');
    });
  });

  describe('petstore-style (short originalPath, server path prefix)', () => {
    const petOriginalPath = '/pet/{petId}/uploadImage';

    it('substitutes petId', () => {
      const result = resolvePathParamUrl(
        'https://petstore.swagger.io/v2/pet/123/uploadImage',
        petOriginalPath,
        [{ key: 'petId', value: '456' }],
      );
      expect(result).toBe('https://petstore.swagger.io/v2/pet/456/uploadImage');
    });

    it('restores placeholder', () => {
      const result = resolvePathParamUrl(
        'https://petstore.swagger.io/v2/pet/123/uploadImage',
        petOriginalPath,
        [{ key: 'petId', value: '' }],
      );
      expect(result).toBe('https://petstore.swagger.io/v2/pet/{petId}/uploadImage');
    });
  });

  describe('multiple path params', () => {
    const multiOriginalPath = '/users/{userId}/posts/{postId}';

    it('substitutes both', () => {
      const result = resolvePathParamUrl(
        'https://api.example.com/v1/users/42/posts/100',
        multiOriginalPath,
        [{ key: 'userId', value: '42' }, { key: 'postId', value: '200' }],
      );
      expect(result).toBe('https://api.example.com/v1/users/42/posts/200');
    });

    it('clears one, keeps the other', () => {
      const result = resolvePathParamUrl(
        'https://api.example.com/v1/users/42/posts/100',
        multiOriginalPath,
        [{ key: 'userId', value: '' }, { key: 'postId', value: '100' }],
      );
      expect(result).toBe('https://api.example.com/v1/users/{userId}/posts/100');
    });

    it('clears both', () => {
      const result = resolvePathParamUrl(
        'https://api.example.com/v1/users/42/posts/100',
        multiOriginalPath,
        [{ key: 'userId', value: '' }, { key: 'postId', value: '' }],
      );
      expect(result).toBe('https://api.example.com/v1/users/{userId}/posts/{postId}');
    });
  });

  describe('relative URL (no host)', () => {
    it('handles relative URL with prefix', () => {
      const result = resolvePathParamUrl(
        '/api/v1/orders/management/{orderId}/fulfillment/offers',
        '/orders/management/{orderId}/fulfillment/offers',
        [{ key: 'orderId', value: 'ABC' }],
      );
      expect(result).toBe('/api/v1/orders/management/ABC/fulfillment/offers');
    });
  });
});
