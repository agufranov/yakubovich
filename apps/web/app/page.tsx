/**
 * Оболочка каталога. Сама выдача — клиентская (components/Catalog.tsx): она
 * работает с дампом базы, поэтому одинаково живет и в dev, и в статике на
 * GitHub Pages. Здесь остается только Suspense-граница для useSearchParams.
 */
import { Suspense } from 'react';
import { Catalog } from '@/components/Catalog';

export default function CatalogPage() {
  return (
    <Suspense fallback={null}>
      <Catalog />
    </Suspense>
  );
}
