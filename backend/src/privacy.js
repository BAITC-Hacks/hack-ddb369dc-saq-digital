import { ApiError } from './errors.js';

const replacement = '[ПЛАТЁЖНЫЕ ДАННЫЕ УДАЛЕНЫ]';
const separator = '[ \\u00a0\\u202f-]';
const cardPattern = new RegExp(`(?<![\\p{L}\\p{N}_])\\d(?:${separator}?\\d){12,18}(?![\\p{L}\\p{N}_])`, 'gu');
const cardLabel = /(?<![\p{L}\p{N}])(?:номер\s+(?:банковской\s+)?карты|банковск\p{L}*\s+карт\p{L}*|карт(?:а|ы|у)|card(?:\s+(?:number|no))?|pan)\s*[:=№#-]?\s*$/iu;
const productLabel = /(?<![\p{L}\p{N}])(?:артикул|sku|ean|штрихкод|код\s+товара|id\s+товара)\s*[:=№#-]?\s*$/iu;
const securityPattern = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:cvv2?|cvc2?|cid|pin(?:[-\\s]*(?:code|код))?|пин(?:[-\\s]*код)?|otp|(?:одноразовый|проверочный)\\s+код|код\\s+(?:подтверждения|авторизации|из\\s+(?:sms|смс))|(?:sms|смс)[-\\s]*код|(?:verification|authentication|security)\\s+code)\\s*[:=№#-]?\\s*["']?(\\d(?:${separator}?\\d){2,7})(?![\\p{L}\\p{N}])`,
  'dgiu',
);
const expiryPattern = /(?<![\p{L}\p{N}])(?:срок\s+действия\s+(?:банковской\s+)?карты|карта\s+действует\s+до|card\s+expir(?:y|ation)(?:\s+date)?|valid\s+thr(?:u|ough))\s*[:=]?\s*((?:0?[1-9]|1[0-2])\s*[/.-]\s*(?:\d{4}|\d{2}))(?!\d)/dgiu;
// Require explicit assignment so a question such as "пароль банка не помню" remains ordinary text.
const bankPasswordPattern = /(?<![\p{L}\p{N}])(?:банковский\s+пароль|пароль\s+(?:(?:от|для|в)\s+)?(?:(?:онлайн|интернет)[-\s]*)?банк(?:а|инга)|(?:online\s+)?bank(?:ing)?\s+password)\s*[:=]\s*["']?([^\s,;"']{4,100})/dgiu;
const ibanLengths = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22,
  BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28,
  EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23,
  GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IS: 26, IT: 27,
  JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21,
  MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15,
  PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SC: 31,
  SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26,
  UA: 29, VA: 22, VG: 24, XK: 20,
};
const ibanPattern = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?:${Object.entries(ibanLengths).map(([country, length]) => `${country}\\d{2}(?:[ \\u00a0\\u202f]?[A-Z0-9]){${length - 4}}`).join('|')})(?![\\p{L}\\p{N}_])`,
  'dgiu',
);

function validCard(digits) {
  // Restrict unlabelled numbers to payment-card prefixes and checksum to spare product IDs.
  if (!/^(?:4|5[1-5]|2[2-7]|3[47]|6[025])/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function validIban(value) {
  const normalized = value.replace(/\s/g, '').toUpperCase();
  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const digits = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function sensitiveRanges(text) {
  const ranges = [];
  for (const match of text.matchAll(cardPattern)) {
    const before = text.slice(Math.max(0, match.index - 60), match.index);
    const explicitlyCard = cardLabel.test(before);
    if (explicitlyCard || (!productLabel.test(before) && validCard(match[0].replace(/\D/g, '')))) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  for (const match of text.matchAll(securityPattern)) ranges.push(match.indices[1]);
  for (const match of text.matchAll(expiryPattern)) ranges.push(match.indices[1]);
  for (const match of text.matchAll(bankPasswordPattern)) ranges.push(match.indices[1]);
  for (const match of text.matchAll(ibanPattern)) {
    const before = text.slice(Math.max(0, match.index - 40), match.index);
    // KZ accounts and explicitly labelled IBANs are sensitive even when mistyped.
    if (/^KZ/i.test(match[0]) || /(?:iban|иик|расч[её]тный\s+сч[её]т)\s*[:=№#-]?\s*$/iu.test(before) || validIban(match[0])) {
      ranges.push(match.indices[0]);
    }
  }
  return ranges.sort((left, right) => left[0] - right[0]);
}

export function assertNoPaymentData(value) {
  const visited = new WeakSet();
  const inspect = (entry) => {
    if (typeof entry === 'string') {
      if (sensitiveRanges(entry).length) {
        throw new ApiError(400, 'PAYMENT_DATA_NOT_ALLOWED', 'Не отправляйте номера банковских карт и счетов, срок действия карты, CVV/CVC, PIN, банковские пароли или коды подтверждения. Удалите платёжные данные и повторите запрос.');
      }
    } else if (entry && typeof entry === 'object' && !visited.has(entry)) {
      visited.add(entry);
      for (const nested of Object.values(entry)) inspect(nested);
    }
  };
  inspect(value);
}

export function redactPaymentData(value) {
  const visited = new WeakMap();
  const redact = (entry) => {
    if (typeof entry === 'string') {
      const ranges = sensitiveRanges(entry);
      let result = '';
      let offset = 0;
      for (const [start, end] of ranges) {
        if (end <= offset) continue;
        if (start >= offset) result += entry.slice(offset, start) + replacement;
        offset = end;
      }
      return result + entry.slice(offset);
    }
    if (!entry || typeof entry !== 'object') return entry;
    if (visited.has(entry)) return visited.get(entry);
    const result = Array.isArray(entry) ? [] : {};
    visited.set(entry, result);
    for (const [key, nested] of Object.entries(entry)) {
      Object.defineProperty(result, key, { value: redact(nested), enumerable: true, writable: true, configurable: true });
    }
    return result;
  };
  return redact(value);
}

export function sanitizeConversation(context) {
  if (!context) return context;
  if (context.history) context.history = redactPaymentData(context.history);
  if (context.lastConversation) {
    const previous = context.lastConversation;
    context.lastConversation = {
      ...previous,
      query: redactPaymentData(previous.query),
      ...(previous.result && { result: { ...previous.result, answer: redactPaymentData(previous.result.answer) } }),
    };
  }
  return context;
}
