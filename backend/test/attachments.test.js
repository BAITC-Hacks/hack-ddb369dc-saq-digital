import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { attachmentSchema, matchAttachment, parseUpload, uploadFormats } from '../src/attachments.js';
import { OpenAIQueryParser } from '../src/ai.js';
import { catalog } from './fixtures.js';

const line = { description: 'Breaker', article: 'SKU-EXACT', quantity: 2, unit: 'шт', sourceText: 'SKU-EXACT 2 шт', specifications: { poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 10 } };
const extraction = { items: [line], warnings: [], truncated: false };

async function multipart(file, customize = () => {}) {
  const form = new FormData();
  form.append('file', file);
  form.append('requestId', randomUUID());
  customize(form);
  const request = new Request('https://example.org', { method: 'POST', body: form });
  return [Buffer.from(await request.arrayBuffer()), request.headers.get('content-type')];
}

test('accepts supported containers and canonicalizes empty MIME types', async () => {
  for (const format of uploadFormats) {
    for (const extension of format.extensions) {
      const hex = extension === '.pdf' ? '255044462d' : extension === '.png' ? '89504e470d0a1a0a'
        : ['.jpg', '.jpeg'].includes(extension) ? 'ffd8ff' : ['.doc', '.xls'].includes(extension) ? 'd0cf11e0a1b11ae1' : '504b0304';
      const bytes = Buffer.from(hex, 'hex');
      const args = await multipart(new File([bytes], `fixture${extension}`));
      const parsed = await parseUpload(...args, 100);
      assert.equal(parsed.file.mimeType, format.mimeType);
      assert.deepEqual(parsed.file.bytes, bytes);
    }
  }
});

test('rejects invalid multipart, fields, sizes, MIME types and signatures', async () => {
  const valid = new File(['%PDF-synthetic'], 'fixture.pdf', { type: 'application/pdf' });
  for (const [file, mutate, max, code] of [
    [valid, (form) => form.append('extra', 'value'), 100, 'INVALID_UPLOAD'],
    [valid, (form) => form.append('file', valid), 100, 'INVALID_UPLOAD'],
    [valid, (form) => form.set('requestId', 'invalid'), 100, 'INVALID_UPLOAD'],
    [valid, (form) => form.set('file', 'text'), 100, 'INVALID_UPLOAD'],
    [new File([], 'empty.pdf'), () => {}, 100, 'EMPTY_FILE'],
    [new File(['%PDF-'], 'file.exe'), () => {}, 100, 'UNSUPPORTED_FILE_TYPE'],
    [new File(['%PDF-'], 'file.pdf', { type: 'image/jpeg' }), () => {}, 100, 'INVALID_FILE'],
    [new File(['wrong'], 'file.pdf'), () => {}, 100, 'INVALID_FILE'],
    [new File(['%PDF-'], `${'x'.repeat(256)}.pdf`), () => {}, 100, 'INVALID_FILE'],
    [valid, () => {}, 3, 'FILE_TOO_LARGE'],
  ]) {
    await assert.rejects(parseUpload(...await multipart(file, mutate), max), { code });
  }
  await assert.rejects(parseUpload(Buffer.from('broken'), 'multipart/form-data; boundary=missing', 100), { code: 'INVALID_UPLOAD' });
});

test('matches verified catalog entries without substituting unknown articles or quantities', () => {
  const items = matchAttachment({ items: [line,
    { ...line, article: 'missing' }, { ...line, article: null },
    { ...line, article: null, specifications: { ...line.specifications, poles: null } },
    { ...line, quantity: null, unit: null }, { ...line, quantity: 2.5 }, { ...line, quantity: 3 },
  ] }, catalog);
  assert.equal(items[0].candidates[0].product, catalog[0]);
  assert.equal(items[0].candidates[0].canAddToCart, true);
  assert.equal(items[1].matchStatus, 'not_found');
  assert.equal(items[2].matchStatus, 'matched');
  assert.equal(items[3].matchStatus, 'not_found');
  assert.equal(items[4].quantity, null);
  assert.equal(items[4].candidates[0].canFulfill, null);
  assert.equal(items[4].candidates[0].canAddToCart, false);
  assert.equal(items[4].warnings.length, 2);
  assert.equal(items[5].candidates[0].canAddToCart, false);
  assert.equal(items[6].candidates[0].canFulfill, false);
  assert.ok(items.every((item) => item.requiresReview));
  const ambiguous = matchAttachment(extraction, Array.from({ length: 4 }, () => catalog[0]))[0];
  assert.equal(ambiguous.matchStatus, 'ambiguous');
  assert.equal(ambiguous.matchCount, 4);
  assert.equal(ambiguous.candidates.length, 3);
  assert.equal(matchAttachment(extraction, [{ ...catalog[0], minimumOrderQuantity: 3 }])[0].candidates[0].canAddToCart, false);
});

test('attachment schema rejects invented fields and excessive output', () => {
  const schema = attachmentSchema(1);
  assert.deepEqual(schema.parse(extraction), extraction);
  for (const invalid of [
    { ...extraction, items: [line, line] },
    { ...extraction, items: [{ ...line, priceKzt: 1 }] },
    { ...extraction, items: [{ ...line, quantity: 0 }] },
    { ...extraction, items: [{ ...line, article: '' }] },
  ]) assert.equal(schema.safeParse(invalid).success, false);
});

test('attachment extraction sends inline documents/images, respects cancellation and shares AI budget', async () => {
  for (const mimeType of ['application/pdf', 'image/jpeg']) {
    const controller = new AbortController();
    let calls = 0;
    const parser = new OpenAIQueryParser({ url: 'https://example.org/responses', model: 'fixture', apiKey: 'dummy', maxCalls: 1,
      fetcher: async (_url, options) => {
        calls += 1;
        const body = JSON.parse(options.body);
        assert.equal(options.signal, controller.signal);
        assert.equal(body.store, false);
        assert.equal(body.max_output_tokens, 2000);
        const input = body.input[0].content[0];
        assert.equal(input.type, mimeType.startsWith('image/') ? 'input_image' : 'input_file');
        assert.equal(input.image_url ?? input.file_data, `data:${mimeType};base64,YWJj`);
        assert.equal(body.text.format.schema.properties.items.maxItems, 5);
        return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(extraction) }] }] }) };
      } });
    const file = { name: 'fixture', mimeType, bytes: Buffer.from('abc') };
    assert.deepEqual(await parser.extractAttachment(file, { signal: controller.signal, maxItems: 5, maxOutputTokens: 2000 }), extraction);
    assert.equal(parser.cache.size, 0);
    await assert.rejects(parser.extractAttachment(file), { code: 'AI_CALL_LIMIT' });
    assert.throws(() => parser.extract('new query'), { code: 'AI_CALL_LIMIT' });
    assert.equal(calls, 1);
  }
});
