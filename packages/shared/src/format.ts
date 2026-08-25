/** Форматирование для UI. Работает и на сервере, и в браузере. */

/**
 * Цена хранится точной строкой ('17598.75'). Для показа конвертация в Number
 * допустима: это только отображение, в данные float не попадает.
 */
export function formatMoney(value: string | undefined, currency = 'RUB'): string | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const s = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
  return currency === 'RUB' ? `${s} ₽` : `${s} ${currency}`;
}

/**
 * Дата в часовом поясе лота (docs/05: «прием заявок до 12:00» без пояса — это
 * ошибка на 9 часов между Калининградом и Камчаткой).
 */
export function formatDateTime(iso: string | undefined, tzOffsetMin?: number, tzName?: string): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const shifted = new Date(t + (tzOffsetMin ?? 180) * 60_000); // по умолчанию МСК
  const s = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).format(shifted);
  return tzName ? `${s} (${tzName})` : s;
}

export function formatDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(t));
}

/** Сколько осталось до дедлайна; null — если он прошел или не задан */
export function daysLeft(iso: string | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t < now) return null;
  return Math.floor((t - now) / 86_400_000);
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
