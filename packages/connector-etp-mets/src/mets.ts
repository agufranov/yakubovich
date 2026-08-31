/**
 * Коннектор МЭТС (m-ets.ru) — крупная одиночная банкротная ЭТП.
 * Разведка: docs/research/etp/mets.md.
 *
 * Почему она следующая после iTender: на ней 3 104 банкротных лота только в
 * категории «Легковой автомобиль», и карточка отдает то, чего нет больше
 * нигде из проверенного:
 *   - типизированные свойства машины (марка, модель, год, пробег, VIN);
 *   - график снижения цены публичного предложения ТАБЛИЦЕЙ, а не текстом;
 *   - должника и арбитражного управляющего отдельными полями, с ИНН и
 *     ссылкой на карточку лица в ЕФРСБ.
 *
 * Обход — по sitemap, а не по выдаче поиска: `robots.txt` площадки запрещает
 * `*page=*`, а `Allow: /sitemap*` и `Allow: /*-` (карточки лотов) разрешает.
 * Sitemap отдает `lastmod` на лот — это и есть дешевый отпечаток для discover.
 */
import type { CoreLot, LotParty, LotStatus, PricePeriod, TradeKind } from '@bankrot/shared';
import { classifyKind } from '@bankrot/shared';
import {
  HttpClient,
  hashContent,
  type Connector,
  type DiscoverItem,
  type DiscoverOptions,
  type ParseContext,
} from '@bankrot/connector-core';
import { divInner, extractInn, infoItems, parseMoney, parseRuDate, tableRows, textOf, type InfoItem } from './html';
import { parseSearchResults, searchUrl, type SearchCriteria } from './search';

export const METS_BASE = 'https://m-ets.ru';
export const METS_CODE = 'etp-mets';

/**
 * Площадка показывает время по Москве и пишет это в шапке («17:48 (МСК)»),
 * в отличие от iTender, где пояс приходилось принимать допущением.
 */
const TZ_SUFFIX = '+03:00';
const TZ_OFFSET_MIN = 180;

/** сколько лотов отдаем раннеру одной «страницей» discover */
const DISCOVER_CHUNK = 200;

const STATUS_RULES: [RegExp, LotStatus][] = [
  [/отменен|аннулирован|приостановлен/i, 'canceled'],
  [/завершен|состоял/i, 'finished'],
  [/подведени|проведение аукциона|подача ценовых предложений/i, 'determining'],
  [/при[её]м заявок завершен/i, 'determining'],
  [/при[её]м заявок/i, 'applications'],
  [/объявленные торги/i, 'published'],
];

export function mapStatus(raw: string | undefined): LotStatus {
  if (!raw) return 'unknown';
  // «Прием заявок завершен» должен читаться как подведение итогов, а не как
  // прием заявок — поэтому проверяем его раньше общего правила
  if (/при[её]м заявок завершен/i.test(raw)) return 'determining';
  for (const [re, status] of STATUS_RULES) if (re.test(raw)) return status;
  return 'unknown';
}

export function mapTradeKind(form: string | undefined): TradeKind {
  if (!form) return 'other';
  if (/публичного предложения/i.test(form)) return 'public_offer';
  if (/аукцион/i.test(form)) return 'auction';
  if (/конкурс/i.test(form)) return 'competition';
  return 'other';
}

/** Сырой ответ карточки — слой raw, пишется в NDJSON как есть */
export interface MetsRawCard {
  url: string;
  /** путь лота, он же externalId: `231205-1` */
  lotPath: string;
  html: string;
}

const LOT_PATH_RE = /^\d+-\d+$/;

/** `<loc>` + `<lastmod>` из sitemap; отпечаток лота = его lastmod */
export function parseSitemapUrls(xml: string): { externalId: string; lastmod: string }[] {
  const out: { externalId: string; lastmod: string }[] = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = m[1]!.match(/<loc>\s*([^<]+?)\s*<\/loc>/)?.[1];
    if (!loc) continue;
    const path = loc.replace(/^https?:\/\/[^/]+\//, '').replace(/\/+$/, '');
    if (!LOT_PATH_RE.test(path)) continue; // в карте есть и новости, и статьи
    out.push({ externalId: path, lastmod: m[1]!.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/)?.[1] ?? '' });
  }
  return out;
}

/** Адреса карт лотов из sitemapindex */
export function parseSitemapIndex(xml: string, includeCompleted: boolean): string[] {
  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]!);
  return locs.filter((u) => /active_lots/.test(u) || (includeCompleted && /completed_lots/.test(u)));
}

// ————— разбор карточки —————

function pick(items: InfoItem[], label: RegExp, section?: RegExp): InfoItem | undefined {
  return items.find((i) => label.test(i.label) && (!section || section.test(i.section)));
}

/** График снижения цены: таблица «№ | начало | окончание | цена | задаток» */
export function parsePricePeriods(valueHtml: string): PricePeriod[] {
  const out: PricePeriod[] = [];
  for (const cells of tableRows(valueHtml)) {
    if (cells.length < 4) continue;
    const no = Number(textOf(cells[0]!));
    if (!Number.isInteger(no) || no <= 0) continue; // строка заголовка
    // в ячейке две записи даты — длинная и короткая; берем первую
    const price = parseMoney(textOf(cells[3]!));
    if (!price) continue;
    out.push({
      no,
      startAt: parseRuDate(textOf(cells[1]!), TZ_SUFFIX),
      endAt: parseRuDate(textOf(cells[2]!), TZ_SUFFIX),
      price,
      deposit: cells[4] ? parseMoney(textOf(cells[4])) : undefined,
    });
  }
  return out.sort((a, b) => a.no - b.no);
}

/**
 * Блок запрошенного лота на странице торгов.
 *
 * Грабля: если в торгах несколько лотов, страница `/{торги}-{лот}` рендерит
 * ВСЕ лоты подряд, каждый в своем `generalview-container` с `data-lotNumber`.
 * Разбор по всему документу молча выдавал бы лоту №2 характеристики лота №1 —
 * ровно то, что и случилось на первом живом прогоне (215458-1 и 215458-2
 * получили один VIN на двоих).
 *
 * Свойства самого лота (VIN, цены, график) берем только отсюда, а сведения
 * о торгах и сторонах (должник, управляющий, дело) лежат ниже контейнеров,
 * общие на все лоты — их ищем по документу целиком.
 */
export function lotScope(html: string, lotNo: string): { tag: string; inner: string } | undefined {
  const re = /<div[^>]*\bclass="generalview-container"[^>]*>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[0].match(/data-lotNumber="(\d+)"/i)?.[1] !== lotNo) continue;
    return { tag: m[0], inner: divInner(html, m.index).inner };
  }
  return undefined;
}

/** Категория лота из `data-categories` контейнера: `[{"name":..,"id":..}]` */
export function scopeCategory(tag: string): { code?: string; name?: string } {
  const raw = tag.match(/data-categories='([^']*)'/)?.[1];
  if (!raw) return {};
  try {
    const first = (JSON.parse(raw) as { name?: string; id?: string }[])[0];
    return { code: first?.id, name: first?.name };
  } catch {
    return {};
  }
}

/** ID карточки лица на ЕФРСБ из ссылки в значении поля */
function efrsbPartyId(valueHtml: string | undefined): string | undefined {
  return valueHtml?.match(/(?:PrivatePerson|Company)Card\.aspx\?ID=([0-9a-f-]+)/i)?.[1];
}

/**
 * Стороны торгов. Разделы карточки различают одноименные поля: «ФИО» и «ИНН»
 * встречаются и у должника, и у управляющего.
 *
 * СНИЛС должника площадка показывает — мы его НЕ БЕРЕМ: он не нужен ни для
 * поиска, ни для склейки сущностей, а 152-ФЗ по должникам-физлицам и так
 * открытый риск проекта (docs/07-legal.md).
 */
export function parseParties(items: InfoItem[]): LotParty[] {
  const parties: LotParty[] = [];

  const debtorType = pick(items, /^Тип должника$/, /Сведения о должнике/)?.value;
  const debtorName =
    pick(items, /^(ФИО|Наименование)$/, /Сведения о должнике/) ??
    pick(items, /^Полное наименование/, /Сведения о должнике/);
  if (debtorName?.value) {
    parties.push({
      role: 'debtor',
      kind: /физическ|индивидуальн/i.test(debtorType ?? '') ? 'person' : /юридическ/i.test(debtorType ?? '') ? 'company' : 'unknown',
      name: debtorName.value,
      inn: pick(items, /^ИНН$/, /Сведения о должнике/)?.value,
      ogrn: pick(items, /^ОГРН/, /Сведения о должнике/)?.value,
      efrsbId: efrsbPartyId(debtorName.valueHtml),
    });
  }

  // раздел называется по процедуре: «Финансовый управляющий», «Конкурсный
  // управляющий», «Внешний управляющий» — все это одна роль
  const mgrSection = /управляющий/i;
  const mgrName = pick(items, /^(ФИО|Наименование)$/, mgrSection);
  if (mgrName?.value) {
    parties.push({
      role: 'manager',
      kind: 'person',
      name: mgrName.value,
      inn: pick(items, /^ИНН$/, mgrSection)?.value,
      sro: pick(items, /саморегулируемой организации/i, mgrSection)?.value,
      efrsbId: efrsbPartyId(mgrName.valueHtml),
    });
  }

  const orgName = pick(items, /^Наименование$/, /Организатор торгов/);
  if (orgName?.value) {
    parties.push({
      role: 'organizer',
      kind: 'unknown',
      name: orgName.value,
      inn: pick(items, /^ИНН$/, /Организатор торгов/)?.value,
      email: pick(items, /электронной почты/i, /Организатор торгов/)?.value,
      phone: pick(items, /^Телефон$/, /Организатор торгов/)?.value,
    });
  }

  const pledgee = pick(items, /^Конкурсный кредитор по обязательствам/);
  if (pledgee?.value && !/^(нет|отсутств)/i.test(pledgee.value)) {
    parties.push({
      role: 'pledgee',
      kind: 'unknown',
      name: pledgee.value,
      // ИНН залогового кредитора площадка прячет в подсказку `title="ИНН: ..."`
      inn: extractInn(pledgee.valueHtml.match(/title="ИНН:[^"]*"/)?.[0]),
    });
  }

  return parties;
}

/** Свойства машины: площадка отдает их отдельными полями, а не текстом */
const VEHICLE_FIELDS: [RegExp, string, string?][] = [
  [/^Марка$/, 'brand'],
  [/^Модель$/, 'model'],
  [/^Год выпуска транспорта$/, 'year'],
  [/^Пробег, км/, 'mileage', 'км'],
  [/^Мощность, л\.с/, 'power', 'л.с.'],
  [/^Двигатель$/, 'engine'],
  [/^Привод$/, 'drive'],
  [/^Коробка передач$/, 'transmission'],
  [/^Идентификационный номер \(VIN\)$/, 'vin'],
];

function lotTitle(html: string): string | undefined {
  const m = html.match(/<h2[^>]*class="[^"]*\blot-title\b[^"]*"[^>]*>/);
  if (!m) return undefined;
  // внутри есть служебный «еще» для схлопывания длинного заголовка
  return textOf(divInner(html, m.index!).inner.replace(/<span[^>]*ellipse[\s\S]*$/i, '')) || undefined;
}

export function makeMetsConnector(base = METS_BASE): Connector {
  const root = base.replace(/\/+$/, '');

  return {
    code: METS_CODE,

    async *discover(http: HttpClient, opts: DiscoverOptions): AsyncGenerator<DiscoverItem[]> {
      if (opts.params?.mode === 'search') {
        yield* discoverViaSearch(http, root, opts);
        return;
      }

      const index = (await http.get(`${root}/sitemap.xml`)).body.toString('utf-8');
      const maps = parseSitemapIndex(index, opts.params?.includeCompleted === 'true');
      if (maps.length === 0) throw new Error('sitemap.xml без карт лотов — разметка площадки изменилась');

      const all: { externalId: string; lastmod: string }[] = [];
      for (const url of maps) {
        const xml = (await http.get(url)).body.toString('utf-8');
        all.push(...parseSitemapUrls(xml));
      }
      // свежие вперед: так первыми доезжают изменившиеся лоты, а
      // stopAfterUnchangedPages обрывает прогон на давно неподвижном хвосте
      all.sort((a, b) => (a.lastmod < b.lastmod ? 1 : a.lastmod > b.lastmod ? -1 : 0));

      for (let i = 0; i < all.length; i += DISCOVER_CHUNK) {
        yield all.slice(i, i + DISCOVER_CHUNK).map((u) => ({
          externalId: u.externalId,
          fingerprint: hashContent(u.lastmod),
        }));
      }
    },

    async fetchCard(http: HttpClient, externalId: string): Promise<unknown> {
      if (!LOT_PATH_RE.test(externalId)) throw new Error(`некорректный externalId МЭТС: ${externalId}`);
      const url = `${root}/${externalId}`;
      const html = (await http.get(url)).body.toString('utf-8');
      // «чужой API врет молча»: снятая карточка отвечает 200 обычной страницей
      if (!/lot-info-item|lot-title/.test(html)) {
        throw new Error(`карточка ${externalId}: 200, но содержимое не похоже на лот`);
      }
      const raw: MetsRawCard = { url, lotPath: externalId, html };
      return raw;
    },

    parse(rawUnknown: unknown, ctx: ParseContext): CoreLot {
      const raw = rawUnknown as MetsRawCard;
      if (!raw?.html || !raw.lotPath) throw new Error('пустой raw: нет html или lotPath');
      const docItems = infoItems(raw.html);
      // разметка карточки поменялась или это не карточка вовсе — лучше
      // ошибка прогона, чем пустой лот в базе (docs/research/grabli.md)
      if (docItems.length === 0) throw new Error(`карточка ${raw.lotPath}: ни одного поля lot-info-item`);

      const lotNo = raw.lotPath.slice(raw.lotPath.indexOf('-') + 1);
      const scope = lotScope(raw.html, lotNo);
      const scopeHtml = scope?.inner ?? raw.html;
      const scopeItems = scope ? infoItems(scope.inner) : docItems;

      /** поле самого лота: только из его блока, без подмены соседним лотом */
      const lotVal = (label: RegExp, section?: RegExp): string | undefined =>
        pick(scopeItems, label, section)?.value || undefined;
      /** поле торгов: в блоке лота его нет, оно ниже и общее на все лоты */
      const val = (label: RegExp, section?: RegExp): string | undefined =>
        pick(scopeItems, label, section)?.value || pick(docItems, label, section)?.value || undefined;

      const form = val(/^Форма проведения торгов/);
      const tradeKind = mapTradeKind(form);
      const statusRaw =
        textOf(scopeHtml.match(/<div class="value lot-status-name"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '') || undefined;

      const schedule = pick(scopeItems, /^График снижения цены/);
      const pricePeriods = schedule ? parsePricePeriods(schedule.valueHtml) : [];

      const priceStart = parseMoney(lotVal(/^Начальная цена продажи имущества/));
      // у публичного предложения задаток свой на каждом периоде — в шапку
      // лота кладем задаток первого периода, чтобы поле не пустовало
      const deposit = parseMoney(lotVal(/^Размер задатка$/)) ?? pricePeriods[0]?.deposit;
      // цена отсечения публичного предложения — цена последнего периода
      const priceMin = pricePeriods.length > 0 ? pricePeriods[pricePeriods.length - 1]!.price : undefined;

      const category = scope ? scopeCategory(scope.tag) : {};
      const categoryName = category.name ?? lotVal(/^Категории поиска$/);
      const description = lotVal(/^C?ведения об имуществе/);
      const title = lotTitle(scopeHtml) ?? description ?? '(без названия)';

      const attributes: CoreLot['attributes'] = [];
      const addAttr = (key: string, name: string, value: string | undefined, unit?: string): void => {
        if (value) attributes.push({ key, name, value, unit, source: 'structured' });
      };
      for (const [re, key, unit] of VEHICLE_FIELDS) {
        const it = pick(scopeItems, re);
        if (it) addAttr(key, it.label, it.value, unit);
      }
      addAttr('efrsbTradeId', 'Идентификационный номер торгов на ЕФРСБ', val(/^Идентификационный номер торгов на ЕФРСБ$/));
      addAttr('court', 'Арбитражный суд', val(/^Наименование арбитражного суда$/));
      addAttr('procedureStartedAt', 'Дата введения процедуры', val(/^Дата введения процедуры$/));
      addAttr('priceStepPercent', 'Величина повышения начальной цены', lotVal(/^Величина повышения начальной цены$/));
      addAttr('encumbrances', 'Обременения', lotVal(/^C?ведения о наличии или об отсутствии обременений/));
      addAttr('inspection', 'Порядок ознакомления с имуществом', val(/^Порядок ознакомления с имуществом/));

      const attachments: CoreLot['attachments'] = [];
      const seenFiles = new Set<string>();
      for (const m of raw.html.matchAll(
        /<a[^>]*id=['"]files_cap_(\d+)['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/g,
      )) {
        if (seenFiles.has(m[1]!)) continue;
        seenFiles.add(m[1]!);
        // решение №4: файлы не храним, только ссылки
        attachments.push({ fileId: `${root}/${m[2]!.replace(/^\/+/, '')}`, name: textOf(m[3]!) || `Документ ${m[1]}` });
      }

      const images: string[] = [];
      for (const m of scopeHtml.matchAll(/<img[^>]*itemprop="image"[^>]*>/g)) {
        const src = m[0].match(/src="([^"]+)"/)?.[1];
        if (!src || /no-image/.test(src)) continue; // заглушка «фото нет»
        images.push(src.startsWith('http') ? src : `${root}/${src.replace(/^\/+/, '')}`);
      }

      const vid = val(/^Вид торгов$/);

      return {
        id: `${METS_CODE}:${raw.lotPath}`,
        sourceCode: METS_CODE,
        externalId: raw.lotPath,
        sourceUrl: raw.url,
        title,
        description,
        legalBasis: /банкрот/i.test(vid ?? '') ? 'bankruptcy_127fz' : 'other',
        legalBasisRaw: vid,
        tradeKind,
        tradeKindRaw: form,
        status: mapStatus(statusRaw),
        statusRaw,
        kind: classifyKind(`${categoryName ?? ''} ${title}`),
        categoryCode: category.code,
        categoryName,
        regionCode:
          scope?.tag.match(/data-regionId="(\d+)"/i)?.[1] ??
          raw.html.match(/<span data-region-id>\s*(\d+)\s*<\/span>/)?.[1],
        address: lotVal(/^Регион местонахождения имущества$/),
        priceStart,
        priceMin,
        priceStep: parseMoney(lotVal(/^Величина повышения начальной цены$/)),
        deposit,
        currency: 'RUB',
        publishedAt: parseRuDate(val(/^Дата размещения сообщения в Едином Федеральном Реестре/), TZ_SUFFIX),
        biddStartAt: parseRuDate(val(/^Начало предоставления заявок на участие$/), TZ_SUFFIX),
        biddEndAt: parseRuDate(val(/^Окончание предоставления заявок на участие$/), TZ_SUFFIX),
        auctionAt: parseRuDate(val(/^Дата и время подведения результатов торгов$/), TZ_SUFFIX),
        tzOffsetMin: TZ_OFFSET_MIN,
        tzName: 'МСК',
        caseNumber: val(/^Номер дела о банкротстве$/),
        parties: parseParties(docItems),
        pricePeriods: pricePeriods.length > 0 ? pricePeriods : undefined,
        etpCode: 'mets',
        images,
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

/**
 * Обход выдачи поиска — только по явному требованию (`--via-search`).
 * Дешевле sitemap, когда нужна одна категория (машины — 156 страниц вместо
 * 15 000 карточек), но `robots.txt` площадки запрещает `*page=*`.
 * Решение принимает человек, а не коннектор: см. CLI.
 */
async function* discoverViaSearch(
  http: HttpClient,
  root: string,
  opts: DiscoverOptions,
): AsyncGenerator<DiscoverItem[]> {
  const criteria: SearchCriteria = {
    categories: opts.params?.categories ? opts.params.categories.split(',') : undefined,
    bankruptcyOnly: opts.params?.bankruptcyOnly !== 'false',
  };
  const maxPages = opts.maxPages ?? 5;
  let prevFirst: string | undefined;
  for (let page = 1; page <= maxPages; page++) {
    const html = (await http.get(searchUrl(root, criteria, page))).body.toString('utf-8');
    const results = parseSearchResults(html);
    if (results.length === 0) break;
    // за границей выдачи движок отдает 200 с той же страницей — не зацикливаемся
    if (results[0]!.externalId === prevFirst) break;
    prevFirst = results[0]!.externalId;
    yield results.map((r) => ({ externalId: r.externalId, fingerprint: hashContent(r.visible) }));
  }
}
