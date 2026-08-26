'use client';

/**
 * Каталог целиком на клиенте: один раз качаем дамп базы и фильтруем в браузере
 * тем же queryLots, что и на сервере. Так одна и та же выдача работает и в dev,
 * и на GitHub Pages, где сервера нет вовсе.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  KIND_LABELS,
  LEGAL_BASIS_LABELS,
  formatDate,
  regionName,
  type LegalBasis,
  type LotKind,
} from '@bankrot/shared';
import { queryLots, type LotQuery, type SortKey, type StatusGroup } from '@bankrot/storage/query';
import { LotCard } from '@/components/LotCard';
import type { LotsDump } from '@/lib/dump';
import { LOTS_DUMP_URL } from '@/lib/site';

type Params = Record<string, string>;

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

/** Дамп качаем один раз на вкладку: 1.8 МБ незачем тянуть на каждый фильтр */
let dumpPromise: Promise<LotsDump> | null = null;
function loadDump(): Promise<LotsDump> {
  if (!dumpPromise) {
    dumpPromise = fetch(LOTS_DUMP_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<LotsDump>;
      })
      .catch((e) => {
        dumpPromise = null; // дать повторить попытку при следующем заходе
        throw e;
      });
  }
  return dumpPromise;
}

function useDump(): { dump: LotsDump | null; error: string | null } {
  const [dump, setDump] = useState<LotsDump | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadDump().then(
      (d) => {
        if (alive) setDump(d);
      },
      (e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return { dump, error };
}

function num(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number(v.replace(/\s/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Ссылка с измененным одним параметром (страница сбрасывается) */
function href(params: Params, patch: Record<string, string | undefined>): string {
  const qs = new URLSearchParams(params);
  qs.delete('page');
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) qs.delete(k);
    else qs.set(k, v);
  }
  const str = qs.toString();
  return str ? `/?${str}` : '/';
}

function hrefPage(params: Params, page: number): string {
  const qs = new URLSearchParams(params);
  if (page > 1) qs.set('page', String(page));
  else qs.delete('page');
  const str = qs.toString();
  return str ? `/?${str}` : '/';
}

export function Catalog() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { dump, error } = useDump();

  const params: Params = useMemo(() => {
    const out: Params = {};
    for (const [k, v] of searchParams.entries()) if (v.trim()) out[k] = v.trim();
    return out;
  }, [searchParams]);

  const q: LotQuery = useMemo(
    () => ({
      text: params.q,
      kind: params.kind as LotKind | undefined,
      basis: params.basis as LegalBasis | undefined,
      region: params.region,
      statusGroup: (params.status as StatusGroup | undefined) ?? 'all',
      priceFrom: num(params.from),
      priceTo: num(params.to),
      sort: (params.sort as SortKey | undefined) ?? 'newest',
      page: num(params.page) ?? 1,
    }),
    [params],
  );

  // фильтрация 652 лотов — это миллисекунды, но гонять ее на каждый ререндер
  // незачем: пересчитываем при смене URL или прихода дампа
  const res = useMemo(() => queryLots(dump?.lots ?? [], q), [dump, q]);

  const hasFilters = Boolean(
    q.text || q.kind || q.basis || q.region || q.priceFrom || q.priceTo || q.statusGroup !== 'all',
  );

  /** GET-форма без перезагрузки страницы: иначе каждый поиск заново качает дамп */
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const qs = new URLSearchParams();
    for (const [k, v] of new FormData(e.currentTarget).entries()) {
      const s = String(v).trim();
      if (s) qs.set(k, s);
    }
    const str = qs.toString();
    router.push(str ? `/?${str}` : '/');
  }

  return (
    <main className="page">
      <div className="catalog">
        <aside className="filters">
          <form onSubmit={submit}>
            {/* сохранить остальные параметры при поиске текстом */}
            {q.kind && <input type="hidden" name="kind" value={q.kind} />}
            {q.basis && <input type="hidden" name="basis" value={q.basis} />}
            {q.region && <input type="hidden" name="region" value={q.region} />}
            {q.statusGroup !== 'all' && <input type="hidden" name="status" value={q.statusGroup} />}
            {q.sort !== 'newest' && <input type="hidden" name="sort" value={q.sort} />}
            <h3>Поиск</h3>
            <input
              key={`q:${q.text ?? ''}`}
              type="search"
              name="q"
              placeholder="VIN, адрес, «гараж»…"
              defaultValue={q.text ?? ''}
            />
            <h3 style={{ marginTop: 14 }}>Цена, ₽</h3>
            <div className="price-row">
              <input
                key={`from:${q.priceFrom ?? ''}`}
                type="number"
                name="from"
                placeholder="от"
                min={0}
                defaultValue={q.priceFrom ?? ''}
              />
              <span>—</span>
              <input
                key={`to:${q.priceTo ?? ''}`}
                type="number"
                name="to"
                placeholder="до"
                min={0}
                defaultValue={q.priceTo ?? ''}
              />
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
            <span className="total">{dump ? `${res.total.toLocaleString('ru-RU')} шт.` : '…'}</span>
            <form onSubmit={submit}>
              {Object.entries(params).map(([k, v]) =>
                k === 'sort' || k === 'page' ? null : (
                  <input key={k} type="hidden" name={k} value={v} />
                ),
              )}
              <select
                name="sort"
                defaultValue={q.sort}
                key={`sort:${q.sort}`}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
              >
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

          {error ? (
            <div className="empty">
              <p>Не удалось загрузить базу лотов ({error}).</p>
              <button className="btn" type="button" onClick={() => location.reload()}>
                Повторить
              </button>
            </div>
          ) : !dump ? (
            <div className="lot-grid">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="lot-card skeleton" aria-hidden />
              ))}
            </div>
          ) : res.lots.length === 0 ? (
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

          {dump && (
            <p className="footnote">
              Данные обновлены {formatDate(dump.generatedAt)} · в базе{' '}
              {dump.count.toLocaleString('ru-RU')} лотов
            </p>
          )}
        </section>
      </div>
    </main>
  );
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
