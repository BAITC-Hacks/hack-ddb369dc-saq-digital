import express from 'express';
import { z } from 'zod';
import { ApiError } from './errors.js';
import { answerConversation, answerQuery, answerWithoutCatalog } from './assistant.js';
import { Sessions } from './sessions.js';
import { parseUpload } from './attachments.js';
import { Uploads } from './uploads.js';

const searchBody = z.strictObject({ query: z.string().trim().min(1).max(4000), conversation: z.boolean().optional() });
const cartBody = z.strictObject({
  sku: z.string().min(1).max(256),
  quantity: z.number().int().positive(),
  confirmed: z.literal(true),
  confirmationId: z.string().min(1).max(256),
});

function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(400, 'INVALID_BODY', result.error.issues.map((issue) => issue.message).join('; '));
  }
  return result.data;
}

const defaultResourceLimits = {
  maxSessions: 1000,
  sessionIdleTtlMs: 1800000,
  windowMs: 60000,
  sessionCreationsPerIp: 30,
  anonymousAiCallsPerIp: 2,
  aiCallsPerSession: 6,
  aiCallsPerIp: 10,
  maxRateLimitClients: 2000,
};

export function createApp(catalog, options = {}) {
  const app = express();
  const limits = { ...defaultResourceLimits, ...options.resourceLimits };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer.`);
  }
  const now = options.now ?? Date.now;
  const sessions = new Sessions(catalog, { ...limits, now });
  const rates = new Map();
  // Forwarded headers are trusted only when the deployment explicitly configures its proxy.
  app.set('trust proxy', options.trustProxy ?? false);
  function consume(buckets, code) {
    const timestamp = now();
    for (const [key, record] of rates) {
      if (record.expiresAt <= timestamp) rates.delete(key);
    }
    const newKeys = buckets.filter(([key]) => !rates.has(key)).length;
    if (rates.size + newKeys > limits.maxRateLimitClients || buckets.some(([key, maximum]) => (rates.get(key)?.count ?? 0) >= maximum)) {
      throw new ApiError(429, code, 'Слишком много запросов. Повторите попытку позже.');
    }
    // Check every bucket before charging any of them; rejected requests spend no AI budget.
    for (const [key] of buckets) {
      const record = rates.get(key) ?? { count: 0, expiresAt: timestamp + limits.windowMs };
      record.count += 1;
      rates.set(key, record);
    }
  }

  function parserFor(request, sessionId) {
    const parser = options.queryParser;
    if (!parser) return undefined;
    const beforeRequest = () => consume(sessionId ? [
      [`ai-session:${sessionId}`, limits.aiCallsPerSession],
      [`ai-ip:${request.ip}`, limits.aiCallsPerIp],
    ] : [[`ai-anonymous:${request.ip}`, limits.anonymousAiCallsPerIp]], 'AI_RATE_LIMIT');
    const invoke = (method, args) => {
      if (!parser.supportsRequestPolicy) beforeRequest();
      return parser[method](...args, { beforeRequest });
    };
    return {
      ...(typeof parser.extract === 'function' && { extract: (query) => invoke('extract', [query]) }),
      ...(typeof parser.reply === 'function' && { reply: (query, context) => invoke('reply', [query, context]) }),
    };
  }

  const uploads = new Uploads(catalog, options.queryParser, options.uploads);
  app.use((request, response, next) => {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
    response.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (request.method === 'OPTIONS') return response.sendStatus(204);
    next();
  });
  app.use(express.json());

  app.get('/api/health', (_request, response) => response.json({ status: 'ok', ...(options.catalogState && { catalog: options.catalogState }) }));
  app.get('/api/uploads/capabilities', (_request, response) => response.json(uploads.capabilities()));

  const requireCatalog = (_request, response, next) => {
    if (!options.catalogState || options.catalogState.status === 'ready') return next();
    const loading = options.catalogState.status === 'loading';
    if (loading) response.set('Retry-After', '10');
    response.status(503).json({ error: {
      code: loading ? 'CATALOG_LOADING' : 'CATALOG_UNAVAILABLE',
      message: loading ? 'Каталог ekt.kz загружается. Повторите запрос через некоторое время.' : 'Каталог ekt.kz сейчас недоступен. Попробуйте позже.',
    } });
  };

  const catalogResponse = (result, state) => {
    if (state?.source !== 'partner' || state.status !== 'ready') return result;
    const { loadedAt, cached = false, refreshing = false, stale = false } = state;
    const note = (stale || refreshing) && loadedAt
      ? ` Данные каталога сохранены ${loadedAt}.${refreshing ? ' Обновление выполняется в фоне.' : ' Новые данные пока недоступны.'}`
      : '';
    return { ...result, answer: result.answer + note, catalog: { source: 'partner', loadedAt, cached, refreshing, stale } };
  };

  app.post('/api/search', async (request, response) => {
    const { query, conversation } = parseBody(searchBody, request.body);
    const sessionId = request.get('X-Session-Id');
    const context = sessionId ? sessions.context(sessionId) : undefined;
    if (context) context.cart = sessions.cart(sessionId).snapshot();
    const queryParser = parserFor(request, sessionId);
    const state = options.catalogState && { ...options.catalogState };
    if (state && state.status !== 'ready') {
      const result = answerWithoutCatalog(query, options.purchaseTerms, state.status === 'loading');
      if (conversation || result.intent === 'purchase_terms') return response.json(result);
      return requireCatalog(request, response, () => {});
    }
    if (context && context.catalogRevision !== state?.loadedAt) {
      context.lastConversation = null;
      context.catalogRevision = state?.loadedAt;
    }
    if (conversation) {
      return response.json(catalogResponse(await answerConversation(catalog, query, options.purchaseTerms, context, queryParser), state));
    }
    try {
      response.json(catalogResponse(answerQuery(catalog, query, options.purchaseTerms, context), state));
    } catch (error) {
      if (error.code !== 'MISSING_SPECIFICATIONS' || !queryParser?.extract) throw error;
      try {
        const filters = await queryParser.extract(query);
        response.json(catalogResponse(answerQuery(catalog, query, options.purchaseTerms, context, filters), state));
      } catch (aiError) {
        if (aiError.code === 'AI_RATE_LIMIT' || aiError.code === 'AI_CALL_LIMIT') {
          throw new ApiError(429, aiError.code, 'Лимит запросов к помощнику временно исчерпан. Повторите попытку позже.');
        }
        throw error;
      }
    }
  });

  app.post('/api/session', (request, response) => {
    consume([[`session-create:${request.ip}`, limits.sessionCreationsPerIp]], 'SESSION_RATE_LIMIT');
    response.status(201).json({ sessionId: sessions.create() });
  });

  const requireUploadSession = (request, response, next) => {
    sessions.context(request.get('X-Session-Id'));
    response.set('Cache-Control', 'no-store');
    next();
  };
  app.post('/api/uploads', requireCatalog, requireUploadSession, (request, _response, next) => {
    if (!uploads.capabilities().enabled) throw new ApiError(503, 'UPLOAD_PROCESSOR_UNAVAILABLE', 'Распознавание файлов не настроено.');
    if (!request.is('multipart/form-data')) throw new ApiError(415, 'UNSUPPORTED_FILE_TYPE', 'Ожидается multipart/form-data.');
    next();
  }, express.raw({ type: 'multipart/form-data', limit: uploads.options.maxFileBytes + 16384, inflate: false }), async (request, response) => {
    const input = await parseUpload(request.body, request.get('Content-Type'), uploads.options.maxFileBytes);
    const job = uploads.submit(request.get('X-Session-Id'), input);
    response.status(['queued', 'processing'].includes(job.status) ? 202 : 200).json(job);
  });

  app.get('/api/uploads/:uploadId', requireCatalog, requireUploadSession, (request, response) => {
    response.json(uploads.get(request.get('X-Session-Id'), request.params.uploadId));
  });

  app.delete('/api/uploads/:uploadId', requireCatalog, requireUploadSession, (request, response) => {
    uploads.remove(request.get('X-Session-Id'), request.params.uploadId);
    response.sendStatus(204);
  });

  app.get('/api/cart', (request, response) => {
    response.json({ ...sessions.cart(request.get('X-Session-Id')).snapshot(), cartUrl: options.cartUrl });
  });

  app.post('/api/cart', requireCatalog, (request, response) => {
    response.json({ ...sessions.cart(request.get('X-Session-Id')).add(parseBody(cartBody, request.body)), cartUrl: options.cartUrl });
  });

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } });
  });

  if (options.staticDirectory) {
    app.use(express.static(options.staticDirectory));
    app.get(/.*/, (_request, response) => response.sendFile('index.html', { root: options.staticDirectory }));
  }

  app.use((error, request, response, _next) => {
    if (error instanceof ApiError) {
      if (error.status === 429) response.set('Retry-After', String(Math.ceil(limits.windowMs / 1000)));
      return response.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    if (request.path === '/api/uploads' && error.type === 'entity.too.large') {
      return response.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'Превышен допустимый размер запроса.' } });
    }
    if (request.path === '/api/uploads' && error.status >= 400 && error.status < 500) {
      return response.status(400).json({ error: { code: 'INVALID_UPLOAD', message: 'Некорректный запрос загрузки.' } });
    }
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Некорректный JSON.' } });
    }
    if (error.type === 'entity.too.large' && error.status === 413) {
      return response.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'Размер запроса превышает допустимый.' } });
    }
    if (['encoding.unsupported', 'charset.unsupported'].includes(error.type) && error.status === 415) {
      return response.status(415).json({ error: { code: 'UNSUPPORTED_ENCODING', message: 'Кодировка запроса не поддерживается.' } });
    }
    console.error(error);
    return response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера.' } });
  });
  return app;
}
