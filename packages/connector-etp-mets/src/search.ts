/**
 * Поисковый запрос МЭТС.
 *
 * Форма поиска не отправляет поля как есть: JS собирает из них JSON, кодирует
 * в base64 (без хвостовых `=`) и кладет в один параметр `?q=`. Пагинация —
 * обычный `&page=N`. Обычные GET-параметры (`?search_category=1`) движок
 * молча выбрасывает и отвечает 308 на голый `/search` — классическое «чужой
 * API врет молча», проверено зондом.
 *
 * ВАЖНО: `robots.txt` МЭТС разрешает из поиска только SEO-адреса вида
 * `/search?q=...&sp=7qr7` (одна категория и/или один регион, без прочих
 * фильтров) и прямо запрещает `*page=*`. Поэтому обход выдачи постранично —
 * не путь по умолчанию: штатный discover идет по sitemap (см. mets.ts).
 */

/** Категории поиска МЭТС (`search_category`), сняты с формы поиска */
export const METS_CATEGORIES: Record<string, string> = {
  '1': 'Легковой автомобиль',
  '3': 'Коммерческий транспорт и спецтехника',
  '4': 'Мототехника',
  '5': 'Водный транспорт',
  '6': 'Авиатранспорт',
  '8': 'Иной транспорт и техника',
  '11': 'Земельный участок',
  '12': 'С/х техника',
  '14': 'Иное с/х имущество',
  '15': 'Промышленное оборудование',
  '16': 'Строительное оборудование',
  '17': 'Складское оборудование',
  '18': 'Торговое оборудование',
  '19': 'Металлообрабатывающее оборудование',
  '20': 'Пищевое оборудование',
  '21': 'Деревообрабатывающее оборудование',
  '22': 'Производственные линии',
  '23': 'Другое оборудование',
  '24': 'Задолженность физ. лиц',
  '25': 'Задолженность юр. лиц',
  '26': 'Смешанная задолженность',
  '27': 'Товарно-материальные ценности',
  '28': 'Имущественный комплекс',
  '29': 'Ценные бумаги',
  '30': 'Прочее',
  '34': 'Жилой дом',
  '36': 'Квартира',
  '37': 'Нежилое помещение',
  '38': 'Нежилое здание',
  '39': 'Прочие постройки',
  '40': 'Объекты с/х недвижимости',
  '42': 'Аренда, сервис, продажи',
};

/** Категории «на колесах» — первый этап продукта (docs/12-lotum.md) */
export const VEHICLE_CATEGORIES = ['1', '3', '4', '12'];

/**
 * `?q=` из набора полей формы. Ключи сортируются — так же, как это делает
 * скрипт площадки, чтобы адрес совпадал с настоящим до символа.
 */
export function encodeQuery(fields: Record<string, string | string[]>): string {
  const sorted: Record<string, string | string[]> = {};
  for (const k of Object.keys(fields).sort()) sorted[k] = fields[k]!;
  return Buffer.from(JSON.stringify(sorted), 'utf-8').toString('base64').replace(/=+$/, '');
}

export interface SearchCriteria {
  /** коды категорий, `search_category` */
  categories?: string[];
  /** только банкротные торги (у МЭТС есть и коммерческие) */
  bankruptcyOnly?: boolean;
  /** коды регионов, `xregion[]` */
  regions?: string[];
}

export function searchUrl(base: string, c: SearchCriteria, page = 1): string {
  const fields: Record<string, string | string[]> = {};
  if (c.categories?.length) fields.search_category = c.categories.join(',');
  if (c.bankruptcyOnly) fields.isbankr = 'on';
  if (c.regions?.length) fields['xregion[]'] = c.regions;
  const q = encodeQuery(fields);
  return `${base}/search?q=${encodeURIComponent(q)}${page > 1 ? `&page=${page}` : ''}`;
}

/** Число найденных лотов из шапки выдачи — им и меряем объем площадки */
export function parseFoundCount(html: string): number | undefined {
  const m = html.match(/search-results-info[\s\S]{0,400}?<div class="value">\s*(\d+)\s*<\/div>/);
  return m ? Number(m[1]) : undefined;
}

/** Ссылки на лоты в выдаче: `href="231248-1" class="card--shadow ...` */
export function parseSearchResults(html: string): { externalId: string; visible: string }[] {
  const out: { externalId: string; visible: string }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<div\b[^>]*\bclass="card-so"[\s\S]*?(?=<div\b[^>]*\bclass="card-so"|$)/g)) {
    const block = m[0]!;
    const id = block.match(/href="(\d+-\d+)"/)?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // отпечаток без обратного отсчета «Осталось: 35 дней» — он тикает ежедневно
    const visible = block
      .replace(/<[^>]*>/g, ' ')
      .replace(/Осталось:\s*[^<]*?дн\w*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    out.push({ externalId: id, visible });
  }
  return out;
}
