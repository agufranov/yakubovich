/**
 * Уборка: перепроверка лотов, у которых инкрементальный discover не увидит
 * изменений, потому что они уже уехали из свежих страниц листинга.
 *
 * Кого проверяем:
 *  - активные лоты с прошедшим дедлайном заявок (статус должен был смениться);
 *  - активные лоты, которых давно не видели (lastSeenAt старше N дней).
 *
 * Исход по каждому: обновился (перечитали карточку) / archived (источник отдал
 * 404 — лот стерт, у нас остается; решение №5: архив — главный актив) / без
 * изменений.
 */
import type { CoreLot, RunRecord } from '@bankrot/shared';
import { ACTIVE_STATUSES } from '@bankrot/shared';
import type { FileStore } from '@bankrot/storage';
import type { Connector } from './connector';
import { HttpClient, HttpError } from './http';
import { hashContent } from './runner';

export interface SweepOptions {
  /** максимум карточек за прогон */
  limit?: number;
  /** «давно не видели» = lastSeenAt старше этого, дней */
  staleAfterDays?: number;
  log?: (msg: string) => void;
}

export function pickSweepCandidates(
  lots: CoreLot[],
  sourceCode: string,
  staleAfterDays: number,
  now = Date.now(),
): CoreLot[] {
  const staleBefore = now - staleAfterDays * 86_400_000;
  return lots
    .filter((l) => l.sourceCode === sourceCode)
    .filter((l) => (ACTIVE_STATUSES as string[]).includes(l.status))
    .filter((l) => {
      const deadlinePassed = l.biddEndAt ? Date.parse(l.biddEndAt) < now : false;
      const stale = Date.parse(l.lastSeenAt) < staleBefore;
      return deadlinePassed || stale;
    })
    // сначала самые давно не проверявшиеся
    .sort((a, b) => Date.parse(a.lastSeenAt) - Date.parse(b.lastSeenAt));
}

export async function runSweep(
  connector: Connector,
  store: FileStore,
  http: HttpClient,
  opts: SweepOptions = {},
): Promise<RunRecord> {
  const log = opts.log ?? ((m: string) => console.log(`[${connector.code}:sweep] ${m}`));
  const startedAt = new Date().toISOString();
  const state = store.loadState(connector.code);
  const run: RunRecord = {
    sourceCode: connector.code,
    mode: 'sweep',
    startedAt,
    finishedAt: startedAt,
    pagesScanned: 0,
    itemsSeen: 0,
    itemsNew: 0,
    itemsChanged: 0,
    itemsUnchanged: 0,
    itemsArchived: 0,
    cardsFetched: 0,
    parseErrors: 0,
    httpErrors: 0,
  };

  const candidates = pickSweepCandidates(
    store.loadLots(),
    connector.code,
    opts.staleAfterDays ?? 7,
  ).slice(0, opts.limit ?? 200);
  log(`кандидатов на перепроверку: ${candidates.length}`);

  try {
    for (const lot of candidates) {
      run.itemsSeen++;
      const now = new Date().toISOString();

      let raw: unknown;
      try {
        raw = await connector.fetchCard(http, lot.externalId);
        run.cardsFetched++;
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) {
          // источник стер лот — у нас он остается навсегда
          store.upsertLot({ ...lot, status: 'archived', lastSeenAt: now });
          run.itemsArchived = (run.itemsArchived ?? 0) + 1;
          continue;
        }
        run.httpErrors++;
        log(`карточка ${lot.externalId}: ${(e as Error).message}`);
        if (run.httpErrors >= 15) {
          run.aborted = 'слишком много HTTP-ошибок — источник деградировал';
          break;
        }
        continue;
      }

      const contentHash = hashContent(raw);
      if (state.cardHashes[lot.externalId] === contentHash) {
        // содержимое то же — просто отмечаем, что лот жив
        store.upsertLot({ ...lot, lastSeenAt: now });
        run.itemsUnchanged++;
        continue;
      }

      store.appendRaw(connector.code, {
        externalId: lot.externalId,
        fetchedAt: now,
        contentHash,
        payload: raw,
      });
      try {
        const updated = connector.parse(raw, { now, prev: lot, contentHash });
        store.upsertLot(updated);
        run.itemsChanged++;
      } catch (e) {
        run.parseErrors++;
        log(`parse ${lot.externalId}: ${(e as Error).message}`);
      }
      state.cardHashes[lot.externalId] = contentHash;
    }
  } finally {
    store.saveState(connector.code, state);
    run.finishedAt = new Date().toISOString();
    store.appendRun(run);
  }

  log(
    `готово: проверено ${run.itemsSeen}, обновилось ${run.itemsChanged}, ` +
      `в архив ${run.itemsArchived ?? 0}, живы без изменений ${run.itemsUnchanged}, ` +
      `ошибок ${run.httpErrors}/${run.parseErrors}`,
  );
  return run;
}
