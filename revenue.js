const SHEET_ID = '1jPKS6ghi9Fh1EBCuTgLnoi-QDajsE4eAroZPVvW8zSk';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;
const CACHE_MS = 60_000;

export const TEAM_SHEET_GROUPS = Object.freeze({
  fomenko: 'Фоменко Александр',
  lvovsky: 'Львовский Виталий',
  shabanov: 'Шабанов Анар',
  kozhanov: 'Кожанов Владислав',
  otrakusha: 'Отрокуша Людмила',
  kulikov: 'Куликов Александр',
  kondratyev: 'Кондратьев Александр',
  chekhova: 'Чехова Марина',
  klimentovich: 'Клементович Денис',
  bagaturiya: 'Багатурия Давид'
});

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(value => value !== '')) rows.push(row);
      row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('Незакрытая ячейка CSV');
  row.push(cell);
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

export function normalizeName(value) {
  return String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
}

export function parseRevenue(value) {
  const clean = String(value || '').replace(/[\s\u00a0\u202f₽]/g, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(clean)) return null;
  const amount = Number(clean);
  return Number.isSafeInteger(amount * 100) ? amount : null;
}

export function revenueFromCsv(csv) {
  const rows = parseCsv(csv.replace(/^\ufeff/, ''));
  const header = rows.shift()?.map(value => value.trim()) || [];
  const groupColumn = header.indexOf('РГ');
  const managerColumn = header.indexOf('Менеджер');
  const revenueColumn = header.indexOf('Выручка');
  if (groupColumn < 0 || managerColumn < 0 || revenueColumn < 0) throw new Error('Колонки выручки не найдены');
  const groups = {};
  for (const row of rows) {
    const group = row[groupColumn]?.trim();
    const name = row[managerColumn]?.trim();
    const revenue = parseRevenue(row[revenueColumn]);
    if (!group || !name || revenue === null) continue;
    (groups[group] ||= []).push({ name, revenue });
  }
  return groups;
}

export function revenueForTeam(groups, teamKey) {
  const name = TEAM_SHEET_GROUPS[teamKey];
  if (!name || !Object.hasOwn(groups, name)) return null;
  return groups[name].reduce((sum, row) => sum + row.revenue, 0);
}

export function revenueForPlayer(groups, teamKey, playerName) {
  const rows = groups[TEAM_SHEET_GROUPS[teamKey]] || [];
  const shortNames = { оля: 'ольга', настя: 'анастасия', ваня: 'иван', коля: 'николай', дима: 'дмитрий', миша: 'михаил' };
  const wanted = normalizeName(playerName).map(token => shortNames[token] || token);
  if (!wanted.length) return null;
  const matches = rows.filter(row => {
    const actual = normalizeName(row.name);
    return wanted.length === 1
      ? actual.includes(wanted[0])
      : wanted.length === actual.length && wanted.every(token => actual.includes(token));
  });
  return matches.length === 1 ? matches[0].revenue : null;
}

let cache = null, expires = 0, inFlight = null;

export async function getRevenueSnapshot() {
  if (cache && Date.now() < expires) return cache;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await fetch(SHEET_URL, { signal: AbortSignal.timeout(8000), headers: { Accept: 'text/csv' } });
      if (!response.ok) throw new Error(`Google Sheets HTTP ${response.status}`);
      const csv = await response.text();
      const groups = revenueFromCsv(csv);
      if (!Object.keys(groups).length) throw new Error('В таблице нет данных о выручке');
      cache = { groups, fetchedAt: new Date().toISOString(), stale: false };
      expires = Date.now() + CACHE_MS;
      return cache;
    } catch (error) {
      console.warn('Revenue refresh failed:', error.message);
      expires = Date.now() + 15_000;
      return cache ? { ...cache, stale: true } : null;
    } finally { inFlight = null; }
  })();
  return inFlight;
}
