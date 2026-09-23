import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.js';
import { Cart } from './cart.js';

export class Sessions {
  constructor(catalog, { maxSessions = 1000, sessionIdleTtlMs = 1800000, now = Date.now } = {}) {
    for (const [name, value] of Object.entries({ maxSessions, sessionIdleTtlMs })) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer.`);
    }
    this.catalog = new Map(catalog.map((product) => [product.sku, product]));
    this.maxSessions = maxSessions;
    this.sessionIdleTtlMs = sessionIdleTtlMs;
    this.now = now;
    this.sessions = new Map();
  }

  create() {
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
    // Capacity pressure must never silently remove an active customer's cart.
    if (this.sessions.size >= this.maxSessions) {
      throw new ApiError(503, 'SESSION_CAPACITY', 'Сервис временно занят. Повторите создание сессии позже.');
    }
    const sessionId = randomUUID();
    this.sessions.set(sessionId, { cart: new Cart(this.catalog), context: { lastSku: null }, expiresAt: now + this.sessionIdleTtlMs });
    return sessionId;
  }

  get(sessionId) {
    const session = this.sessions.get(sessionId);
    const now = this.now();
    if (!session || session.expiresAt <= now) {
      if (session) this.sessions.delete(sessionId);
      throw new ApiError(401, 'SESSION_REQUIRED', 'Сессия отсутствует или истекла. Создайте новую сессию.');
    }
    session.expiresAt = now + this.sessionIdleTtlMs;
    return session;
  }

  cart(sessionId) {
    return this.get(sessionId).cart;
  }

  context(sessionId) {
    return this.get(sessionId).context;
  }
}
