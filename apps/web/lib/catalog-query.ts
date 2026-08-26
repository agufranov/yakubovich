/**
 * Разбор параметров каталога из URL. Один на оба режима: серверная страница
 * получает их из searchParams, клиентская — из useSearchParams, а вопрос к
 * хранилищу должен получаться ровно один и тот же.
 */
import type { LegalBasis, LotKind } from '@bankrot/shared';
import type { LotQuery, SortKey, StatusGroup } from '@bankrot/storage/query';

export type Params = Record<string, string>;

/** Приводит и `searchParams` страницы, и URLSearchParams к плоскому виду */
export function toParams(
  raw: URLSearchParams | Record<string, string | string[] | undefined>,
): Params {
  const entries =
    raw instanceof URLSearchParams ? [...raw.entries()] : Object.entries(raw);
  const out: Params = {};
  for (const [key, value] of entries) {
    const one = Array.isArray(value) ? value[0] : value;
    const trimmed = one?.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

function num(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number(v.replace(/\s/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export function parseQuery(params: Params): LotQuery {
  return {
    text: params.q,
    kind: params.kind as LotKind | undefined,
    basis: params.basis as LegalBasis | undefined,
    region: params.region,
    statusGroup: (params.status as StatusGroup | undefined) ?? 'all',
    priceFrom: num(params.from),
    priceTo: num(params.to),
    sort: (params.sort as SortKey | undefined) ?? 'newest',
    page: num(params.page) ?? 1,
  };
}
