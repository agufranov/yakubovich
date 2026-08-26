/**
 * CLI сбора ГИС Торги.
 *
 * Инкрементальный прогон (свежие публикации):
 *   npm run ingest -- --bidd-type=229FZ --pages=30 --limit-cards=250
 *
 * Срез для исторической загрузки (все фильтры проверены зондом,
 * docs/research/gis-torgi-api.md):
 *   npm run ingest -- --bidd-type=229FZ --pub-from=2026-08-01 --pub-to=2026-08-07 --pages=1000
 *   npm run ingest -- --bidd-type=178FZ --region=77
 *
 * Историческая загрузка (окна дат назад во времени, возобновляемая):
 *   npm run ingest -- --backfill --bidd-type=229FZ --from=2026-01-01 --limit-cards=2000
 *
 * Уборка (перепроверка активных лотов с прошедшим дедлайном, архивация стертых):
 *   npm run ingest -- --sweep --limit-cards=200
 */
import path from 'node:path';
import { HttpClient, acquireIngestLock, findRepoRoot, runIngest, runSweep } from '@bankrot/connector-core';
import { FileStore } from '@bankrot/storage';
import { runBackfill } from './backfill';
import { gisTorgi } from './gis-torgi';

function arg(name: string, def?: string): string | undefined {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : def;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const root = findRepoRoot();
  const store = new FileStore(path.join(root, 'data'));
  const releaseLock = acquireIngestLock(path.join(root, 'data'));
  process.on('exit', releaseLock);
  const http = new HttpClient({
    minIntervalMs: Number(arg('interval', '800')),
    jitterMs: 400,
  });

  if (flag('sweep')) {
    await runSweep(gisTorgi, store, http, {
      limit: Number(arg('limit-cards', '200')),
      staleAfterDays: Number(arg('stale-days', '7')),
    });
  } else if (flag('backfill')) {
    // историческая загрузка: окна дат назад во времени, возобновляемо
    const from = arg('from');
    if (!from) throw new Error('--backfill требует --from=yyyy-MM-dd (до какой даты идти в прошлое)');
    await runBackfill(store, http, {
      biddType: arg('bidd-type', '229FZ')!,
      from,
      to: arg('to'),
      windowDays: Number(arg('window-days', '7')),
      limitCards: arg('limit-cards') ? Number(arg('limit-cards')) : undefined,
    });
  } else {
    // срез: собираем только явно переданные параметры
    const params: Record<string, string> = {};
    const biddType = arg('bidd-type', '229FZ');
    if (biddType) params.biddType = biddType;
    for (const [cliName, apiName] of [
      ['pub-from', 'pubFrom'],
      ['pub-to', 'pubTo'],
      ['region', 'dynSubjRF'],
      ['cat', 'catCode'],
    ] as const) {
      const v = arg(cliName);
      if (v) params[apiName] = v;
    }

    console.log(`ГИС Торги: срез ${JSON.stringify(params)}`);
    await runIngest(gisTorgi, store, http, {
      maxPages: Number(arg('pages', '30')),
      limitCards: Number(arg('limit-cards', '250')),
      stopAfterUnchangedPages: Number(arg('stop-after-unchanged', '5')),
      params,
    });
  }

  store.compactLots();
  console.log(`HTTP: запросов ${http.stats.requests}, ретраев ${http.stats.retries}`);
  console.log(`Лотов в базе: ${store.loadLots().length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
