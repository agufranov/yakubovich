/**
 * Каталог там, где есть сервер (dev и обычная сборка): фильтрует сервер,
 * браузер получает готовый HTML с выдачей — это и индексируется поисковиком
 * (docs/08), и не зависит от размера базы.
 *
 * Расширение `.ssr.tsx` включается через pageExtensions только при наличии
 * сервера; в статическом экспорте вместо этого файла берется page.static.tsx.
 */
import { queryLots } from '@bankrot/storage/query';
import { CatalogView } from '@/components/Catalog';
import { parseQuery, toParams } from '@/lib/catalog-query';
import { getStore } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function CatalogPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = toParams(await props.searchParams);
  const q = parseQuery(params);
  const res = queryLots(getStore().loadLots(), q);

  return <CatalogView params={params} q={q} res={res} />;
}
