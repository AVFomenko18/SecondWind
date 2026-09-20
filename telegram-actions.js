export function normalizeSalesName(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е').replace(/[^а-яa-z\s-]/gi, ' ').replace(/\s+/g, ' ').trim();
}

export function parseSalesNotification(text) {
  if (typeof text !== 'string') return null;
  const headline = text.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  const verb = headline.match(/^[^а-яa-z]*?(.+?)\s+(?:зан[её]с(?:ла)?|вн[её]с(?:ла)?|пров[её]л(?:а)?)\s+(.+)$/i);
  if (!verb) return null;
  const managerName = verb[1].replace(/^[^а-яa-z]+/i, '').trim(), detail = verb[2];
  const amountMatch = [...detail.matchAll(/за\s+([\d\s\u00a0\u202f]+)\s*(?:руб(?:лей|ля|ль)?\.?|₽)/gi)].at(-1);
  if (!amountMatch) return null;
  const amount = Number(amountMatch[1].replace(/\D/g, ''));
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const lower = detail.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  if (/возврат|отмен/.test(lower)) return null;
  const type = /кросс[\s-]*с[еэ]йл/.test(lower) ? 'cross' : 'payment';
  const eventType = detail.split(/\s+за\s+/i)[0].trim();
  if (!eventType || !normalizeSalesName(managerName)) return null;
  const kind = type === 'cross' ? 'cross' : amount < 50000 ? 'cashLow' : amount < 100000 ? 'cashMid' : 'cashHigh';
  return { managerName, normalizedName: normalizeSalesName(managerName), eventType, type, kind, amount, headline };
}
