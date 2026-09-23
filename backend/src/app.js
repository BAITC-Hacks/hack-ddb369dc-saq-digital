import express from 'express';
import { z } from 'zod';
import { ApiError } from './errors.js';
import { answerConversation, answerQuery } from './assistant.js';
import { Sessions } from './sessions.js';
import { parseUpload } from './attachments.js';
import { Uploads } from './uploads.js';

const searchBody = z.strictObject({ query: z.string().min(1), conversation: z.boolean().optional() });
const cartBody = z.strictObject({
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
  confirmed: z.literal(true),
  confirmationId: z.string().min(1),
});

function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(400, 'INVALID_BODY', result.error.issues.map((issue) => issue.message).join('; '));
  }
  return result.data;
}

export function createApp(catalog, options = {}) {
  const app = express();
  const sessions = new Sessions(catalog);
  const uploads = new Uploads(catalog, options.queryParser, options.uploads);
  app.use(express.json());
  app.use((request, response, next) => {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
    response.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (request.method === 'OPTIONS') return response.sendStatus(204);
    next();
  });

  app.get('/api/health', (_request, response) => response.json({ status: 'ok', ...(options.catalogState && { catalog: options.catalogState }) }));
  app.get('/api/uploads/capabilities', (_request, response) => response.json(uploads.capabilities()));

  app.use('/api', (_request, response, next) => {
    if (!options.catalogState || options.catalogState.status === 'ready') return next();
    const loading = options.catalogState.status === 'loading';
    if (loading) response.set('Retry-After', '10');
    response.status(503).json({ error: {
      code: loading ? 'CATALOG_LOADING' : 'CATALOG_UNAVAILABLE',
      message: loading ? 'Каталог ekt.kz загружается. Повторите запрос через некоторое время.' : 'Каталог ekt.kz сейчас недоступен. Попробуйте позже.',
    } });
  });

  app.post('/api/search', async (request, response) => {
    const { query, conversation } = parseBody(searchBody, request.body);
    const sessionId = request.get('X-Session-Id');
    const context = sessionId ? sessions.context(sessionId) : undefined;
    if (conversation) {
      return response.json(await answerConversation(catalog, query, options.purchaseTerms, context, options.queryParser));
    }
    try {
      response.json(answerQuery(catalog, query, options.purchaseTerms, context));
    } catch (error) {
      if (error.code !== 'MISSING_SPECIFICATIONS' || !options.queryParser) throw error;
      try {
        const filters = await options.queryParser.extract(query);
        response.json(answerQuery(catalog, query, options.purchaseTerms, context, filters));
      } catch {
        throw error;
      }
    }
  });

  app.post('/api/session', (_request, response) => response.status(201).json({ sessionId: sessions.create() }));

  const requireUploadSession = (request, response, next) => {
    sessions.context(request.get('X-Session-Id'));
    response.set('Cache-Control', 'no-store');
    next();
  };
  app.post('/api/uploads', requireUploadSession, (request, _response, next) => {
    if (!uploads.capabilities().enabled) throw new ApiError(503, 'UPLOAD_PROCESSOR_UNAVAILABLE', 'Распознавание файлов не настроено.');
    if (!request.is('multipart/form-data')) throw new ApiError(415, 'UNSUPPORTED_FILE_TYPE', 'Ожидается multipart/form-data.');
    next();
  }, express.raw({ type: 'multipart/form-data', limit: uploads.options.maxFileBytes + 16384, inflate: false }), async (request, response) => {
    const input = await parseUpload(request.body, request.get('Content-Type'), uploads.options.maxFileBytes);
    const job = uploads.submit(request.get('X-Session-Id'), input);
    response.status(['queued', 'processing'].includes(job.status) ? 202 : 200).json(job);
  });

  app.get('/api/uploads/:uploadId', requireUploadSession, (request, response) => {
    response.json(uploads.get(request.get('X-Session-Id'), request.params.uploadId));
  });

  app.delete('/api/uploads/:uploadId', requireUploadSession, (request, response) => {
    uploads.remove(request.get('X-Session-Id'), request.params.uploadId);
    response.sendStatus(204);
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

  app.use((error, request, response, _next) => {
    if (error instanceof ApiError) {
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
    console.error(error);
    return response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера.' } });
  });
  return app;
}
