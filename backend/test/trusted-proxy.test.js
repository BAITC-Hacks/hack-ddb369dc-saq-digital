import assert from 'node:assert/strict';
import test from 'node:test';
import { trustedProxyFor } from '../src/trusted-proxy.js';

test('trusts only the resolved frontend address and updates it on refresh', async () => {
  let resolvedAddress = '172.18.0.3';
  const proxy = trustedProxyFor('frontend', async (hostname, options) => {
    assert.equal(hostname, 'frontend');
    assert.deepEqual(options, { all: true });
    return [{ address: resolvedAddress }];
  });
  assert.equal(proxy.isTrusted(resolvedAddress), false);
  await proxy.refresh();
  assert.equal(proxy.isTrusted(resolvedAddress), true);
  assert.equal(proxy.isTrusted('::ffff:172.18.0.3'), true);
  assert.equal(proxy.isTrusted('172.18.0.4'), false);
  resolvedAddress = '172.18.0.4';
  await proxy.refresh();
  assert.equal(proxy.isTrusted('172.18.0.3'), false);
  assert.equal(proxy.isTrusted(resolvedAddress), true);
});

test('fails closed when frontend DNS disappears', async () => {
  let fails = false;
  const proxy = trustedProxyFor('frontend', async () => {
    if (fails) throw new Error('DNS unavailable');
    return [{ address: '172.18.0.3' }];
  });
  await proxy.refresh();
  fails = true;
  await proxy.refresh();
  assert.equal(proxy.isTrusted('172.18.0.3'), false);
});
