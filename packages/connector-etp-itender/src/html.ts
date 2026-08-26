/**
 * Разбор верстки движка iTender (ASP.NET WebForms). Не «парсер HTML вообще»:
 * движок один на 14 площадок, верстка генерируется машинно и одинакова —
 * разбираем ровно этот шаблон, дрейф ловят тесты на фикстурах.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/** Текст ячейки/узла: без тегов, с декодированными сущностями, сжатые пробелы */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Все hidden-поля формы: их пересылают в постбэке целиком (включая __CVIEWSTATE) */
export function hiddenInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const tag = m[0];
    const name = tag.match(/name="([^"]*)"/)?.[1];
    if (!name) continue;
    out[decodeEntities(name)] = decodeEntities(tag.match(/value="([^"]*)"/)?.[1] ?? '');
  }
  return out;
}

export interface PostbackLink {
  target: string;
  argument: string;
  text: string;
}

/**
 * Ссылки пейджера (`class="pager"`): числа страниц и `>>` (следующее окно).
 * Кавычки в __doPostBack приходят и как `&#39;`, и как `'`.
 */
export function pagerLinks(html: string): PostbackLink[] {
  const i = html.indexOf('class="pager"');
  if (i < 0) return [];
  const seg = html.slice(i, html.indexOf('</tr>', i) + 6);
  const out: PostbackLink[] = [];
  const re = /__doPostBack\((?:&#39;|')([^'&]+)(?:&#39;|'),(?:&#39;|')([^'&]*)(?:&#39;|')\)[^>]*>([^<]+)</g;
  for (const m of seg.matchAll(re)) {
    out.push({ target: decodeEntities(m[1]!), argument: decodeEntities(m[2]!), text: textOf(m[3]!) });
  }
  return out;
}

/** Строки таблиц как массивы HTML-ячееек (td и th) */
export function tableRows(html: string): string[][] {
  const rows: string[][] = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1]!);
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/**
 * Пары «Подпись: значение» по всем таблицам, в порядке документа. Верстка
 * карточки кладет по одной или ДВЕ пары в строку (4 ячейки), поэтому идем по
 * ячейкам попарно, а подпись узнаем по завершающему двоеточию.
 */
export function labelValuePairs(html: string): { label: string; value: string; valueHtml: string }[] {
  const out: { label: string; value: string; valueHtml: string }[] = [];
  for (const cells of tableRows(html)) {
    for (let i = 0; i + 1 < cells.length; i += 2) {
      const label = textOf(cells[i]!);
      if (!label.endsWith(':')) continue;
      out.push({
        label: label.slice(0, -1).trim(),
        value: textOf(cells[i + 1]!),
        valueHtml: cells[i + 1]!,
      });
    }
  }
  return out;
}

/**
 * Денежная строка «5 609 411,71» -> '5609411.71'. Только строка, никаких float
 * (docs/04). Хвосты вроде «Купить с агентом» отрезаются. null — не распозналось.
 */
export function parseMoney(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = decodeEntities(s).replace(/ /g, ' ').match(/\d[\d ]*(?:[.,]\d+)?/);
  if (!m) return undefined;
  return m[0].replace(/ /g, '').replace(',', '.');
}

/** «25.09.2026 12:00» или «10.07.2026» -> ISO. Пояс площадки — см. itender.ts. */
export function parseRuDate(s: string | undefined, tzSuffix: string): string | undefined {
  if (!s) return undefined;
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\D+(\d{1,2}):(\d{2}))?/);
  if (!m) return undefined;
  const [, d, mo, y, h, mi] = m;
  const hh = (h ?? '0').padStart(2, '0');
  return `${y}-${mo}-${d}T${hh}:${mi ?? '00'}:00${tzSuffix}`;
}
