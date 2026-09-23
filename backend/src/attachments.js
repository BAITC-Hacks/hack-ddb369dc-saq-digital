import { extname } from 'node:path';
import { z } from 'zod';
import { ApiError } from './errors.js';

export const uploadDefaults = {
  maxFileBytes: 921600,
  maxItems: 50,
  maxOutputTokens: 8000,
  timeoutMs: 60000,
  maxConcurrent: 2,
  maxJobs: 20,
  maxJobsPerSession: 5,
  resultTtlMs: 900000,
};

export const uploadFormats = [
  { extensions: ['.jpg', '.jpeg'], mimeType: 'image/jpeg' },
  { extensions: ['.png'], mimeType: 'image/png' },
  { extensions: ['.pdf'], mimeType: 'application/pdf' },
  { extensions: ['.doc'], mimeType: 'application/msword' },
  { extensions: ['.docx'], mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { extensions: ['.xls'], mimeType: 'application/vnd.ms-excel' },
  { extensions: ['.xlsx'], mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
];

export function attachmentSchema(maxItems) {
  return z.strictObject({
    items: z.array(z.strictObject({
      description: z.string().max(500),
      article: z.string().min(1).max(200).nullable(),
      quantity: z.number().positive().nullable(),
      unit: z.string().max(50).nullable(),
      sourceText: z.string().max(1000),
      specifications: z.strictObject({
        poles: z.number().int().min(1).max(4).nullable(),
        curve: z.enum(['B', 'C', 'D']).nullable(),
        amps: z.number().positive().nullable(),
        breakingCapacityKa: z.number().positive().nullable(),
      }),
    })).max(maxItems),
    warnings: z.array(z.string().max(500)).max(20),
    truncated: z.boolean(),
  });
}

export async function parseUpload(body, contentType, maxFileBytes) {
  let form;
  try {
    form = await new Response(body, { headers: { 'Content-Type': contentType } }).formData();
  } catch {
    throw new ApiError(400, 'INVALID_UPLOAD', 'Некорректный multipart-запрос.');
  }
  const entries = [...form.entries()];
  const requestId = form.get('requestId');
  const file = form.get('file');
  if (entries.length !== 2 || form.getAll('file').length !== 1 || form.getAll('requestId').length !== 1
      || !z.uuid().safeParse(requestId).success || !(file instanceof File)) {
    throw new ApiError(400, 'INVALID_UPLOAD', 'Передайте один file и UUID requestId.');
  }
  const name = file.name.replaceAll('\\', '/').split('/').at(-1);
  if (!name || name.length > 255 || /[\x00-\x1f\x7f]/.test(name)) {
    throw new ApiError(400, 'INVALID_FILE', 'Некорректное имя файла.');
  }
  const extension = extname(name).toLowerCase();
  const format = uploadFormats.find((entry) => entry.extensions.includes(extension));
  if (!format) throw new ApiError(415, 'UNSUPPORTED_FILE_TYPE', 'Этот формат файла не поддерживается.');
  if (file.type && file.type !== 'application/octet-stream' && file.type !== format.mimeType) {
    throw new ApiError(400, 'INVALID_FILE', 'MIME-тип не соответствует расширению файла.');
  }
  if (!file.size) throw new ApiError(400, 'EMPTY_FILE', 'Файл пуст.');
  if (file.size > maxFileBytes) throw new ApiError(413, 'FILE_TOO_LARGE', 'Превышен допустимый размер файла.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const signature = extension === '.png' ? '89504e470d0a1a0a'
    : ['.jpg', '.jpeg'].includes(extension) ? 'ffd8ff'
    : ['.doc', '.xls'].includes(extension) ? 'd0cf11e0a1b11ae1' : '504b0304';
  const valid = extension === '.pdf'
    ? bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))
    : bytes.subarray(0, signature.length / 2).toString('hex') === signature;
  if (!valid) throw new ApiError(400, 'INVALID_FILE', 'Содержимое не соответствует формату файла.');
  return { requestId: requestId.toLowerCase(), file: { name, mimeType: format.mimeType, sizeBytes: bytes.length, bytes } };
}

export function matchAttachment(extraction, catalog) {
  const normalized = (value) => String(value ?? '').trim().toLocaleLowerCase('ru');
  return extraction.items.map((item, index) => {
    const article = normalized(item.article);
    const complete = Object.values(item.specifications).every((value) => value !== null);
    const matches = catalog.filter((product) => article
      ? [product.sku, product.article].some((value) => normalized(value) === article)
      : complete && Object.entries(item.specifications).every(([key, value]) => product[key] === value));
    const warnings = [];
    if (item.quantity === null) warnings.push('Укажите количество перед добавлением в корзину.');
    else if (!Number.isSafeInteger(item.quantity)) warnings.push('Корзина принимает только целое количество. Проверьте единицу измерения.');
    if (!item.unit) warnings.push('Единица измерения не распознана. Проверьте её вручную.');
    if (!matches.length) warnings.push('Точное совпадение в каталоге не найдено.');
    return {
      lineId: String(index + 1), ...item,
      matchStatus: matches.length === 1 ? 'matched' : matches.length ? 'ambiguous' : 'not_found',
      matchCount: matches.length,
      candidates: matches.slice(0, 3).map((product) => ({
        product,
        reason: article ? 'Совпадает артикул из файла.' : 'Совпадают все четыре технических параметра из файла.',
        canFulfill: item.quantity === null ? null : product.stock >= item.quantity,
        canAddToCart: Number.isSafeInteger(item.quantity) && item.quantity > 0 && product.stock >= item.quantity
          && (!product.minimumOrderQuantity || item.quantity % product.minimumOrderQuantity === 0),
      })),
      warnings,
      requiresReview: true,
    };
  });
}
