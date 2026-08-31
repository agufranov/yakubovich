/**
 * Разбор верстки МЭТС. Верстка машинная и однородная: вся карточка собрана
 * из блоков
 *
 *   <div class="lot-info-item"><div class="title">Подпись</div>
 *                              <div class="value">Значение</div></div>
 *
 * а блок без `value` — это заголовок раздела («Сведения о должнике»,
 * «Финансовый управляющий»). Разделы обязательны для разбора: подписи ФИО и
 * ИНН повторяются у должника и у управляющего, и различить их можно только по
 * тому, под каким заголовком они стоят.
 *
 * Значения бывают вложенными (график снижения цены — целая таблица внутри
 * `value`), поэтому границы блоков ищем счетчиком `<div>`, а не регуляркой.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»',
  mdash: '—', ndash: '–', rsquo: '’', deg: '°',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/** Текст узла: без тегов, с декодированными сущностями, сжатые пробелы */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Внутренность `<div>`, открывающегося в позиции `openAt`, с учетом вложенности.
 * Возвращает и позицию за закрывающим тегом — по ней идет обход дальше.
 */
export function divInner(html: string, openAt: number): { inner: string; end: number } {
  const tagEnd = html.indexOf('>', openAt);
  if (tagEnd < 0) return { inner: '', end: html.length };
  const innerStart = tagEnd + 1;
  const re = /<\/?div\b/gi;
  re.lastIndex = innerStart;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0]!.toLowerCase() === '<div' ? 1 : -1;
    if (depth === 0) {
      const close = html.indexOf('>', m.index);
      return { inner: html.slice(innerStart, m.index), end: close < 0 ? html.length : close + 1 };
    }
  }
  return { inner: html.slice(innerStart), end: html.length };
}

/** Первый дочерний `<div class="...cls...">` — только на верхнем уровне блока */
function childDiv(html: string, cls: string): string | undefined {
  const re = new RegExp(`<div[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>`, 'gi');
  const m = re.exec(html);
  if (!m) return undefined;
  return divInner(html, m.index).inner;
}

export interface InfoItem {
  /** заголовок раздела, под которым стоит поле («Сведения о должнике») */
  section: string;
  label: string;
  value: string;
  valueHtml: string;
}

/**
 * Все поля карточки в порядке документа, с разделом каждого.
 * Блоки без `value` не возвращаются — они меняют текущий раздел.
 */
export function infoItems(html: string): InfoItem[] {
  const out: InfoItem[] = [];
  let section = '';
  const re = /<div[^>]*class="[^"]*\blot-info-item\b[^"]*"[^>]*>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const { inner, end } = divInner(html, m.index);
    re.lastIndex = end; // вложенные lot-info-item внутрь не попадают
    const title = childDiv(inner, 'title');
    if (title === undefined) continue;
    const valueHtml = childDiv(inner, 'value');
    const label = textOf(title);
    if (valueHtml === undefined) {
      if (label) section = label;
      continue;
    }
    out.push({ section, label, value: textOf(valueHtml), valueHtml });
  }
  return out;
}

/** Строки таблицы как массивы HTML-ячеек */
export function tableRows(html: string): string[][] {
  const rows: string[][] = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => c[1]!);
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/**
 * Денежная строка -> строка-число: «1 090 827 руб. НДС не облагается» ->
 * '1090827'. Только строки, никаких float (решение №3). Разделитель тысяч —
 * обычный или неразрывный пробел.
 */
export function parseMoney(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = decodeEntities(s).replace(/ /g, ' ').match(/\d[\d ]*(?:[.,]\d+)?/);
  if (!m) return undefined;
  const num = m[0].replace(/ /g, '').replace(',', '.');
  return num === '' ? undefined : num;
}

/** «01.09.2026 10:00» / «24.07.2025» -> ISO с поясом площадки */
export function parseRuDate(s: string | undefined, tzSuffix: string): string | undefined {
  if (!s) return undefined;
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\D+(\d{1,2}):(\d{2}))?/);
  if (!m) return undefined;
  const [, d, mo, y, h, mi] = m;
  return `${y}-${mo}-${d}T${(h ?? '0').padStart(2, '0')}:${mi ?? '00'}:00${tzSuffix}`;
}

/** ИНН из подсказки `title="ИНН: 7714056040"` или из готового значения */
export function extractInn(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = decodeEntities(s).match(/\b(\d{10}|\d{12})\b/);
  return m?.[1];
}
