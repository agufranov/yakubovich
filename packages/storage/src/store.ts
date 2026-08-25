/**
 * Файловое хранилище. Сознательно временное: интерфейс повторяет будущий
 * Postgres-репозиторий, форматы простые и переносимые (NDJSON), объемы наших
 * данных это позволяют (docs/10-economics.md: лоты — маленькие данные).
 *
 * Раскладка:
 *   data/raw/<source>/<YYYY-MM>.ndjson   — сырье, append-only, неизменяемое
 *   data/core/lots.ndjson                — append-лог версий лота, last-wins
 *   data/state/<source>.json             — курсоры и хеши коннектора
 *   data/state/runs.ndjson               — метрики прогонов (наблюдаемость)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CoreLot, RawRecord, RunRecord } from '@bankrot/shared';

export interface SourceState {
  /** хеш записи листинга — чтобы не перекачивать карточку зря */
  listFingerprints: Record<string, string>;
  /** хеш содержимого карточки — чтобы не плодить версии без изменений */
  cardHashes: Record<string, string>;
  /** произвольный курсор коннектора */
  cursor?: unknown;
}

function readNdjson<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const out: T[] = [];
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s) as T);
    } catch {
      // недописанная строка после аварийного обрыва — пропускаем, не падаем
    }
  }
  return out;
}

export class FileStore {
  private lotsCache: { map: Map<string, CoreLot>; mtimeMs: number; size: number } | null = null;

  constructor(readonly rootDir: string) {}

  private dir(...parts: string[]): string {
    const p = path.join(this.rootDir, ...parts);
    mkdirSync(path.dirname(p), { recursive: true });
    return p;
  }

  // ---------- raw ----------

  appendRaw(sourceCode: string, rec: RawRecord): void {
    const month = rec.fetchedAt.slice(0, 7); // YYYY-MM
    const file = this.dir('raw', sourceCode, `${month}.ndjson`);
    appendFileSync(file, JSON.stringify(rec) + '\n', 'utf-8');
  }

  // ---------- state ----------

  loadState(sourceCode: string): SourceState {
    const file = path.join(this.rootDir, 'state', `${sourceCode}.json`);
    if (!existsSync(file)) return { listFingerprints: {}, cardHashes: {} };
    return JSON.parse(readFileSync(file, 'utf-8')) as SourceState;
  }

  saveState(sourceCode: string, state: SourceState): void {
    const file = this.dir('state', `${sourceCode}.json`);
    const tmp = file + '.tmp';
    writeFileSync(tmp, JSON.stringify(state), 'utf-8');
    renameSync(tmp, file); // атомарно: обрыв не оставит битый state
  }

  // ---------- core lots ----------

  private lotsFile(): string {
    return this.dir('core', 'lots.ndjson');
  }

  upsertLot(lot: CoreLot): void {
    appendFileSync(this.lotsFile(), JSON.stringify(lot) + '\n', 'utf-8');
    if (this.lotsCache) this.lotsCache.map.set(lot.id, lot);
  }

  /** Все лоты, последняя версия каждого. Кэш с инвалидацией по mtime файла. */
  loadLots(): CoreLot[] {
    const file = this.lotsFile();
    let mtimeMs = 0;
    let size = 0;
    if (existsSync(file)) {
      const st = statSync(file);
      mtimeMs = st.mtimeMs;
      size = st.size;
    }
    if (!this.lotsCache || this.lotsCache.mtimeMs !== mtimeMs || this.lotsCache.size !== size) {
      const map = new Map<string, CoreLot>();
      for (const lot of readNdjson<CoreLot>(file)) map.set(lot.id, lot); // last-wins
      this.lotsCache = { map, mtimeMs, size };
    }
    return [...this.lotsCache.map.values()];
  }

  getLot(id: string): CoreLot | undefined {
    this.loadLots();
    return this.lotsCache?.map.get(id);
  }

  /** Переписать лог без устаревших версий (звать после больших прогонов) */
  compactLots(): void {
    const lots = this.loadLots();
    const file = this.lotsFile();
    const tmp = file + '.tmp';
    writeFileSync(tmp, lots.map((l) => JSON.stringify(l)).join('\n') + (lots.length ? '\n' : ''), 'utf-8');
    renameSync(tmp, file);
    this.lotsCache = null;
  }

  // ---------- runs (наблюдаемость) ----------

  appendRun(run: RunRecord): void {
    appendFileSync(this.dir('state', 'runs.ndjson'), JSON.stringify(run) + '\n', 'utf-8');
  }

  loadRuns(): RunRecord[] {
    return readNdjson<RunRecord>(path.join(this.rootDir, 'state', 'runs.ndjson'));
  }
}
