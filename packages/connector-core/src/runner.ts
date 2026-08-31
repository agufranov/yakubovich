/**
 * Раннер: discover -> (изменилось?) -> fetch -> raw -> parse -> core.
 * Считает метрики прогона — основа наблюдаемости (docs/03: коннектор ломается
 * молча, алертим на аномалию объема, а не на исключения).
 */
import { createHash } from 'node:crypto';
import type { RunRecord } from '@bankrot/shared';
import type { FileStore } from '@bankrot/storage';
import type { Connector, DiscoverOptions } from './connector';
import { HttpClient } from './http';

export interface IngestOptions extends DiscoverOptions {
  /** максимум карточек за прогон (защита от бесконечного первого прогона) */
  limitCards?: number;
  /** остановиться после N подряд полностью не изменившихся страниц листинга */
  stopAfterUnchangedPages?: number;
  log?: (msg: string) => void;
}

export function hashContent(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function runIngest(
  connector: Connector,
  store: FileStore,
  http: HttpClient,
  opts: IngestOptions = {},
): Promise<RunRecord> {
  const log = opts.log ?? ((m: string) => console.log(`[${connector.code}] ${m}`));
  const startedAt = new Date().toISOString();
  const state = store.loadState(connector.code);
  const run: RunRecord = {
    sourceCode: connector.code,
    startedAt,
    finishedAt: startedAt,
    pagesScanned: 0,
    itemsSeen: 0,
    itemsNew: 0,
    itemsChanged: 0,
    itemsUnchanged: 0,
    cardsFetched: 0,
    parseErrors: 0,
    httpErrors: 0,
  };

  let unchangedPagesStreak = 0;
  try {
    outer: for await (const page of connector.discover(http, opts)) {
      run.pagesScanned++;
      let pageChanged = false;

      for (const item of page) {
        run.itemsSeen++;
        const prevFp = state.listFingerprints[item.externalId];
        if (prevFp === item.fingerprint) {
          run.itemsUnchanged++;
          continue;
        }
        pageChanged = true;

        if (opts.limitCards && run.cardsFetched >= opts.limitCards) {
          run.aborted = `достигнут limitCards=${opts.limitCards}`;
          break outer;
        }

        // карточка
        let raw: unknown;
        try {
          raw = await connector.fetchCard(http, item.externalId);
          run.cardsFetched++;
        } catch (e) {
          run.httpErrors++;
          log(`карточка ${item.externalId}: ${(e as Error).message}`);
          if (run.httpErrors >= 15) {
            run.aborted = 'слишком много HTTP-ошибок подряд — источник деградировал';
            break outer;
          }
          continue;
        }

        const contentHash = hashContent(raw);
        const isNew = !(item.externalId in state.cardHashes);
        if (state.cardHashes[item.externalId] === contentHash) {
          // листинг дернулся, а карточка та же — фиксируем и идем дальше
          state.listFingerprints[item.externalId] = item.fingerprint;
          run.itemsUnchanged++;
          continue;
        }

        // raw — неизменяемый слой, пишем ДО парсинга: упавший parse не теряет данные
        store.appendRaw(connector.code, {
          externalId: item.externalId,
          fetchedAt: new Date().toISOString(),
          contentHash,
          payload: raw,
        });

        try {
          const prev = store.getLot(`${connector.code}:${item.externalId}`);
          const lot = connector.parse(raw, { now: new Date().toISOString(), prev, contentHash });
          store.upsertLot(lot);
        } catch (e) {
          run.parseErrors++;
          log(`parse ${item.externalId}: ${(e as Error).message}`);
        }

        state.cardHashes[item.externalId] = contentHash;
        state.listFingerprints[item.externalId] = item.fingerprint;
        if (isNew) run.itemsNew++;
        else run.itemsChanged++;

        if (run.cardsFetched % 25 === 0) {
          store.saveState(connector.code, state); // прогон возобновляем с места обрыва
          log(`карточек: ${run.cardsFetched} (новых ${run.itemsNew}, изменившихся ${run.itemsChanged})`);
        }
      }

      unchangedPagesStreak = pageChanged ? 0 : unchangedPagesStreak + 1;
      if (opts.stopAfterUnchangedPages && unchangedPagesStreak >= opts.stopAfterUnchangedPages) {
        log(`${unchangedPagesStreak} страниц подряд без изменений — дальше только старое, стоп`);
        break;
      }
    }
  } finally {
    store.saveState(connector.code, state);
    run.finishedAt = new Date().toISOString();
    store.appendRun(run);
  }

  log(
    `готово: страниц ${run.pagesScanned}, увидено ${run.itemsSeen}, ` +
      `новых ${run.itemsNew}, изменившихся ${run.itemsChanged}, без изменений ${run.itemsUnchanged}, ` +
      `ошибок http/parse ${run.httpErrors}/${run.parseErrors}` +
      (run.aborted ? ` — ОБОРВАН: ${run.aborted}` : ''),
  );
  warnIfRawUncompressed(store, log);
  return run;
}

/** Порог, после которого несжатое сырье перестает быть мелочью */
const RAW_WARN_BYTES = 1024 ** 3;

/**
 * Напоминание о сжатии raw. Оно живет здесь, а не в заметке в документации,
 * ровно потому, что заметку никто не открывает: предупреждение печатается в
 * конце каждого прогона тому, кто прогон и запустил.
 *
 * Сжимать raw надо один раз, и чем позже — тем больше перечитывать. Замер на
 * МЭТС: карточка 191 КБ, gzip 4x. См. PROGRESS.md.
 */
export function warnIfRawUncompressed(store: FileStore, log: (msg: string) => void): void {
  const bytes = store.rawSizeBytes();
  if (bytes < RAW_WARN_BYTES || store.rawIsCompressed()) return;
  const gb = (bytes / 1024 ** 3).toFixed(1);
  log(
    `
⚠  СЫРЬЕ НЕ СЖАТО: data/raw занимает ${gb} ГБ.
` +
      `   gzip дает примерно 4x (замерено на карточках МЭТС) — это ${(bytes / 1024 ** 3 / 4).toFixed(1)} ГБ вместо ${gb}.
` +
      `   Сжатие делается один раз и тем дороже, чем дольше тянуть. См. PROGRESS.md.
`,
  );
}
