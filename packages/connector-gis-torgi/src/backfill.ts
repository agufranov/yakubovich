/**
 * Оркестрация полной исторической загрузки: окна pubFrom/pubTo идут назад во
 * времени, каждое окно вычерпывается обычным runIngest. Возобновляемо: курсор
 * (начало последнего завершенного окна) хранится в state источника.
 *
 * Рецепт и проверка фильтров: docs/research/gis-torgi-api.md.
 */
import type { RunRecord } from '@bankrot/shared';
import { HttpClient, runIngest } from '@bankrot/connector-core';
import type { FileStore } from '@bankrot/storage';
import { gisTorgi } from './gis-torgi';

export interface BackfillOptions {
  biddType: string;
  /** до какой даты в прошлое идти (yyyy-MM-dd) */
  from: string;
  /** с какой даты начинать (по умолчанию сегодня) */
  to?: string;
  windowDays?: number;
  /** предохранитель на общий объем карточек за вызов */
  limitCards?: number;
  log?: (msg: string) => void;
}

interface BackfillCursor {
  backfill?: Record<string, string>; // biddType -> начало последнего ПРОЙДЕННОГО окна
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}

export async function runBackfill(
  store: FileStore,
  http: HttpClient,
  opts: BackfillOptions,
): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(`[backfill] ${m}`));
  const windowDays = opts.windowDays ?? 7;
  const today = fmt(new Date());

  // возобновление: если курсор есть — продолжаем от него вглубь
  const state = store.loadState(gisTorgi.code);
  const cursor = (state.cursor ?? {}) as BackfillCursor;
  const resumeFrom = cursor.backfill?.[opts.biddType];
  let windowEnd = resumeFrom ?? opts.to ?? today; // pubTo (не включая прошлые окна)
  if (resumeFrom) log(`возобновление с ${resumeFrom} (курсор в state)`);

  let cardsTotal = 0;
  while (windowEnd > opts.from) {
    const windowStart = addDays(windowEnd, -windowDays) > opts.from
      ? addDays(windowEnd, -windowDays)
      : opts.from;

    log(`окно ${windowStart}..${windowEnd}`);
    const run: RunRecord = await runIngest(gisTorgi, store, http, {
      maxPages: 1000, // граница пагинации источника
      limitCards: opts.limitCards ? opts.limitCards - cardsTotal : undefined,
      params: {
        biddType: opts.biddType,
        pubFrom: windowStart,
        pubTo: windowEnd,
      },
    });
    cardsTotal += run.cardsFetched;

    if (run.aborted?.includes('limitCards')) {
      log(`предохранитель ${opts.limitCards} карточек — стоп, курсор не сдвигаем`);
      return;
    }
    if (run.pagesScanned >= 1000) {
      log(
        `ВНИМАНИЕ: окно ${windowStart}..${windowEnd} уперлось в потолок 10000 — ` +
          `часть лотов не собрана. Уменьшить --window-days или дробить по --region.`,
      );
    }

    // окно пройдено — фиксируем курсор (загружаем свежий state: runIngest его писал)
    const fresh = store.loadState(gisTorgi.code);
    const c = (fresh.cursor ?? {}) as BackfillCursor;
    c.backfill = { ...c.backfill, [opts.biddType]: windowStart };
    fresh.cursor = c;
    store.saveState(gisTorgi.code, fresh);

    windowEnd = windowStart;
  }
  log(`готово до ${opts.from}; карточек за вызов: ${cardsTotal}`);
}
