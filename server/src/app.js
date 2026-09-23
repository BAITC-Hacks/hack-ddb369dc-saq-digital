import express from 'express';
import { z } from 'zod';
import { ApiError } from './errors.js';
import { parseQuery, searchCatalog } from './search.js';
import { Cart } from './cart.js';

const searchBody = z.strictObject({ query: z.string().min(1) });
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

export function createApp(catalog) {
  const app = express();
  const cart = new Cart(catalog);
  app.use(express.json());
  app.use((request, response, next) => {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Headers', 'Content-Type');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (request.method === 'OPTIONS') return response.sendStatus(204);
    next();
  });

  app.post('/api/search', (request, response) => {
    const { query } = parseBody(searchBody, request.body);
    response.json(searchCatalog(catalog, parseQuery(query)));
  });

  app.get('/api/cart', (_request, response) => response.json(cart.snapshot()));

  app.post('/api/cart', (request, response) => {
    response.json(cart.add(parseBody(cartBody, request.body)));
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof ApiError) {
      return response.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Некорректный JSON.' } });
    }
    console.error(error);
    return response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера.' } });
  });
  return app;
}
