/**
 * Два режима сборки:
 *   обычный — dev-сервер и SSR, данные читаются из FileStore на каждый запрос;
 *   STATIC_EXPORT=1 — статический экспорт для GitHub Pages (tools/deploy).
 *     Сервера там нет: каталог фильтрует дамп базы в браузере, карточки лотов
 *     отрендерены заранее, прокси файлов недоступен (см. apps/web/lib/site.ts).
 */
const isStatic = process.env.STATIC_EXPORT === '1';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

/**
 * Роуты, которым нужен сервер (прокси файлов, живой дамп базы), лежат в файлах
 * `route.ssr.ts` и подключаются только когда сервер есть. В статическом
 * экспорте их просто нет — вместо них готовые файлы в out/.
 */
const pageExtensions = isStatic
  ? ['tsx', 'ts', 'jsx', 'js']
  : ['ssr.ts', 'ssr.tsx', 'tsx', 'ts', 'jsx', 'js'];

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions,
  transpilePackages: [
    '@bankrot/shared',
    '@bankrot/storage',
    '@bankrot/connector-core',
    '@bankrot/connector-gis-torgi',
  ],
  ...(isStatic
    ? {
        output: 'export',
        // GitHub Pages отдает каталог как <path>/index.html
        trailingSlash: true,
        basePath,
        images: { unoptimized: true },
      }
    : {}),
};
export default nextConfig;
