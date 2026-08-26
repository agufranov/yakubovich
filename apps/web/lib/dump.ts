/**
 * Дамп базы для каталога. Каталог фильтрует лоты в браузере (на GitHub Pages
 * сервера нет), поэтому база выгружается в один JSON.
 *
 * Что внутри: лоты целиком, кроме attachments — по вложениям не ищут и не
 * фильтруют, а весят они треть дампа. Карточка лота отрендерена заранее и берет
 * вложения из хранилища напрямую.
 *
 * Сейчас 652 лота = 1.8 МБ (~400 КБ в gzip). Когда архив вырастет на порядок,
 * это место придется менять: узкий индекс для выдачи + поиск отдельным сервисом.
 */
import type { CoreLot } from '@bankrot/shared';

export type DumpLot = Omit<CoreLot, 'attachments'>;

export interface LotsDump {
  generatedAt: string;
  count: number;
  lots: DumpLot[];
}

export function buildDump(lots: CoreLot[]): LotsDump {
  return {
    generatedAt: new Date().toISOString(),
    count: lots.length,
    lots: lots.map(({ attachments: _attachments, ...rest }) => rest),
  };
}
