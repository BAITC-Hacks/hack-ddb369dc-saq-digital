import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.js';
import { Cart } from './cart.js';

export class Sessions {
  constructor(catalog) {
    this.catalog = catalog;
    this.sessions = new Map();
  }

  create() {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, { cart: new Cart(this.catalog), context: { lastSku: null } });
    return sessionId;
  }

  cart(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new ApiError(401, 'SESSION_REQUIRED', 'Создайте сессию перед работой с корзиной.');
    }
    return session.cart;
  }

  context(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new ApiError(401, 'SESSION_REQUIRED', 'Неизвестная сессия.');
    return session.context;
  }
}
