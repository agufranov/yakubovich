/**
 * Коннектор ГИС Торги (torgi.gov.ru). Спецификация API восстановлена зондированием:
 * docs/research/gis-torgi-api.md. Ограничения источника, зашитые сюда:
 *   - size молча клампится до 10 -> запрашиваем ровно 10;
 *   - доступны страницы 0..999, page=1000 отдает 200 с пустым телом;
 *   - под нагрузкой 503 -> клиент ретраит с паузами (connector-core).
 */
import type { CoreLot, LotAttribute, LotKind, LegalBasis, LotStatus, TradeKind } from '@bankrot/shared';
import {
  EmptyBodyError,
  HttpClient,
  type Connector,
  type DiscoverItem,
  type DiscoverOptions,
  type ParseContext,
  hashContent,
} from '@bankrot/connector-core';

const API = 'https://torgi.gov.ru/new/api/public';
const PAGE_SIZE = 10; // жесткий кламп источника, больше не отдаст
const MAX_PAGE = 999; // дальше 200 OK с пустым телом

// ---------- типы сырого ответа (только то, на что опираемся) ----------

interface GtDict {
  code?: string;
  name?: string;
}
interface GtCharacteristic {
  code?: string;
  name?: string;
  characteristicValue?: unknown;
  unit?: { symbol?: string; name?: string };
}
interface GtAttachment {
  fileId?: string;
  fileName?: string;
  fileSize?: number;
  hash?: string;
}
export interface GtLotCard {
  id?: string;
  noticeNumber?: string;
  lotNumber?: number;
  lotName?: string;
  lotDescription?: string;
  lotStatus?: string;
  biddType?: GtDict;
  biddForm?: GtDict;
  category?: GtDict;
  subjectRFCode?: string;
  estateAddress?: string;
  priceMin?: number;
  priceMinExact?: string;
  priceFin?: number;
  priceFinExact?: string;
  priceStep?: number;
  deposit?: number;
  currencyCode?: string;
  biddStartTime?: string;
  biddEndTime?: string;
  auctionStartDate?: string;
  noticeFirstVersionPublicationDate?: string;
  createDate?: string;
  timezoneOffset?: string;
  timeZoneName?: string;
  etpCode?: string;
  lotImages?: string[];
  lotAttachments?: GtAttachment[];
  characteristics?: GtCharacteristic[];
  previousProcedures?: unknown[];
  isAnnulled?: boolean;
}
interface GtSearchPage {
  content?: GtLotCard[];
  totalPages?: number;
  numberOfElements?: number;
}

// ---------- маппинги ----------

const LEGAL_BASIS_BY_BIDD_TYPE: Record<string, LegalBasis> = {
  '229FZ': 'fssp_229fz',
  '178FZ': 'privatization_178fz',
  '1041PP': 'confiscated_1041pp',
  ZK: 'land',
  ZKPT: 'land',
};

const STATUS_MAP: Record<string, LotStatus> = {
  PUBLISHED: 'published',
  APPLICATIONS_SUBMISSION: 'applications',
  DETERMINING_WINNER: 'determining',
  SUCCEED: 'finished',
  FAILED: 'failed',
  CANCELED: 'canceled',
  ANNULLED: 'canceled',
};

const TRADE_KIND_MAP: Record<string, TradeKind> = {
  EA: 'auction', // электронный аукцион
  OA: 'auction',
  AU: 'auction',
  PP: 'public_offer',
  PO: 'public_offer',
  KO: 'competition',
  EK: 'competition',
};

/**
 * Категория -> наш верхний уровень. Сначала точные коды госклассификатора,
 * затем фолбэк по ключевым словам имени (устойчивее к новым кодам).
 */
const KIND_BY_CATEGORY_CODE: Record<string, LotKind> = {
  '100001': 'vehicle',
  '401': 'equipment',
  '8': 'realty',
  '11': 'realty',
  '206': 'realty',
  '220': 'realty',
  '903': 'realty',
  '4': 'land',
  '301': 'land',
  '307': 'land',
};

function kindFromCategory(code: string | undefined, name: string | undefined, title: string): LotKind {
  if (code && KIND_BY_CATEGORY_CODE[code]) return KIND_BY_CATEGORY_CODE[code];
  const hay = `${name ?? ''} ${title}`.toLowerCase();
  if (/автомоб|транспорт|легков|грузов|прицеп|мотоцикл|спецтехн|самоход|судно|катер|самолет|воздушн/.test(hay)) return 'vehicle';
  if (/земельн|земли|участок/.test(hay)) return 'land';
  if (/квартир|жил|помещен|здани|недвиж|дом|гараж|машино-мест|сооружен/.test(hay)) return 'realty';
  if (/оборудован|станок|станк|техник|инструмент|электрон/.test(hay)) return 'equipment';
  if (/дебиторск|права требован/.test(hay)) return 'receivable';
  if (/доля в уставн|акци|предприят|бизнес/.test(hay)) return 'business';
  return 'other';
}

function exactPrice(exact: string | undefined, approx: number | undefined): string | undefined {
  // цены — только строками; точное строковое поле в приоритете (docs/04)
  if (exact != null && exact !== '') return exact;
  if (approx != null) return String(approx);
  return undefined;
}

function cleanValue(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(cleanValue).filter(Boolean);
    return parts.length ? parts.join(', ') : undefined;
  }
  if (typeof v === 'object') {
    const o = v as { name?: unknown; value?: unknown };
    return cleanValue(o.name ?? o.value);
  }
  return undefined;
}

// ---------- коннектор ----------

export interface GisTorgiParams {
  /** срез по типу торгов: '229FZ', '178FZ', ... (docs: фильтр проверен зондом) */
  biddType?: string;
}

export const gisTorgi: Connector = {
  code: 'gis-torgi',

  async *discover(http: HttpClient, opts: DiscoverOptions): AsyncGenerator<DiscoverItem[]> {
    const maxPages = Math.min(opts.maxPages ?? 25, MAX_PAGE + 1);
    const biddType = opts.params?.biddType;
    for (let page = 0; page < maxPages; page++) {
      const qs = new URLSearchParams({
        size: String(PAGE_SIZE),
        page: String(page),
        sort: 'firstVersionPublicationDate,desc',
      });
      if (biddType) qs.set('biddType', biddType);
      let data: GtSearchPage;
      try {
        data = await http.getJson<GtSearchPage>(`${API}/lotcards/search?${qs}`);
      } catch (e) {
        if (e instanceof EmptyBodyError) return; // граница выдачи источника
        throw e;
      }
      const content = data.content ?? [];
      if (content.length === 0) return;
      yield content
        .filter((c): c is GtLotCard & { id: string } => typeof c.id === 'string')
        .map((c) => ({
          externalId: c.id,
          // отпечаток листинга: если тут ничего не поменялось, карточку не качаем
          fingerprint: hashContent({
            s: c.lotStatus,
            p: c.priceMinExact ?? c.priceMin,
            f: c.priceFinExact ?? c.priceFin,
            e: c.biddEndTime,
            a: c.isAnnulled,
          }),
        }));
    }
  },

  async fetchCard(http: HttpClient, externalId: string): Promise<unknown> {
    return http.getJson(`${API}/lotcards/${encodeURIComponent(externalId)}`);
  },

  parse(rawUnknown: unknown, ctx: ParseContext): CoreLot {
    const raw = rawUnknown as GtLotCard;
    const externalId = raw.id ?? `${raw.noticeNumber}_${raw.lotNumber}`;
    if (!externalId || externalId.includes('undefined')) {
      throw new Error('карточка без id: нечем идентифицировать лот');
    }
    const title = raw.lotName?.trim() || '(без названия)';
    const biddTypeCode = raw.biddType?.code;
    const statusRaw = raw.lotStatus;
    const attributes: LotAttribute[] = [];
    for (const ch of raw.characteristics ?? []) {
      // характеристика без characteristicValue = «поле есть, значение не заполнено»
      const value = cleanValue(ch.characteristicValue);
      if (!value || !ch.code) continue;
      attributes.push({
        key: ch.code,
        name: ch.name?.trim() || ch.code,
        value,
        unit: ch.unit?.symbol || undefined,
        source: 'structured',
      });
    }

    const tzRaw = Number(raw.timezoneOffset);

    return {
      id: `gis-torgi:${externalId}`,
      sourceCode: 'gis-torgi',
      externalId,
      sourceUrl: `https://torgi.gov.ru/new/public/lots/lot/${externalId}`,
      title,
      description: raw.lotDescription?.trim() || undefined,
      legalBasis: (biddTypeCode && LEGAL_BASIS_BY_BIDD_TYPE[biddTypeCode]) || 'other',
      legalBasisRaw: raw.biddType?.name,
      tradeKind: (raw.biddForm?.code && TRADE_KIND_MAP[raw.biddForm.code]) || 'other',
      tradeKindRaw: raw.biddForm?.name,
      status: (statusRaw && STATUS_MAP[statusRaw]) || 'unknown',
      statusRaw,
      kind: kindFromCategory(raw.category?.code, raw.category?.name, title),
      categoryCode: raw.category?.code,
      categoryName: raw.category?.name,
      regionCode: raw.subjectRFCode?.padStart(2, '0'),
      address: raw.estateAddress?.trim() || undefined,
      priceStart: exactPrice(raw.priceMinExact, raw.priceMin),
      priceMin: exactPrice(raw.priceFinExact, raw.priceFin),
      priceStep: raw.priceStep != null ? String(raw.priceStep) : undefined,
      deposit: raw.deposit != null ? String(raw.deposit) : undefined,
      currency: raw.currencyCode === '643' || !raw.currencyCode ? 'RUB' : raw.currencyCode,
      publishedAt: raw.noticeFirstVersionPublicationDate ?? raw.createDate,
      biddStartAt: raw.biddStartTime,
      biddEndAt: raw.biddEndTime,
      auctionAt: raw.auctionStartDate,
      tzOffsetMin: Number.isFinite(tzRaw) ? tzRaw : undefined,
      tzName: raw.timeZoneName,
      etpCode: raw.etpCode,
      images: (raw.lotImages ?? []).filter((x): x is string => typeof x === 'string'),
      attachments: (raw.lotAttachments ?? [])
        .filter((a): a is GtAttachment & { fileId: string } => typeof a.fileId === 'string')
        .map((a) => ({
          fileId: a.fileId,
          name: a.fileName ?? a.fileId,
          size: a.fileSize,
          sha256: a.hash,
        })),
      attributes,
      prevProcedureIds: (raw.previousProcedures ?? [])
        .map((p) => cleanValue((p as { lotId?: unknown })?.lotId ?? p))
        .filter((x): x is string => Boolean(x)),
      firstSeenAt: ctx.prev?.firstSeenAt ?? ctx.now,
      lastSeenAt: ctx.now,
      contentHash: ctx.contentHash,
    };
  },
};

/** URL файла (изображения/вложения) в файловом сторе ГИС Торги */
export function gisTorgiFileUrl(fileId: string): string {
  return `https://torgi.gov.ru/new/file-store/v1/${fileId}`;
}
