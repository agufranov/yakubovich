/**
 * Поиск и фильтры по лотам в памяти. Интерфейс продуман под будущий Postgres:
 * это тот же контракт, что даст SQL с tsvector, — заменится реализация.
 */
import type { LegalBasis, LotKind, LotStatus, TradeKind } from '@bankrot/shared';
import { ACTIVE_STATUSES } from '@bankrot/shared';

/**
 * Все, что нужно фильтрам, сортировке и карточке в списке — и ничего сверх.
 *
 * Это не удобство, а контракт с витриной. Каталог на GitHub Pages качает базу
 * целиком (apps/web/lib/dump.ts), поэтому каждое лишнее поле здесь — это
 * мегабайты у каждого посетителя. Раньше тип был `Omit<CoreLot, 'attachments'>`,
 * то есть «всё, кроме вложений», и дамп пух вместе с моделью: тексты порядка
 * ознакомления, графики снижения, служебные хеши.
 *
 * Теперь наоборот: список полей явный, и компилятор не даст каталогу
 * воспользоваться тем, чего в дампе нет. `CoreLot` этому типу соответствует
 * структурно, поэтому серверный режим работает с теми же функциями.
 */
export interface QueryableLot {
  id: string;
  title: string;
  description?: string;
  kind: LotKind;
  legalBasis: LegalBasis;
  tradeKind: TradeKind;
  status: LotStatus;
  statusRaw?: string;
  regionCode?: string;
  address?: string;
  priceStart?: string;
  priceMin?: string;
  currency: string;
  publishedAt?: string;
  biddEndAt?: string;
  etpCode?: string;
  caseNumber?: string;
  /**
   * Только короткие значения и только полезная часть: человекочитаемое `name`
   * и `source` витрине не нужны, а весили они вдвое больше самих значений.
   */
  attributes: { key: string; value: string; unit?: string }[];
  /** только имя и ИНН — по ним ищут; контакты и СРО живут на карточке лота */
  parties?: { name: string; inn?: string; efrsbId?: string }[];
  /** только обложка: в списке показывается одна картинка */
  images: string[];
}

export type StatusGroup = 'active' | 'finished' | 'all';
export type SortKey = 'newest' | 'deadline' | 'price_asc' | 'price_desc';

export interface LotQuery {
  text?: string;
  kind?: LotKind;
  basis?: LegalBasis;
  region?: string;
  /** код площадки (CoreLot.etpCode) */
  etp?: string;
  statusGroup?: StatusGroup;
  priceFrom?: number;
  priceTo?: number;
  sort?: SortKey;
  page?: number;
  perPage?: number;
}

export interface Facets {
  kinds: { value: LotKind; count: number }[];
  bases: { value: LegalBasis; count: number }[];
  regions: { value: string; count: number }[];
  etps: { value: string; count: number }[];
  statusGroups: { value: StatusGroup; count: number }[];
}

export interface QueryResult<T extends QueryableLot = QueryableLot> {
  lots: T[];
  total: number;
  page: number;
  pages: number;
  facets: Facets;
}

const FINISHED: LotStatus[] = ['finished', 'failed', 'canceled', 'archived'];

function inStatusGroup(lot: QueryableLot, group: StatusGroup): boolean {
  if (group === 'all') return true;
  if (group === 'active') return (ACTIVE_STATUSES as string[]).includes(lot.status);
  return (FINISHED as string[]).includes(lot.status);
}

function priceOf(lot: QueryableLot): number | undefined {
  const v = lot.priceStart ?? lot.priceMin;
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function matchesText(lot: QueryableLot, needle: string): boolean {
  return (
    lot.title.toLowerCase().includes(needle) ||
    (lot.description?.toLowerCase().includes(needle) ?? false) ||
    (lot.address?.toLowerCase().includes(needle) ?? false) ||
    lot.attributes.some((a) => a.value.toLowerCase().includes(needle)) ||
    // по ИНН должника или управляющего собирается «все лоты этого лица»,
    // по номеру дела — все имущество одной процедуры
    (lot.caseNumber?.toLowerCase().includes(needle) ?? false) ||
    (lot.parties?.some(
      (p) => p.name.toLowerCase().includes(needle) || p.inn === needle || p.efrsbId === needle,
    ) ?? false)
  );
}

export function queryLots<T extends QueryableLot>(all: T[], q: LotQuery): QueryResult<T> {
  const needle = q.text?.trim().toLowerCase();
  const group = q.statusGroup ?? 'all';

  // фильтр без «своего» измерения — чтобы фасеты показывали, что даст переключение
  const base = all.filter((lot) => {
    if (needle && !matchesText(lot, needle)) return false;
    const p = priceOf(lot);
    if (q.priceFrom != null && (p == null || p < q.priceFrom)) return false;
    if (q.priceTo != null && (p == null || p > q.priceTo)) return false;
    return true;
  });

  const afterKindRegion = base.filter(
    (lot) =>
      (!q.kind || lot.kind === q.kind) &&
      (!q.region || lot.regionCode === q.region) &&
      (!q.basis || lot.legalBasis === q.basis) &&
      (!q.etp || lot.etpCode === q.etp),
  );
  const filtered = afterKindRegion.filter((lot) => inStatusGroup(lot, group));

  // фасеты
  const kindCounts = new Map<LotKind, number>();
  const basisCounts = new Map<LegalBasis, number>();
  const regionCounts = new Map<string, number>();
  const etpCounts = new Map<string, number>();
  for (const lot of base.filter((l) => inStatusGroup(l, group))) {
    const kindOk = !q.kind || lot.kind === q.kind;
    const regionOk = !q.region || lot.regionCode === q.region;
    const basisOk = !q.basis || lot.legalBasis === q.basis;
    const etpOk = !q.etp || lot.etpCode === q.etp;
    if (regionOk && basisOk && etpOk) kindCounts.set(lot.kind, (kindCounts.get(lot.kind) ?? 0) + 1);
    if (kindOk && regionOk && etpOk) basisCounts.set(lot.legalBasis, (basisCounts.get(lot.legalBasis) ?? 0) + 1);
    if (kindOk && basisOk && etpOk && lot.regionCode) {
      regionCounts.set(lot.regionCode, (regionCounts.get(lot.regionCode) ?? 0) + 1);
    }
    if (kindOk && regionOk && basisOk && lot.etpCode) {
      etpCounts.set(lot.etpCode, (etpCounts.get(lot.etpCode) ?? 0) + 1);
    }
  }
  const statusGroups: Facets['statusGroups'] = (['active', 'finished', 'all'] as const).map((g) => ({
    value: g,
    count: afterKindRegion.filter((l) => inStatusGroup(l, g)).length,
  }));

  // сортировка
  const sort = q.sort ?? 'newest';
  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'deadline': {
        const ta = a.biddEndAt ? Date.parse(a.biddEndAt) : Infinity;
        const tb = b.biddEndAt ? Date.parse(b.biddEndAt) : Infinity;
        return ta - tb;
      }
      case 'price_asc':
        return (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity);
      case 'price_desc':
        return (priceOf(b) ?? -Infinity) - (priceOf(a) ?? -Infinity);
      case 'newest':
      default: {
        const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        return tb - ta;
      }
    }
  });

  const perPage = q.perPage ?? 24;
  const pages = Math.max(1, Math.ceil(sorted.length / perPage));
  const page = Math.min(Math.max(1, q.page ?? 1), pages);

  return {
    lots: sorted.slice((page - 1) * perPage, page * perPage),
    total: sorted.length,
    page,
    pages,
    facets: {
      kinds: [...kindCounts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
      bases: [...basisCounts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
      regions: [...regionCounts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
      etps: [...etpCounts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
      statusGroups,
    },
  };
}
