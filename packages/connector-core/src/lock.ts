/**
 * Замок от двух параллельных сборов: оба пишут в один lots.ndjson, это гонка
 * на файле. Простейший lock с pid; протухает через 2 часа.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function acquireIngestLock(dataDir: string): () => void {
  const lockFile = path.join(dataDir, 'state', 'ingest.lock');
  mkdirSync(path.dirname(lockFile), { recursive: true });
  if (existsSync(lockFile)) {
    const { pid, at } = JSON.parse(readFileSync(lockFile, 'utf-8')) as { pid: number; at: number };
    if (Date.now() - at < 2 * 3600_000) {
      throw new Error(
        `Уже идет сбор (pid ${pid}, ${new Date(at).toLocaleTimeString()}). ` +
          `Дождитесь конца или удалите ${lockFile}`,
      );
    }
  }
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }));
  return () => rmSync(lockFile, { force: true });
}
