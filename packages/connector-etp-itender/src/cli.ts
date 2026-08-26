/**
 * CLI сбора с площадок семейства iTender (банкротство, 127-ФЗ).
 *
 * Одна площадка:
 *   npm run ingest:etp -- --platform=centerr --pages=3 --limit-cards=40
 *
 * Все площадки по очереди (кроме пустых при зондировании; их — через --platform):
 *   npm run ingest:etp -- --all --pages=2 --limit-cards=30
 *
 * Разделы листинга (по умолчанию аукционы + публичные предложения):
 *   npm run ingest:etp -- --platform=utender --sections=public-offers-all
 *
 * ЭТП троттлят и падают (грабли) — интервал по умолчанию щадящий, 3 секунды.
 */
import path from 'node:path';
import { HttpClient, acquireIngestLock, findRepoRoot, runIngest } from '@bankrot/connector-core';
import { FileStore } from '@bankrot/storage';
import { makeItenderConnector } from './itender';
import { ITENDER_PLATFORMS, platformByCode } from './platforms';

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

  const platforms = flag('all')
    ? ITENDER_PLATFORMS.filter((p) => !p.emptyAtProbe)
    : [arg('platform', 'centerr')!].map((code) => {
        const p = platformByCode(code);
        if (!p) {
          throw new Error(
            `Неизвестная площадка «${code}». Есть: ${ITENDER_PLATFORMS.map((x) => x.code).join(', ')}`,
          );
        }
        return p;
      });

  const params: Record<string, string> = {};
  const sections = arg('sections');
  if (sections) params.sections = sections;

  for (const platform of platforms) {
    // клиент на площадку: свой rate-limit и своя сессия (куки WebForms)
    const http = new HttpClient({
      minIntervalMs: Number(arg('interval', '3000')),
      jitterMs: 1500,
      retries: 3,
    });
    console.log(`\n=== ${platform.name} (${platform.baseUrl}) ===`);
    try {
      await runIngest(makeItenderConnector(platform), store, http, {
        maxPages: Number(arg('pages', '5')),
        limitCards: Number(arg('limit-cards', '60')),
        stopAfterUnchangedPages: Number(arg('stop-after-unchanged', '3')),
        params,
      });
    } catch (e) {
      // недоступность одной площадки — штатная ситуация (грабли), не роняем обход
      console.error(`[itender-${platform.code}] прогон упал: ${(e as Error).message}`);
    }
    console.log(`HTTP: запросов ${http.stats.requests}, ретраев ${http.stats.retries}`);
  }

  store.compactLots();
  console.log(`\nЛотов в базе: ${store.loadLots().length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
