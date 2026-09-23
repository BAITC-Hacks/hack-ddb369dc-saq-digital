import { z } from 'zod';

const filtersSchema = z.strictObject({
  poles: z.number().int().min(1).max(4),
  curve: z.enum(['B', 'C', 'D']),
  amps: z.number().int().positive(),
  breakingCapacityKa: z.number().positive(),
  quantity: z.number().int().positive(),
});

export class NvidiaQueryParser {
  constructor({ url, model, apiKey, maxOutputTokens, maxCalls, fetcher = fetch }) {
    this.url = url;
    this.model = model;
    this.apiKey = apiKey;
    this.maxOutputTokens = maxOutputTokens;
    this.maxCalls = maxCalls;
    this.fetcher = fetcher;
    this.calls = 0;
    this.cache = new Map();
  }

  extract(query) {
    const key = query.trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ');
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.calls >= this.maxCalls) throw new Error('AI call limit reached');
    this.calls += 1;
    const request = this.request(query);
    this.cache.set(key, request);
    return request;
  }

  async request(query) {
    const response = await this.fetcher(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxOutputTokens,
        temperature: 0,
        stream: false,
        messages: [
          { role: 'system', content: 'Extract circuit breaker purchase specifications from the user text. Return only a JSON object with numeric poles, numeric amps, numeric breakingCapacityKa, numeric quantity, and curve B, C, or D. Never include a SKU, price, or product.' },
          { role: 'user', content: query },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`NVIDIA API returned HTTP ${response.status}`);
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('NVIDIA response has no message content');
    return filtersSchema.parse(JSON.parse(content));
  }
}
