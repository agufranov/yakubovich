'use client';

/**
 * Каталог для статической сборки (GitHub Pages), где фильтровать некому:
 * браузер один раз качает дамп базы и считает выдачу сам — тем же queryLots,
 * что и сервер. В режиме с сервером этот файл не участвует вовсе.
 */
import { useEffect, useMemo, useState } from 'react';
import { formatDate } from '@bankrot/shared';
import { queryLots } from '@bankrot/storage/query';
import { CatalogView } from '@/components/Catalog';
import { parseQuery, toParams } from '@/lib/catalog-query';
import type { LotsDump } from '@/lib/dump';
import { LOTS_DUMP_URL } from '@/lib/site';
import { useSearchParams } from 'next/navigation';

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

export function CatalogClient() {
  const searchParams = useSearchParams();
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

  const params = useMemo(() => toParams(searchParams), [searchParams]);
  const q = useMemo(() => parseQuery(params), [params]);
  // 652 лота фильтруются за миллисекунды, но гонять это на каждый ререндер незачем
  const res = useMemo(() => queryLots(dump?.lots ?? [], q), [dump, q]);

  return (
    <CatalogView
      params={params}
      q={q}
      res={res}
      loading={!dump && !error}
      error={error}
      footnote={
        dump
          ? `Данные обновлены ${formatDate(dump.generatedAt)} · в базе ${dump.count.toLocaleString('ru-RU')} лотов`
          : undefined
      }
    />
  );
}
