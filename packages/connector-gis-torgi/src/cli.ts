/**
 * CLI сбора: npm run ingest -- --bidd-type=229FZ --pages=30 --limit-cards=200
 *
 * Полная историческая загрузка — это нарезка срезов и часы работы
 * (docs/research/gis-torgi-api.md), поэтому по умолчанию скромные объемы:
 * инкрементальный прогон по свежим публикациям.
 */
import path from 'node:path';
import { HttpClient, findRepoRoot, runIngest } from '@bankrot/connector-core';
import { FileStore } from '@bankrot/storage';
import { gisTorgi } from './gis-torgi';

function arg(name: string, def?: string): string | undefined {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : def;
}

async function main(): Promise<void> {
  const biddType = arg('bidd-type', '229FZ');
  const pages = Number(arg('pages', '30'));
  const limitCards = Number(arg('limit-cards', '250'));
  const stopAfterUnchangedPages = Number(arg('stop-after-unchanged', '5'));

  const root = findRepoRoot();
  const store = new FileStore(path.join(root, 'data'));
  const http = new HttpClient({ minIntervalMs: 600, jitterMs: 300 });

  console.log(`ГИС Торги: biddType=${biddType}, страниц до ${pages}, карточек до ${limitCards}`);
  const run = await runIngest(gisTorgi, store, http, {
    maxPages: pages,
    limitCards,
    stopAfterUnchangedPages,
    params: biddType ? { biddType } : {},
  });

  store.compactLots();
  console.log(`HTTP: запросов ${http.stats.requests}, ретраев ${http.stats.retries}`);
  console.log(`Лотов в базе: ${store.loadLots().length}`);
  if (run.aborted) process.exitCode = 0; // обрыв по лимиту — штатный
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
