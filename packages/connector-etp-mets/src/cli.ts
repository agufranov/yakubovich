/**
 * CLI сбора с МЭТС (m-ets.ru), банкротство 127-ФЗ.
 *
 * Штатный прогон — обход по sitemap (см. mets.ts), разрешен robots.txt:
 *   npm run ingest:mets -- --pages=3 --limit-cards=100
 *
 * Первый полный проход по активным лотам (~15 000 карточек) — долгий;
 * он возобновляемый, состояние пишется каждые 25 карточек:
 *   npm run ingest:mets -- --pages=100 --limit-cards=2000
 *
 * Уборка статусов (карточка снята -> archived):
 *   npm run ingest:mets -- --sweep --limit-cards=200
 *
 * Отдельно — режим обхода поисковой выдачи по категориям. Он дешевле, когда
 * нужны только машины, НО `robots.txt` площадки запрещает `*page=*`:
 *   npm run ingest:mets -- --via-search --categories=1 --pages=10
 * Флаг сознательно длинный и печатает предупреждение: решение — человека.
 */
import path from 'node:path';
import { HttpClient, acquireIngestLock, findRepoRoot, runIngest, runSweep } from '@bankrot/connector-core';
import { FileStore } from '@bankrot/storage';
import { makeMetsConnector, METS_CODE } from './mets';
import { METS_CATEGORIES, VEHICLE_CATEGORIES } from './search';

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

  // МЭТС не жаловалась при зондировании, но правило одно на все чужие сайты
  const http = new HttpClient({
    minIntervalMs: Number(arg('interval', '2000')),
    jitterMs: 1000,
    retries: 3,
  });
  const connector = makeMetsConnector();

  if (flag('sweep')) {
    await runSweep(connector, store, http, {
      limit: Number(arg('limit-cards', '200')),
      staleAfterDays: Number(arg('stale-days', '7')),
    });
  } else {
    const params: Record<string, string> = {};
    if (flag('via-search')) {
      const cats = arg('categories', flag('vehicles') ? VEHICLE_CATEGORIES.join(',') : undefined);
      if (!cats) throw new Error('--via-search требует --categories=1,3 (или --vehicles)');
      console.warn(
        'ВНИМАНИЕ: обход поисковой выдачи постранично не соответствует robots.txt МЭТС\n' +
          '          (Disallow: *page=*). Штатный путь — без этого флага, по sitemap.',
      );
      console.log(`Категории: ${cats.split(',').map((c) => METS_CATEGORIES[c] ?? c).join(', ')}`);
      params.mode = 'search';
      params.categories = cats;
    }
    if (flag('include-completed')) params.includeCompleted = 'true';

    await runIngest(connector, store, http, {
      maxPages: Number(arg('pages', '5')),
      limitCards: Number(arg('limit-cards', '100')),
      stopAfterUnchangedPages: Number(arg('stop-after-unchanged', '3')),
      params,
    });
  }

  console.log(`HTTP: запросов ${http.stats.requests}, ретраев ${http.stats.retries}`);
  store.compactLots();
  const lots = store.loadLots();
  const mine = lots.filter((l) => l.sourceCode === METS_CODE);
  console.log(
    `Лотов в базе: ${lots.length} (МЭТС ${mine.length}, из них транспорт ${mine.filter((l) => l.kind === 'vehicle').length})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
