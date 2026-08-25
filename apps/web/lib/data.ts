/**
 * Доступ к данным для веба. Один FileStore на процесс; loadLots() внутри кэширует
 * по mtime файла, так что каждый запрос страницы не перечитывает базу с диска.
 */
import path from 'node:path';
import { FileStore } from '@bankrot/storage';
import { findRepoRoot } from '@bankrot/connector-core';

let store: FileStore | null = null;

export function getStore(): FileStore {
  if (!store) {
    const dataDir = process.env.DATA_DIR ?? path.join(findRepoRoot(), 'data');
    store = new FileStore(dataDir);
  }
  return store;
}
