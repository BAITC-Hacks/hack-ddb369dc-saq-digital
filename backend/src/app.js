import express from 'express';
import { z } from 'zod';
import { ApiError } from './errors.js';
import { answerConversation, answerQuery } from './assistant.js';
import { Sessions } from './sessions.js';

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

  app.use((request, response, next) => {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (request.method === 'OPTIONS') return response.sendStatus(204);
    next();
  });
  app.use(express.json());

  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));

  app.post('/api/search', async (request, response) => {
    const { query, conversation } = parseBody(searchBody, request.body);
    const sessionId = request.get('X-Session-Id');
    const context = sessionId ? sessions.context(sessionId) : undefined;
    if (context) context.cart = sessions.cart(sessionId).snapshot();
    const queryParser = parserFor(request, sessionId);
    if (conversation) {
      return response.json(await answerConversation(catalog, query, options.purchaseTerms, context, queryParser));
    }
    try {
      response.json(answerQuery(catalog, query, options.purchaseTerms, context));
    } catch (error) {
      if (error.code !== 'MISSING_SPECIFICATIONS' || !queryParser?.extract) throw error;
      try {
        const filters = await queryParser.extract(query);
        response.json(answerQuery(catalog, query, options.purchaseTerms, context, filters));
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

  app.get('/api/cart', (request, response) => {
    response.json({ ...sessions.cart(request.get('X-Session-Id')).snapshot(), cartUrl: options.cartUrl });
  });

  app.post('/api/cart', (request, response) => {
    response.json({ ...sessions.cart(request.get('X-Session-Id')).add(parseBody(cartBody, request.body)), cartUrl: options.cartUrl });
  });

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } });
  });

  if (options.staticDirectory) {
    app.use(express.static(options.staticDirectory));
    app.get(/.*/, (_request, response) => response.sendFile('index.html', { root: options.staticDirectory }));
  }

  app.use((error, _request, response, _next) => {
    if (error instanceof ApiError) {
      if (error.status === 429) response.set('Retry-After', String(Math.ceil(limits.windowMs / 1000)));
      return response.status(error.status).json({ error: { code: error.code, message: error.message } });
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
