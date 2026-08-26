/**
 * Коннектор семейства iTender — 14 банкротных ЭТП на одном движке
 * (docs/research/etp-registry.md). Одна фабрика, экземпляр на площадку:
 * свой sourceCode -> свои state/прогоны/наблюдаемость.
 *
 * Механика, проверенная зондом (tools/probe/etp_itender_pagination.mts):
 *  - листинги `/public/{раздел}-all/` отвечают по GET, слэш обязателен (грабли);
 *  - пагинация — постбэк WebForms: POST со ВСЕМИ hidden-полями формы
 *    (__CVIEWSTATE и родня) + __EVENTTARGET из ссылки пейджера; состояние
 *    держится в сессии, поэтому клиент обязан хранить куки;
 *  - карточка лота `/public/{раздел}/lots/view/{id}/` отвечает по GET;
 *  - кодировка UTF-8.
 */
import type { CoreLot, LegalBasis, LotStatus, TradeKind } from '@bankrot/shared';
import { classifyKind } from '@bankrot/shared';
import {
  HttpClient,
  hashContent,
  type Connector,
  type DiscoverItem,
  type DiscoverOptions,
  type ParseContext,
} from '@bankrot/connector-core';
import {
  hiddenInputs,
  labelValuePairs,
  pagerLinks,
  parseMoney,
  parseRuDate,
  tableRows,
  textOf,
} from './html';
import type { ItenderPlatform } from './platforms';

/**
 * Допущение: даты на площадках iTender показываются по Москве. Не проверено
 * (пояс на страницах не указан) — вынесено в открытые вопросы PROGRESS.md.
 */
const TZ_SUFFIX = '+03:00';
const TZ_OFFSET_MIN = 180;

const DEFAULT_SECTIONS = 'auctions-all,public-offers-all';

/** Разделы листингов -> вид торгов */
const TRADE_KIND_BY_SECTION: Record<string, TradeKind> = {
  auctions: 'auction',
  'public-offers': 'public_offer',
  contests: 'competition',
};

/** Статус по подстроке; порядок важен («не состоялись» раньше «состоялись») */
const STATUS_RULES: [RegExp, LotStatus][] = [
  [/не состоял/i, 'failed'],
  [/состоял|заверш/i, 'finished'],
  [/при[её]м заявок/i, 'applications'],
  [/подведение|идут торги|торги проводятся|представление предложений/i, 'determining'],
  [/объявлен|опубликован/i, 'published'],
  [/отменен|аннулирован|приостановлен/i, 'canceled'],
];

function mapStatus(raw: string | undefined): LotStatus {
  if (!raw) return 'unknown';
  for (const [re, status] of STATUS_RULES) if (re.test(raw)) return status;
  return 'unknown';
}

const LOT_LINK_RE = /\/public\/([\w-]+)\/lots\/view\/(\d+)\//;

/** externalId кодирует раздел: `auctions_1167418` (двоеточий и слэшей нельзя — слаги) */
function toExternalId(section: string, lotId: string): string {
  return `${section}_${lotId}`;
}
function fromExternalId(externalId: string): { section: string; lotId: string } {
  const cut = externalId.lastIndexOf('_');
  if (cut <= 0) throw new Error(`некорректный externalId iTender: ${externalId}`);
  return { section: externalId.slice(0, cut), lotId: externalId.slice(cut + 1) };
}

/** Сырой ответ карточки — слой raw, пишется в NDJSON как есть */
export interface ItenderRawCard {
  url: string;
  section: string;
  lotId: string;
  html: string;
}

/** Строки листинга -> элементы discover */
export function parseListing(html: string): DiscoverItem[] {
  const out: DiscoverItem[] = [];
  const seen = new Set<string>();
  for (const cells of tableRows(html)) {
    const rowHtml = cells.join(' ');
    const link = rowHtml.match(LOT_LINK_RE);
    if (!link) continue;
    const externalId = toExternalId(link[1]!, link[2]!);
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    // отпечаток — видимый текст строки (цена, даты, статус) БЕЗ обратного
    // отсчета «(29 дн.)»: тот тикает ежедневно и перекачивал бы все карточки
    const visible = cells.map(textOf).join(' | ').replace(/\(\d+\s*дн\.?\)/g, '');
    out.push({ externalId, fingerprint: hashContent(visible) });
  }
  return out;
}

/** Ссылка пейджера на следующую страницу: точный номер или «>>» (следующее окно) */
export function nextPageLink(html: string, nextPage: number): { target: string; argument: string } | undefined {
  const links = pagerLinks(html);
  const exact = links.find((l) => l.text === String(nextPage));
  if (exact) return exact;
  const forward = links.find((l) => l.text === '>>' || l.text === '...' || l.text === '…');
  return forward;
}

export function makeItenderConnector(platform: ItenderPlatform): Connector {
  const base = platform.baseUrl.replace(/\/+$/, '');
  const code = `itender-${platform.code}`;

  return {
    code,

    async *discover(http: HttpClient, opts: DiscoverOptions): AsyncGenerator<DiscoverItem[]> {
      const sections = (opts.params?.sections ?? DEFAULT_SECTIONS).split(',').map((s) => s.trim());
      const maxPages = opts.maxPages ?? 10;

      for (const section of sections) {
        const url = `${base}/public/${section}/`; // слэш обязателен: без него 404
        let res = await http.get(url);
        let html = res.body.toString('utf-8');

        for (let page = 1; page <= maxPages; page++) {
          const items = parseListing(html);
          if (items.length === 0) break; // пустой раздел или конец выдачи
          yield items;

          if (page === maxPages) break;
          const nav = nextPageLink(html, page + 1);
          if (!nav) break; // пейджера нет или страница последняя

          const form = {
            ...hiddenInputs(html),
            __EVENTTARGET: nav.target,
            __EVENTARGUMENT: nav.argument,
          };
          res = await http.post(url, form, { Referer: url });
          const nextHtml = res.body.toString('utf-8');
          const nextItems = parseListing(nextHtml);
          // «чужой API врет молча»: постбэк мог вернуть ту же страницу — не зацикливаемся
          if (nextItems[0] && items[0] && nextItems[0].externalId === items[0].externalId) break;
          html = nextHtml;
        }
      }
    },

    async fetchCard(http: HttpClient, externalId: string): Promise<unknown> {
      const { section, lotId } = fromExternalId(externalId);
      const url = `${base}/public/${section}/lots/view/${lotId}/`;
      const res = await http.get(url);
      const html = res.body.toString('utf-8');
      // движок иногда отвечает 200 с редиректом на логин/ошибку — проверяем содержимое
      if (!/лот|торг/i.test(html)) {
        throw new Error(`карточка ${externalId}: 200, но содержимое не похоже на лот`);
      }
      const raw: ItenderRawCard = { url, section, lotId, html };
      return raw;
    },

    parse(rawUnknown: unknown, ctx: ParseContext): CoreLot {
      const raw = rawUnknown as ItenderRawCard;
      if (!raw?.html || !raw.lotId) throw new Error('пустой raw: нет html или lotId');
      const externalId = toExternalId(raw.section, raw.lotId);
      const pairs = labelValuePairs(raw.html);

      const first = (label: string | RegExp): string | undefined =>
        pairs.find((p) => (typeof label === 'string' ? p.label === label : label.test(p.label)))?.value ||
        undefined;
      const last = (label: string): string | undefined =>
        [...pairs].reverse().find((p) => p.label === label)?.value || undefined;

      // первое «Наименование» — у торгов, последнее — у самого лота
      const title = last('Наименование') ?? first('Наименование') ?? '(без названия)';
      const statusRaw = last('Статус');
      const classifier = first(/^Классификатор ЕФРСБ/);
      const efrsbMessage = first(/^Номер сообщения в ЕФРСБ/);
      const repeated = first(/^Повторные торги/);
      const stepPercent = first(/^Шаг, %/);

      // документы: обычные ссылки /public/attachments/file/{id}/{имя}
      const attachments: CoreLot['attachments'] = [];
      const seenFiles = new Set<string>();
      for (const m of raw.html.matchAll(/<a[^>]*href=['"](\/public\/attachments\/file\/(\d+)\/[^'"]*)['"][^>]*>([\s\S]*?)<\/a>/g)) {
        if (seenFiles.has(m[2]!)) continue;
        seenFiles.add(m[2]!);
        attachments.push({
          // не наш файловый стор: кладем полный URL источника (решение №4 —
          // документы не храним, только ссылки)
          fileId: base + m[1]!,
          name: textOf(m[3]!) || `Документ ${m[2]}`,
        });
      }

      const attributes: CoreLot['attributes'] = [];
      if (efrsbMessage)
        attributes.push({
          key: 'efrsbMessageId',
          name: 'Номер сообщения в ЕФРСБ',
          value: efrsbMessage,
          source: 'structured',
        });
      if (classifier)
        attributes.push({
          key: 'efrsbClassifier',
          name: 'Классификатор ЕФРСБ',
          value: classifier,
          source: 'structured',
        });
      if (repeated)
        attributes.push({ key: 'repeatTrades', name: 'Повторные торги', value: repeated, source: 'structured' });
      if (stepPercent)
        attributes.push({
          key: 'priceStepPercent',
          name: 'Шаг, % от начальной цены',
          value: stepPercent,
          source: 'structured',
        });

      return {
        id: `${code}:${externalId}`,
        sourceCode: code,
        externalId,
        sourceUrl: raw.url,
        title,
        description: first(/^Дополнительные сведения/),
        legalBasis: 'bankruptcy_127fz' as LegalBasis,
        legalBasisRaw: 'Торги по банкротству (127-ФЗ)',
        tradeKind: TRADE_KIND_BY_SECTION[raw.section] ?? 'other',
        tradeKindRaw: raw.section,
        status: mapStatus(statusRaw),
        statusRaw,
        kind: classifyKind(`${classifier ?? ''} ${title}`),
        categoryName: classifier,
        priceStart: parseMoney(first(/^Начальная цена/)),
        priceStep: parseMoney(first(/^Шаг, руб/)),
        deposit: parseMoney(first(/^Размер обеспечения, руб/)),
        currency: 'RUB',
        publishedAt: parseRuDate(first(/^Дата публикации сообщения/), TZ_SUFFIX),
        biddStartAt: parseRuDate(first(/^Дата начала представления заявок/), TZ_SUFFIX),
        biddEndAt: parseRuDate(first(/^Дата окончания представления заявок/), TZ_SUFFIX),
        auctionAt: parseRuDate(first(/^Дата проведения/), TZ_SUFFIX),
        tzOffsetMin: TZ_OFFSET_MIN,
        tzName: 'МСК',
        etpCode: platform.code,
        images: [],
        attachments,
        attributes,
        prevProcedureIds: [],
        firstSeenAt: ctx.prev?.firstSeenAt ?? ctx.now,
        lastSeenAt: ctx.now,
        contentHash: ctx.contentHash,
      };
    },
  };
}
