import type { LotKind, LotStatus } from '@bankrot/shared';
import { STATUS_LABELS, daysLeft, plural } from '@bankrot/shared';
import type { DumpLot } from '@/lib/dump';

/** Цвет статуса: живое — зеленое/синее, подведение — янтарное, мертвое — серое/красное */
const STATUS_COLOR: Record<LotStatus, string> = {
  published: 'blue',
  applications: 'green',
  determining: 'amber',
  finished: '',
  failed: 'red',
  canceled: '',
  archived: '',
  unknown: '',
};

export function StatusChip({ status, statusRaw }: { status: LotStatus; statusRaw?: string }) {
  const color = STATUS_COLOR[status];
  const label = status === 'unknown' && statusRaw ? statusRaw : STATUS_LABELS[status];
  return <span className={`chip ${color}`}>{label}</span>;
}

export const KIND_ICONS: Record<LotKind, string> = {
  vehicle: '🚗',
  realty: '🏠',
  land: '🌾',
  equipment: '⚙️',
  business: '🏭',
  receivable: '📄',
  other: '📦',
};

/** «через 3 дня» — и признак срочности для подсветки */
export function deadlineInfo(lot: DumpLot): { text: string; soon: boolean } | null {
  const d = daysLeft(lot.biddEndAt);
  if (d == null) return null;
  if (d === 0) return { text: 'заявки — сегодня', soon: true };
  return {
    text: `заявки ${d} ${plural(d, 'день', 'дня', 'дней')}`,
    soon: d <= 3,
  };
}

/** Пара самых говорящих атрибутов для карточки в каталоге */
const CARD_ATTR_KEYS = [
  'yearProduction',
  'mileage',
  'totalAreaRealty',
  'SquareZU',
  'carMarka',
  'engineCapacity',
];
const CARD_ATTR_SHORT: Record<string, (v: string, u?: string) => string> = {
  yearProduction: (v) => `${v} г.`,
  mileage: (v) => `${Number(v).toLocaleString('ru-RU')} км`,
  totalAreaRealty: (v) => `${v} м²`,
  SquareZU: (v) => `${v} м²`,
  carMarka: (v) => v,
  engineCapacity: (v) => `${v} л`,
};

export function cardAttributes(lot: DumpLot, max = 2): string[] {
  const out: string[] = [];
  for (const key of CARD_ATTR_KEYS) {
    const a = lot.attributes.find((x) => x.key === key);
    if (!a) continue;
    const fmt = CARD_ATTR_SHORT[key];
    out.push(fmt ? fmt(a.value, a.unit) : a.value);
    if (out.length >= max) break;
  }
  return out;
}
