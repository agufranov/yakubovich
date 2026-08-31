/**
 * Дамп базы для каталога. Каталог фильтрует лоты в браузере (на GitHub Pages
 * сервера нет), поэтому база выгружается в один JSON — и его качает КАЖДЫЙ
 * посетитель. Отсюда единственное правило этого модуля: в дамп едет ровно то,
 * что каталогу нужно для фильтров, сортировки и карточки в списке.
 *
 * Что осталось за бортом и почему (замеры на 2562 лотах, 31.08.2026):
 *   attachments  27% веса — по вложениям не ищут, карточка лота берет их
 *                из хранилища напрямую;
 *   attributes   28% веса, но львиная доля — это «порядок ознакомления» и
 *                «обременения», абзацы текста, по которым никто не ищет.
 *                Едут только короткие значения (VIN, марка, год, пробег);
 *   pricePeriods 10% веса — график снижения показывает карточка лота,
 *                в списке от него нужна лишь цена отсечения (priceMin);
 *   parties      контакты, СРО и тип лица не нужны для поиска — остаются
 *                имя и ИНН, по которым собирается выдача по лицу;
 *   images       в списке видна одна обложка, остальные — на карточке;
 *   name/source  у атрибутов: подпись и происхождение весили вдвое больше
 *                самих значений (1,4 МБ служебного против 0,9 МБ полезного);
 *   description  режется до первых 240 символов — дальше идет
 *                юридический текст, по которому все равно не ищут;
 *   служебное    contentHash, firstSeenAt, sourceUrl и прочее, чего витрина
 *                не показывает вовсе.
 *
 * Тип дампа — `QueryableLot` из storage: он же и контракт. Компилятор не даст
 * каталогу воспользоваться полем, которого в дампе нет.
 */
import type { CoreLot } from '@bankrot/shared';
import type { QueryableLot } from '@bankrot/storage/query';

export type DumpLot = QueryableLot;

export interface LotsDump {
  generatedAt: string;
  count: number;
  lots: DumpLot[];
}

/**
 * Порог «короткого» атрибута. Правило по длине, а не список ключей: новые
 * источники приносят свои имена полей, и список пришлось бы вести вечно, а
 * забытый длинный атрибут молча раздул бы дамп. Всё, что длиннее, — это
 * описательный текст, по которому не ищут.
 */
const MAX_ATTR_VALUE = 64;

/**
 * Сколько символов описания едет в дамп. Описание нужно только поиску, и
 * опознавательная часть (модель, VIN, адрес) всегда в начале — дальше идет
 * текст условий. Полное описание показывает карточка лота, она серверная.
 */
const MAX_DESCRIPTION = 240;

/**
 * Атрибуты, которые показывает карточка в списке. Едут в дамп независимо от
 * длины и в этом же порядке разбираются карточкой (components/bits.tsx) —
 * список один, чтобы витрина не просила поля, которых в дампе нет.
 */
export const CARD_ATTR_KEYS = [
  // ГИС Торги
  'yearProduction',
  'mileage',
  'totalAreaRealty',
  'SquareZU',
  'carMarka',
  'engineCapacity',
  // МЭТС и прочие ЭТП
  'year',
  'brand',
  'model',
  'power',
  'vin',
];
const CARD_ATTR_SET = new Set<string>(CARD_ATTR_KEYS);

export function buildDump(lots: CoreLot[]): LotsDump {
  return {
    generatedAt: new Date().toISOString(),
    count: lots.length,
    lots: lots.map(toDumpLot),
  };
}

export function toDumpLot(lot: CoreLot): DumpLot {
  const out: DumpLot = {
    id: lot.id,
    title: lot.title,
    kind: lot.kind,
    legalBasis: lot.legalBasis,
    tradeKind: lot.tradeKind,
    status: lot.status,
    currency: lot.currency,
    attributes: lot.attributes
      .filter((a) => CARD_ATTR_SET.has(a.key) || a.value.length <= MAX_ATTR_VALUE)
      .map((a) => (a.unit ? { key: a.key, value: a.value, unit: a.unit } : { key: a.key, value: a.value })),
    images: lot.images.slice(0, 1),
  };

  // необязательные поля кладем только когда они есть: undefined в JSON.stringify
  // не пишется, но пустой ключ в объекте — это лишние байты в каждом лоте
  if (lot.description) out.description = lot.description.slice(0, MAX_DESCRIPTION);
  if (lot.statusRaw) out.statusRaw = lot.statusRaw;
  if (lot.regionCode) out.regionCode = lot.regionCode;
  if (lot.address) out.address = lot.address;
  if (lot.priceStart) out.priceStart = lot.priceStart;
  if (lot.priceMin) out.priceMin = lot.priceMin;
  if (lot.publishedAt) out.publishedAt = lot.publishedAt;
  if (lot.biddEndAt) out.biddEndAt = lot.biddEndAt;
  if (lot.etpCode) out.etpCode = lot.etpCode;
  if (lot.caseNumber) out.caseNumber = lot.caseNumber;
  if (lot.parties?.length) {
    out.parties = lot.parties.map((p) => (p.inn ? { name: p.name, inn: p.inn } : { name: p.name }));
  }
  return out;
}
