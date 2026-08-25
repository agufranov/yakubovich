/**
 * Поиск и фильтры по лотам в памяти. Интерфейс продуман под будущий Postgres:
 * это тот же контракт, что даст SQL с tsvector, — заменится реализация.
 */
import type { CoreLot, LegalBasis, LotKind, LotStatus } from '@bankrot/shared';
import { ACTIVE_STATUSES } from '@bankrot/shared';

export type StatusGroup = 'active' | 'finished' | 'all';
export type SortKey = 'newest' | 'deadline' | 'price_asc' | 'price_desc';

export interface LotQuery {
  text?: string;
  kind?: LotKind;
  basis?: LegalBasis;
  region?: string;
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
  statusGroups: { value: StatusGroup; count: number }[];
}

export interface QueryResult {
  lots: CoreLot[];
  total: number;
  page: number;
  pages: number;
  facets: Facets;
}

const FINISHED: LotStatus[] = ['finished', 'failed', 'canceled', 'archived'];

function inStatusGroup(lot: CoreLot, group: StatusGroup): boolean {
  if (group === 'all') return true;
  if (group === 'active') return (ACTIVE_STATUSES as string[]).includes(lot.status);
  return (FINISHED as string[]).includes(lot.status);
}

function priceOf(lot: CoreLot): number | undefined {
  const v = lot.priceStart ?? lot.priceMin;
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function matchesText(lot: CoreLot, needle: string): boolean {
  return (
    lot.title.toLowerCase().includes(needle) ||
    (lot.description?.toLowerCase().includes(needle) ?? false) ||
    (lot.address?.toLowerCase().includes(needle) ?? false) ||
    lot.attributes.some((a) => a.value.toLowerCase().includes(needle))
  );
}

export function queryLots(all: CoreLot[], q: LotQuery): QueryResult {
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
      (!q.basis || lot.legalBasis === q.basis),
  );
  const filtered = afterKindRegion.filter((lot) => inStatusGroup(lot, group));

  // фасеты
  const kindCounts = new Map<LotKind, number>();
  const basisCounts = new Map<LegalBasis, number>();
  const regionCounts = new Map<string, number>();
  for (const lot of base.filter((l) => inStatusGroup(l, group))) {
    const kindOk = !q.kind || lot.kind === q.kind;
    const regionOk = !q.region || lot.regionCode === q.region;
    const basisOk = !q.basis || lot.legalBasis === q.basis;
    if (regionOk && basisOk) kindCounts.set(lot.kind, (kindCounts.get(lot.kind) ?? 0) + 1);
    if (kindOk && regionOk) basisCounts.set(lot.legalBasis, (basisCounts.get(lot.legalBasis) ?? 0) + 1);
    if (kindOk && basisOk && lot.regionCode) {
      regionCounts.set(lot.regionCode, (regionCounts.get(lot.regionCode) ?? 0) + 1);
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
      statusGroups,
    },
  };
}
