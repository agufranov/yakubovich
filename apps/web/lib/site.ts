/**
 * Различия между двумя режимами сборки. Клиентский модуль: никаких node-импортов.
 *
 *   dev/SSR   — данные из FileStore, файлы через прокси /api/file/<id>;
 *   static    — сборка для GitHub Pages: база выгружена в /data/lots.json,
 *               прокси нет, картинки берем прямо с источника.
 */

/** '' в dev, '/<repo>' для project page на GitHub Pages */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const IS_STATIC = process.env.NEXT_PUBLIC_STATIC === '1';

/** basePath к своим ссылкам Next приписывает сам, к <img src> и fetch — нет */
export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}

/**
 * Картинка или вложение лота. В статике прокси недоступен, идем на torgi.gov.ru
 * напрямую (URL — тот же, что строит gisTorgiFileUrl в коннекторе). Минус
 * известен: браузер без сертификата Минцифры такую картинку не покажет.
 */
export function fileUrl(fileId: string): string {
  return IS_STATIC
    ? `https://torgi.gov.ru/new/file-store/v1/${fileId}`
    : withBase(`/api/file/${fileId}`);
}

/** Дамп базы: в dev его отдает роут-хендлер, в статике это реальный файл */
export const LOTS_DUMP_URL = withBase('/data/lots.json');
