/**
 * Контракт коннектора (docs/03-architecture.md).
 * Всё расписание, ретраи, метрики и сохранение raw делает раннер, не коннектор.
 */
import type { CoreLot } from '@bankrot/shared';
import type { HttpClient } from './http';

/** Элемент дешевого обхода списка */
export interface DiscoverItem {
  externalId: string;
  /**
   * Отпечаток записи в листинге (хеш видимых полей). Совпал с прошлым прогоном —
   * карточку не перекачиваем. Это и есть разделение discover/fetch.
   */
  fingerprint: string;
}

export interface DiscoverOptions {
  /** максимум страниц листинга за прогон */
  maxPages?: number;
  /** произвольные параметры среза (biddType и т.п.) */
  params?: Record<string, string>;
}

export interface ParseContext {
  now: string;
  /** предыдущая версия лота — для сохранения firstSeenAt */
  prev?: CoreLot;
  contentHash: string;
}

export interface Connector {
  /** код источника: 'gis-torgi', 'etp-itender', ... */
  code: string;

  /** Дешевый обход списков. Отдает страницы идентификаторов. */
  discover(http: HttpClient, opts: DiscoverOptions): AsyncGenerator<DiscoverItem[]>;

  /** Полная карточка. Возвращает сырой ответ источника как есть. */
  fetchCard(http: HttpClient, externalId: string): Promise<unknown>;

  /**
   * Сырое -> core. ЧИСТАЯ функция: никакой сети, никакого времени внутри
   * (now приходит в ctx). Тестируется на фикстурах, переигрывается на архиве.
   */
  parse(raw: unknown, ctx: ParseContext): CoreLot;
}
