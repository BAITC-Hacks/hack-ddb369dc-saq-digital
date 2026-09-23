import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { OpenAIQueryParser } from '../src/ai.js';
import { loadCatalog } from '../src/catalog.js';
import { fileURLToPath } from 'node:url';
import { catalog } from './fixtures.js';

async function withServer(run, options, products = catalog) {
  const server = createApp(products, options).listen(0);
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function post(base, path, body, sessionId) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(sessionId && { 'X-Session-Id': sessionId }) }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function getCart(base, sessionId) {
  return (await fetch(`${base}/api/cart`, { headers: { 'X-Session-Id': sessionId } })).json();
}

test('partner import allows sessions and cart reads, then publishes products to the same session', async () => {
  const imported = [];
  const catalogState = { status: 'loading', source: 'partner', products: 0 };
  await withServer(async (base) => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.catalog.status, 'loading');
    const { status, body: { sessionId } } = await post(base, '/api/session', {});
    assert.equal(status, 201);
    assert.ok(sessionId);
    assert.deepEqual(await getCart(base, sessionId), { items: [], totalPriceKzt: 0 });
    for (const path of ['/api/search', '/api/cart', '/api/uploads']) {
      const blocked = await post(base, path, { query: 'EXACT' });
      assert.equal(blocked.status, 503);
      assert.equal(blocked.body.error.code, 'CATALOG_LOADING');
    }
    imported.push(...catalog);
    Object.assign(catalogState, { status: 'ready', products: imported.length });
    const found = await post(base, '/api/search', { query: 'SKU-EXACT' }, sessionId);
    assert.equal(found.status, 200);
    assert.equal(found.body.exactMatch.product.sku, 'EXACT');
    const added = await post(base, '/api/cart', { sku: 'EXACT', quantity: 1, confirmed: true, confirmationId: 'import-ready' }, sessionId);
    assert.equal(added.body.items[0].quantity, 1);
  }, { catalogState }, imported);
});

test('cold-start conversation and purchase terms work without AI or product claims', async () => {
  for (const status of ['loading', 'failed']) {
    const options = {
      catalogState: { status, source: 'partner', products: 0 },
      purchaseTerms: { payment: 'Оплата по счёту.', delivery: 'Доставка курьером.', minimumOrder: 'Кратность указана в карточке.', sourceUrl: 'https://example.org/terms' },
    };
    await withServer(async (base) => {
      const { body: { sessionId } } = await post(base, '/api/session', {});
      for (const query of ['Здравствуйте', 'Есть SKU-EXACT?', '3P C16, 10 kA, 8 штук']) {
        const result = await post(base, '/api/search', { query, conversation: true }, sessionId);
        assert.equal(result.status, 200);
        assert.equal(result.body.intent, 'conversation');
        assert.equal(result.body.notice, status === 'loading' ? 'CATALOG_LOADING' : 'CATALOG_UNAVAILABLE');
        assert.equal(result.body.exactMatch, null);
        assert.deepEqual(result.body.alternatives, []);
        assert.doesNotMatch(result.body.answer, /0 товаров|не найден/);
        if (query === 'Здравствуйте') assert.match(result.body.answer, /Здравствуйте/);
      }
      for (const conversation of [false, true]) {
        const terms = await post(base, '/api/search', { query: 'Как оплатить и заказать доставку?', conversation }, sessionId);
        assert.equal(terms.status, 200);
        assert.equal(terms.body.intent, 'purchase_terms');
        assert.match(terms.body.answer, /Оплата по счёту\. Доставка курьером\./);
        assert.equal(terms.body.sourceUrl, options.purchaseTerms.sourceUrl);
      }
      const excessive = await post(base, '/api/search', { query: 'a'.repeat(4001), conversation: true }, sessionId);
      assert.equal(excessive.status, 400);
      assert.equal(excessive.body.error.code, 'INVALID_BODY');
      assert.deepEqual(await getCart(base, sessionId), { items: [], totalPriceKzt: 0 });
    }, options, []);
  }
});

test('catalog outage keeps AI conversation available without inventing inventory', async () => {
  let topic = 'capabilities';
  const catalogState = { status: 'failed', source: 'partner', products: 0 };
  const queryParser = { reply: async (_query, facts) => {
    assert.equal(facts.catalogStatus, 'failed');
    assert.deepEqual(facts.catalog, []);
    return { kind: topic === 'out_of_scope' ? 'out_of_scope' : 'answer', topic, answer: 'Invented stock: 900 units.', filters: {} };
  } };
  await withServer(async (base) => {
    const { body: { sessionId } } = await post(base, '/api/session', {});
    const greeting = await post(base, '/api/search', { query: 'Как ты можешь помочь?', conversation: true }, sessionId);
    assert.equal(greeting.status, 200);
    assert.match(greeting.body.answer, /Я помощник EKT/);
    topic = 'overview';
    const inventory = await post(base, '/api/search', { query: 'че там по товарам', conversation: true }, sessionId);
    assert.equal(inventory.body.notice, 'CATALOG_UNAVAILABLE');
    assert.doesNotMatch(inventory.body.answer, /900/);
    topic = 'out_of_scope';
    const unrelated = await post(base, '/api/search', { query: 'Расскажи про политику', conversation: true }, sessionId);
    assert.match(unrelated.body.answer, /возможностями этого сайта/);
    const cart = await post(base, '/api/search', { query: 'Что в моей корзине?', conversation: true }, sessionId);
    assert.match(cart.body.answer, /нет товаров/);
    assert.deepEqual(await getCart(base, sessionId), { items: [], totalPriceKzt: 0 });
  }, { catalogState, queryParser }, []);
});

test('catalog revisions invalidate repeated conversation results without appending duplicate cache notes', async () => {
  const products = catalog.map((product) => ({ ...product }));
  const catalogState = {
    status: 'ready', source: 'partner', products: products.length,
    loadedAt: '2026-09-22T12:00:00.000Z', cached: true, refreshing: true, stale: true,
  };
  await withServer(async (base) => {
    const { body: { sessionId } } = await post(base, '/api/session', {});
    const query = { query: 'SKU-EXACT', conversation: true };
    const first = await post(base, '/api/search', query, sessionId);
    const retry = await post(base, '/api/search', query, sessionId);
    assert.deepEqual(retry.body, first.body);
    assert.equal(first.body.catalog.loadedAt, catalogState.loadedAt);
    assert.equal(first.body.catalog.refreshing, true);
    assert.equal(first.body.answer.split('Данные каталога сохранены').length, 2);
    const oldProduct = first.body.exactMatch.product;
    products.splice(0, products.length, ...products.map((product) => product.sku === 'EXACT'
      ? { ...product, priceKzt: product.priceKzt + 100, stock: product.stock + 10 }
      : product));
    Object.assign(catalogState, { loadedAt: '2026-09-23T12:00:00.000Z', cached: false, refreshing: false, stale: false });
    const fresh = await post(base, '/api/search', query, sessionId);
    assert.equal(fresh.body.exactMatch.product.priceKzt, oldProduct.priceKzt + 100);
    assert.equal(fresh.body.exactMatch.product.stock, oldProduct.stock + 10);
    assert.equal(fresh.body.catalog.loadedAt, catalogState.loadedAt);
    assert.doesNotMatch(fresh.body.answer, /Данные каталога сохранены/);
    assert.deepEqual(await getCart(base, sessionId), { items: [], totalPriceKzt: 0 });
  }, { catalogState }, products);
});

test('a failed live import returns an explicit unavailable error instead of demo products', async () => {
  await withServer(async (base) => {
    const response = await post(base, '/api/search', { query: 'SKU-EXACT' });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'CATALOG_UNAVAILABLE');
  }, { catalogState: { status: 'failed', source: 'partner', products: 0 } }, []);
});

test('health checks require no session, make no AI calls, and preserve cart state', async () => {
  await withServer(async (base) => {
    const { body: { sessionId } } = await post(base, '/api/session', {});
    const { body: cart } = await post(base, '/api/cart', {
      sku: 'EXACT', quantity: 1, confirmed: true, confirmationId: 'health-check',
    }, sessionId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${base}/api/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'ok' });
    }
    assert.deepEqual(await getCart(base, sessionId), cart);
  }, { queryParser: { extract: () => assert.fail('Health checks must not call OpenAI') } });
});

test('search leaves cart untouched, confirmation adds once', async () => {
  await withServer(async (base) => {
    const { body: { sessionId } } = await post(base, '/api/session', {});
    const search = await post(base, '/api/search', { query: '3P C16, 10 kA, 8 штук' });
    assert.equal(search.status, 200);
    assert.equal(search.body.alternatives[0].product.sku, 'ALT-15');
    assert.deepEqual(await getCart(base, sessionId), { items: [], totalPriceKzt: 0 });

    const request = { sku: 'ALT-15', quantity: 8, confirmed: true, confirmationId: 'click-1' };
    const first = await post(base, '/api/cart', request, sessionId);
    const retry = await post(base, '/api/cart', request, sessionId);
    assert.equal(first.status, 200);
    assert.deepEqual(retry.body, first.body);
    assert.equal(retry.body.items[0].quantity, 8);
  });
});

test('API rejects missing confirmation and malformed query', async () => {
  await withServer(async (base) => {
    const { body: { sessionId } } = await post(base, '/api/session', {});
    const cart = await post(base, '/api/cart', { sku: 'EXACT', quantity: 1, confirmed: false, confirmationId: 'click-2' }, sessionId);
    assert.equal(cart.status, 400);
    const search = await post(base, '/api/search', { query: 'автомат' });
    assert.equal(search.status, 422);
    assert.deepEqual(await getCart(base, sessionId), { items: [], totalPriceKzt: 0 });
  });
});

test('cart state is isolated by session', async () => {
  await withServer(async (base) => {
    const { body: { sessionId: first } } = await post(base, '/api/session', {});
    const { body: { sessionId: second } } = await post(base, '/api/session', {});
    await post(base, '/api/cart', { sku: 'EXACT', quantity: 1, confirmed: true, confirmationId: 'click-3' }, first);
    assert.equal((await getCart(base, first)).items.length, 1);
    assert.deepEqual(await getCart(base, second), { items: [], totalPriceKzt: 0 });
    const missingSession = await fetch(`${base}/api/cart`);
    assert.equal(missingSession.status, 401);
  });
});

test('product context is available only in the same session', async () => {
  await withServer(async (base) => {
    const { body: { sessionId: first } } = await post(base, '/api/session', {});
    const { body: { sessionId: second } } = await post(base, '/api/session', {});
    await post(base, '/api/search', { query: 'Артикул SKU-EXACT' }, first);
    const followUp = await post(base, '/api/search', { query: 'А сертификат есть?' }, first);
    assert.equal(followUp.status, 200);
    assert.match(followUp.body.answer, /certificate.pdf/);
    const otherSession = await post(base, '/api/search', { query: 'А сертификат есть?' }, second);
    assert.equal(otherSession.status, 422);
  });
});

test('uses validated AI filters only to search local catalog', async () => {
  let calls = 0;
  await withServer(async (base) => {
    const result = await post(base, '/api/search', { query: 'Нужны восемь таких автоматов' });
    assert.equal(result.status, 200);
    assert.equal(result.body.alternatives[0].product.sku, 'ALT-15');
    assert.equal(calls, 1);
  }, { queryParser: { extract: async () => {
    calls += 1;
    return { poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 10, quantity: 8 };
  } } });
});

test('cart response includes the configured frontend cart route', async () => {
  await withServer(async (base) => {
    const { body: { sessionId } } = await post(base, '/api/session', {});
    const result = await post(base, '/api/cart', {
      sku: 'EXACT', quantity: 1, confirmed: true, confirmationId: 'cart-link-1',
    }, sessionId);
    assert.equal(result.status, 200);
    assert.equal(result.body.cartUrl, '/cart');
    assert.equal(result.body.items[0].quantity, 1);
  }, { cartUrl: '/cart' });
});

test('OpenAI extraction searches catalog data without mutating the cart', async () => {
  let calls = 0;
  const queryParser = new OpenAIQueryParser({
    url: 'https://example.org/responses', model: 'demo', apiKey: 'dummy',
    fetcher: async () => {
      calls += 1;
      return { ok: true, json: async () => ({
        status: 'completed',
        output: [{ type: 'message', role: 'assistant', content: [{
          type: 'output_text', text: JSON.stringify({ poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 10, quantity: 8 }),
        }] }],
      }) };
    },
  });
  await withServer(async (base) => {
    const { body: { sessionId } } = await post(base, '/api/session', {});
    await post(base, '/api/search', { query: '3P C16, 10 kA, 8 штук' }, sessionId);
    assert.equal(calls, 0, 'Local parsing must not spend an API call');
    const result = await post(base, '/api/search', {
      query: 'Восемь трёхполюсных автоматов, кривая C, шестнадцать ампер, десять килоампер',
    }, sessionId);
    assert.equal(result.status, 200);
    assert.equal(result.body.alternatives[0].product.sku, 'ALT-15');
    assert.equal(result.body.filters.quantity, 8);
    assert.equal(calls, 1);
    assert.deepEqual(await getCart(base, sessionId), { items: [], totalPriceKzt: 0 });
  }, { queryParser });
});

test('OpenAI outages preserve the local clarification response and existing cart', async () => {
  const queryParser = new OpenAIQueryParser({
    url: 'https://example.org/responses', model: 'demo', apiKey: 'dummy',
    fetcher: async () => ({ ok: false, status: 503 }),
  });
  await withServer(async (base) => {
    const { body: { sessionId } } = await post(base, '/api/session', {});
    const { body: cart } = await post(base, '/api/cart', {
      sku: 'EXACT', quantity: 1, confirmed: true, confirmationId: 'before-ai-failure',
    }, sessionId);
    const result = await post(base, '/api/search', { query: 'нужен автомат' }, sessionId);
    assert.equal(result.status, 422);
    assert.equal(result.body.error.code, 'MISSING_SPECIFICATIONS');
    assert.deepEqual(await getCart(base, sessionId), cart);
    const local = await post(base, '/api/search', { query: '3P C16, 10 kA, 8 штук' }, sessionId);
    assert.equal(local.status, 200);
    assert.equal(queryParser.calls, 1);
  }, { queryParser });
});

test('conversation is opt-in, isolated by session, and cannot write to the cart', async () => {
  const histories = [];
  await withServer(async (base) => {
    const { body: { sessionId: first } } = await post(base, '/api/session', {});
    const { body: { sessionId: second } } = await post(base, '/api/session', {});
    for (const [sessionId, query] of [[first, 'что по товарам есть'], [first, 'а подробнее'], [second, 'что по товарам есть']]) {
      const result = await post(base, '/api/search', { query, conversation: true }, sessionId);
      assert.equal(result.status, 200);
      assert.equal(result.body.intent, 'conversation');
      assert.match(result.body.answer, /каталог/);
      assert.deepEqual((await getCart(base, sessionId)).items, []);
    }
    assert.deepEqual(histories, [0, 2, 0]);
    const legacy = await post(base, '/api/search', { query: 'неполный запрос' });
    assert.equal(legacy.status, 422);
    assert.equal(legacy.body.error.code, 'MISSING_SPECIFICATIONS');
  }, { queryParser: {
    extract: async () => { throw new Error('Missing specifications'); },
    reply: async (_query, context) => {
      histories.push(context.history.length);
      return { kind: 'answer', answer: 'Вот доступный каталог.', filters: { poles: null, curve: null, amps: null, breakingCapacityKa: null, quantity: null } };
    },
  } });
});

test('team catalog supports all ten demo queries in one session and confirmed checkout', async () => {
  const products = await loadCatalog(fileURLToPath(new URL('../../data/catalog.json', import.meta.url)));
  const scenarios = [
    ['3P C16, 10 kA, 8 штук', ['DEMO-MCB-003', 'DEMO-MCB-004']],
    ['1P B10, 6 kA, 4 штуки', ['DEMO-MCB-013']],
    ['3P C16, 10 kA, 3 штуки', ['DEMO-MCB-001']],
    ['3P C16, 10 kA, 12 штук', ['DEMO-MCB-003']],
    ['3P C16, 10 kA, 13 штук', []],
    ['1P C25, 6 kA, 1 штука', []],
    ['3P C32, 10 kA, 10 штук', ['DEMO-MCB-035']],
    ['1P C16, 4.5 kA, 2 штуки', ['DEMO-MCB-040']],
    ['3P B16, 10 kA, 2 штуки', ['DEMO-MCB-006']],
    ['4P D63, 15 kA, 1 штука', []],
  ];
  await withServer(async (base) => {
    const { body: { sessionId } } = await post(base, '/api/session', {});
    for (const [query, expected] of scenarios) {
      const result = await post(base, '/api/search', { query }, sessionId);
      assert.equal(result.status, 200, query);
      assert.equal(result.body.intent, 'specifications', query);
      const available = result.body.exactMatch?.canFulfill
        ? [result.body.exactMatch.product.sku]
        : result.body.alternatives.map(({ product }) => product.sku);
      assert.deepEqual(available, expected, query);
      assert.deepEqual((await getCart(base, sessionId)).items, []);
    }
    const confirmation = { sku: 'DEMO-MCB-003', quantity: 8, confirmed: true, confirmationId: 'team-demo-confirmation' };
    assert.equal((await post(base, '/api/cart', { ...confirmation, confirmed: false }, sessionId)).status, 400);
    assert.deepEqual((await getCart(base, sessionId)).items, []);
    const added = await post(base, '/api/cart', confirmation, sessionId);
    assert.equal(added.status, 200);
    assert.equal(added.body.items[0].quantity, 8);
    assert.equal(added.body.totalPriceKzt, 63200);
    assert.equal(added.body.cartUrl, '/cart');
    assert.deepEqual((await post(base, '/api/cart', confirmation, sessionId)).body, added.body);
    const excess = await post(base, '/api/cart', { ...confirmation, confirmationId: 'too-many' }, sessionId);
    assert.equal(excess.status, 409);
    assert.deepEqual(await getCart(base, sessionId), added.body);
  }, { cartUrl: '/cart' }, products);
});

test('serves the frontend and cart route while unknown API routes stay JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ekt-frontend-'));
  try {
    await writeFile(join(directory, 'index.html'), '<main>EKT frontend</main>');
    await withServer(async (base) => {
      for (const path of ['/', '/cart', '/cart/']) {
        const response = await fetch(`${base}${path}`);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /text\/html/);
        assert.match(await response.text(), /EKT frontend/);
      }
      const response = await fetch(`${base}/api/unknown`);
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error.code, 'NOT_FOUND');
    }, { staticDirectory: directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
