/**
 * Единая модель лота (слой core). См. docs/04-data-model.md.
 * Хранилище пока файловое, но типы — те же, что лягут в Postgres.
 */

export type LotKind =
  | 'vehicle'      // транспорт
  | 'realty'       // недвижимость
  | 'land'         // земля
  | 'equipment'    // оборудование и техника
  | 'business'     // доли в УК, предприятия
  | 'receivable'   // права требования (дебиторка)
  | 'other';

export type TradeKind = 'auction' | 'public_offer' | 'competition' | 'other';

export type LegalBasis =
  | 'bankruptcy_127fz'     // банкротство
  | 'fssp_229fz'           // арестованное имущество ФССП
  | 'privatization_178fz'  // приватизация
  | 'confiscated_1041pp'   // изъятое в собственность государства
  | 'land'                 // земельные торги
  | 'other';

export type LotStatus =
  | 'published'    // опубликован, прием заявок еще не начался
  | 'applications' // идет прием заявок
  | 'determining'  // подведение итогов
  | 'finished'     // состоялся
  | 'failed'       // не состоялся
  | 'canceled'     // отменен/аннулирован
  | 'archived'     // пропал из источника (мы ничего не удаляем)
  | 'unknown';

export interface LotAttribute {
  key: string;       // код источника ('vin', 'mileage', ...)
  name: string;      // человекочитаемое имя из источника
  value: string;
  unit?: string;
  /** structured — из структурного поля источника; regex/llm появятся позже */
  source: 'structured' | 'regex' | 'llm';
}

export interface LotAttachment {
  fileId: string;
  name: string;
  size?: number;
  sha256?: string;
}

export interface CoreLot {
  /** `${sourceCode}:${externalId}` — глобальный ключ */
  id: string;
  sourceCode: string;
  externalId: string;
  /** Страница лота на источнике — то, куда уходит пользователь */
  sourceUrl: string;

  title: string;
  description?: string;

  legalBasis: LegalBasis;
  legalBasisRaw?: string;
  tradeKind: TradeKind;
  tradeKindRaw?: string;
  status: LotStatus;
  statusRaw?: string;

  kind: LotKind;
  categoryCode?: string;
  categoryName?: string;

  regionCode?: string;
  address?: string;

  /** Цены — ТОЛЬКО строки из точных полей источника. Никаких float (docs/04). */
  priceStart?: string;
  priceMin?: string;
  priceStep?: string;
  deposit?: string;
  currency: string;

  publishedAt?: string;
  biddStartAt?: string;
  biddEndAt?: string;
  auctionAt?: string;
  /** Часовой пояс лота: смещение в минутах от UTC и имя из источника */
  tzOffsetMin?: number;
  tzName?: string;

  etpCode?: string;
  images: string[];
  attachments: LotAttachment[];
  attributes: LotAttribute[];
  /** ID предыдущих процедур по тому же имуществу (для цепочек торгов) */
  prevProcedureIds: string[];

  firstSeenAt: string;
  lastSeenAt: string;
  contentHash: string;
}

/** Запись сырого ответа источника (слой raw, неизменяемый) */
export interface RawRecord {
  externalId: string;
  fetchedAt: string;
  contentHash: string;
  payload: unknown;
}

/** Итог одного прогона коннектора — основа наблюдаемости (docs/03) */
export interface RunRecord {
  sourceCode: string;
  /** ingest — обход листинга; sweep — перепроверка давно не виденных лотов */
  mode?: 'ingest' | 'sweep';
  startedAt: string;
  finishedAt: string;
  pagesScanned: number;
  itemsSeen: number;
  itemsNew: number;
  itemsChanged: number;
  itemsUnchanged: number;
  /** лоты, стертые источником и переведенные у нас в archived (sweep) */
  itemsArchived?: number;
  cardsFetched: number;
  parseErrors: number;
  httpErrors: number;
  aborted?: string;
}

export const KIND_LABELS: Record<LotKind, string> = {
  vehicle: 'Транспорт',
  realty: 'Недвижимость',
  land: 'Земля',
  equipment: 'Оборудование и техника',
  business: 'Бизнес',
  receivable: 'Права требования',
  other: 'Прочее',
};

export const STATUS_LABELS: Record<LotStatus, string> = {
  published: 'Опубликован',
  applications: 'Приём заявок',
  determining: 'Подведение итогов',
  finished: 'Состоялся',
  failed: 'Не состоялся',
  canceled: 'Отменён',
  archived: 'В архиве',
  unknown: 'Статус неизвестен',
};

export const LEGAL_BASIS_LABELS: Record<LegalBasis, string> = {
  bankruptcy_127fz: 'Банкротство',
  fssp_229fz: 'Арестованное имущество',
  privatization_178fz: 'Приватизация',
  confiscated_1041pp: 'Изъятое имущество',
  land: 'Земельные торги',
  other: 'Прочие торги',
};

export const TRADE_KIND_LABELS: Record<TradeKind, string> = {
  auction: 'Аукцион',
  public_offer: 'Публичное предложение',
  competition: 'Конкурс',
  other: 'Торги',
};

/** Статусы, при которых лот «живой» и показывается в выдаче по умолчанию */
export const ACTIVE_STATUSES: LotStatus[] = ['published', 'applications', 'determining'];
