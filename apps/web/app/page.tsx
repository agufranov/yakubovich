import Link from 'next/link';
import { KIND_LABELS, LEGAL_BASIS_LABELS, regionName, type LegalBasis, type LotKind } from '@bankrot/shared';
import { queryLots, type LotQuery, type SortKey, type StatusGroup } from '@bankrot/storage';
import { LotCard } from '@/components/LotCard';
import { getStore } from '@/lib/data';

export const dynamic = 'force-dynamic';

type Params = Record<string, string | string[] | undefined>;

function s(params: Params, key: string): string | undefined {
  const v = params[key];
  const one = Array.isArray(v) ? v[0] : v;
  return one?.trim() || undefined;
}
function n(params: Params, key: string): number | undefined {
  const v = s(params, key);
  if (v == null) return undefined;
  const num = Number(v.replace(/\s/g, ''));
  return Number.isFinite(num) ? num : undefined;
}

/** Ссылка с измененным одним параметром (страница сбрасывается) */
function href(params: Params, patch: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const one = Array.isArray(v) ? v[0] : v;
    if (one) qs.set(k, one);
  }
  qs.delete('page');
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) qs.delete(k);
    else qs.set(k, v);
  }
  const str = qs.toString();
  return str ? `/?${str}` : '/';
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Сначала новые' },
  { value: 'deadline', label: 'Скоро конец заявок' },
  { value: 'price_asc', label: 'Дешевле' },
  { value: 'price_desc', label: 'Дороже' },
];

const STATUS_GROUPS: { value: StatusGroup; label: string }[] = [
  { value: 'active', label: 'Идут торги' },
  { value: 'finished', label: 'Завершенные' },
  { value: 'all', label: 'Все' },
];

export default async function CatalogPage(props: { searchParams: Promise<Params> }) {
  const params = await props.searchParams;
  const q: LotQuery = {
    text: s(params, 'q'),
    kind: s(params, 'kind') as LotKind | undefined,
    basis: s(params, 'basis') as LegalBasis | undefined,
    region: s(params, 'region'),
    statusGroup: (s(params, 'status') as StatusGroup | undefined) ?? 'all',
    priceFrom: n(params, 'from'),
    priceTo: n(params, 'to'),
    sort: (s(params, 'sort') as SortKey | undefined) ?? 'newest',
    page: n(params, 'page') ?? 1,
  };

  const all = getStore().loadLots();
  const res = queryLots(all, q);
  const hasFilters = Boolean(
    q.text || q.kind || q.basis || q.region || q.priceFrom || q.priceTo || q.statusGroup !== 'all',
  );

  return (
    <main className="page">
      <div className="catalog">
        <aside className="filters">
          <form action="/" method="get">
            {/* сохранить остальные параметры при поиске текстом */}
            {q.kind && <input type="hidden" name="kind" value={q.kind} />}
            {q.basis && <input type="hidden" name="basis" value={q.basis} />}
            {q.region && <input type="hidden" name="region" value={q.region} />}
            {q.statusGroup !== 'all' && <input type="hidden" name="status" value={q.statusGroup} />}
            <h3>Поиск</h3>
            <input
              type="search"
              name="q"
              placeholder="VIN, адрес, «гараж»…"
              defaultValue={q.text ?? ''}
            />
            <h3 style={{ marginTop: 14 }}>Цена, ₽</h3>
            <div className="price-row">
              <input type="number" name="from" placeholder="от" min={0} defaultValue={q.priceFrom ?? ''} />
              <span>—</span>
              <input type="number" name="to" placeholder="до" min={0} defaultValue={q.priceTo ?? ''} />
            </div>
            <button className="btn primary" type="submit" style={{ width: '100%', marginTop: 10 }}>
              Применить
            </button>
          </form>

          <div>
            <h3>Состояние</h3>
            <div className="facet-list">
              {STATUS_GROUPS.map((g) => {
                const cnt = res.facets.statusGroups.find((x) => x.value === g.value)?.count ?? 0;
                return (
                  <Link
                    key={g.value}
                    className={q.statusGroup === g.value ? 'on' : ''}
                    href={href(params, { status: g.value === 'all' ? undefined : g.value })}
                  >
                    {g.label} <span className="n">{cnt}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          <div>
            <h3>Тип имущества</h3>
            <div className="facet-list">
              <Link className={!q.kind ? 'on' : ''} href={href(params, { kind: undefined })}>
                Все типы
              </Link>
              {res.facets.kinds.map((k) => (
                <Link
                  key={k.value}
                  className={q.kind === k.value ? 'on' : ''}
                  href={href(params, { kind: k.value })}
                >
                  {KIND_LABELS[k.value]} <span className="n">{k.count}</span>
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h3>Основание торгов</h3>
            <div className="facet-list">
              <Link className={!q.basis ? 'on' : ''} href={href(params, { basis: undefined })}>
                Все основания
              </Link>
              {res.facets.bases.map((b) => (
                <Link
                  key={b.value}
                  className={q.basis === b.value ? 'on' : ''}
                  href={href(params, { basis: b.value })}
                >
                  {LEGAL_BASIS_LABELS[b.value]} <span className="n">{b.count}</span>
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h3>Регион</h3>
            <div className="facet-list">
              <Link className={!q.region ? 'on' : ''} href={href(params, { region: undefined })}>
                Вся Россия
              </Link>
              {res.facets.regions.slice(0, 12).map((r) => (
                <Link
                  key={r.value}
                  className={q.region === r.value ? 'on' : ''}
                  href={href(params, { region: r.value })}
                >
                  {regionName(r.value) ?? `Регион ${r.value}`} <span className="n">{r.count}</span>
                </Link>
              ))}
            </div>
          </div>

          {hasFilters && (
            <Link href="/" className="reset-link">
              Сбросить все фильтры
            </Link>
          )}
        </aside>

        <section>
          <div className="results-head">
            <h1>{q.kind ? KIND_LABELS[q.kind] : 'Все лоты'}</h1>
            <span className="total">{res.total.toLocaleString('ru-RU')} шт.</span>
            <form action="/" method="get">
              {Object.entries(params).map(([k, v]) =>
                k === 'sort' || k === 'page' || !v ? null : (
                  <input key={k} type="hidden" name={k} value={Array.isArray(v) ? v[0] : v} />
                ),
              )}
              <select name="sort" defaultValue={q.sort}>
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>{' '}
              <button className="btn" type="submit">
                ОК
              </button>
            </form>
          </div>

          {res.lots.length === 0 ? (
            <div className="empty">
              <p>По этим условиям лотов нет.</p>
              <Link href="/">Сбросить фильтры</Link>
            </div>
          ) : (
            <div className="lot-grid">
              {res.lots.map((lot) => (
                <LotCard key={lot.id} lot={lot} />
              ))}
            </div>
          )}

          {res.pages > 1 && (
            <nav className="pagination">
              {pageItems(res.page, res.pages).map((p, i) =>
                p === '…' ? (
                  <span key={`gap${i}`} className="gap">
                    …
                  </span>
                ) : p === res.page ? (
                  <span key={p} className="current">
                    {p}
                  </span>
                ) : (
                  <Link key={p} href={hrefPage(params, p)}>
                    {p}
                  </Link>
                ),
              )}
            </nav>
          )}
        </section>
      </div>
    </main>
  );
}

function hrefPage(params: Params, page: number): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const one = Array.isArray(v) ? v[0] : v;
    if (one) qs.set(k, one);
  }
  if (page > 1) qs.set('page', String(page));
  else qs.delete('page');
  const str = qs.toString();
  return str ? `/?${str}` : '/';
}

function pageItems(current: number, total: number): (number | '…')[] {
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  const list = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  let prev = 0;
  for (const p of list) {
    if (p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}
