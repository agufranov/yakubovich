/**
 * Каталог для статической сборки: фильтровать на GitHub Pages некому, выдачу
 * считает браузер по дампу базы (components/CatalogClient.tsx). Здесь только
 * Suspense-граница, которой требует useSearchParams.
 *
 * Расширение `.static.tsx` включается через pageExtensions только в
 * статическом экспорте; там, где есть сервер, берется page.ssr.tsx.
 */
import { Suspense } from 'react';
import { CatalogClient } from '@/components/CatalogClient';

export default function CatalogPage() {
  return (
    <Suspense fallback={null}>
      <CatalogClient />
    </Suspense>
  );
}
