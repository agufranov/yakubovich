/**
 * Выкладка сайта на GitHub Pages.
 *
 * Что происходит:
 *   1. Next собирается в статику (STATIC_EXPORT=1, см. apps/web/next.config.mjs):
 *      карточки всех лотов рендерятся заранее, серверных роутов не остается.
 *   2. База выгружается одним файлом в out/data/lots.json — каталог качает его
 *      в браузере и фильтрует на месте тем же queryLots, что и сервер.
 *   3. out/ публикуется коммитом в ветку gh-pages через отдельный worktree,
 *      рабочая копия при этом не трогается.
 *
 * Запуск:
 *   npm run deploy                  собрать и запушить в gh-pages
 *   npm run deploy -- --build-only  только собрать (посмотреть apps/web/out)
 *   npm run deploy -- --no-push     собрать и закоммитить, но не пушить
 *   npm run deploy -- --base-path=/repo   если remote не настроен
 *   npm run deploy -- --cname=lotarhiv.ru своим доменом (тогда base-path пустой)
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { findRepoRoot } from '@bankrot/connector-core';
import { FileStore } from '@bankrot/storage';
import { buildDump } from '../../apps/web/lib/dump';

const ROOT = findRepoRoot();
const WEB_DIR = path.join(ROOT, 'apps', 'web');
const OUT_DIR = path.join(WEB_DIR, 'out');

// ---------- аргументы ----------

const args = process.argv.slice(2);
function flag(name: string): boolean {
  return args.includes(`--${name}`);
}
function opt(name: string): string | undefined {
  const pref = `--${name}=`;
  return args.find((a) => a.startsWith(pref))?.slice(pref.length);
}

const BRANCH = opt('branch') ?? 'gh-pages';
const REMOTE = opt('remote') ?? 'origin';
const CNAME = opt('cname');
const BUILD_ONLY = flag('build-only');
const NO_PUSH = flag('no-push');

// ---------- git ----------

function git(cwdOrArgs: string | string[], maybeArgs?: string[]): string {
  const cwd = typeof cwdOrArgs === 'string' ? cwdOrArgs : ROOT;
  const argv = typeof cwdOrArgs === 'string' ? maybeArgs! : cwdOrArgs;
  const r = spawnSync('git', argv, { cwd, encoding: 'utf-8' });
  if (r.status !== 0) {
    throw new Error(`git ${argv.join(' ')} → ${r.status}\n${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

function gitTry(cwd: string, argv: string[]): boolean {
  return spawnSync('git', argv, { cwd, stdio: 'ignore' }).status === 0;
}

interface RepoRef {
  owner: string;
  name: string;
}

/** owner/repo из URL remote — и https, и ssh */
function parseRemote(url: string): RepoRef | null {
  const m = url.match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1]!, name: m[2]! } : null;
}

function remoteUrl(): string | null {
  const r = spawnSync('git', ['remote', 'get-url', REMOTE], { cwd: ROOT, encoding: 'utf-8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * basePath для project page — это `/<repo>`: сайт живет по адресу
 * <owner>.github.io/<repo>. Для user page (<owner>.github.io) и своего домена
 * basePath пустой, иначе все ссылки уедут на уровень вниз.
 */
function resolveBasePath(repo: RepoRef | null): string {
  const explicit = opt('base-path');
  if (explicit != null) return explicit === '' || explicit === '/' ? '' : normalizeBase(explicit);
  if (CNAME) return '';
  if (!repo) {
    throw new Error(
      `Не найден remote «${REMOTE}», и не задан --base-path.\n` +
        'Добавьте remote (git remote add origin …) или укажите --base-path=/<repo>.',
    );
  }
  if (repo.name.toLowerCase() === `${repo.owner.toLowerCase()}.github.io`) return '';
  return `/${repo.name}`;
}

function normalizeBase(p: string): string {
  const s = p.startsWith('/') ? p : `/${p}`;
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

// ---------- сборка ----------

function buildStatic(basePath: string): void {
  const require = createRequire(import.meta.url);
  let nextBin: string;
  try {
    nextBin = require.resolve('next/dist/bin/next');
  } catch {
    throw new Error('Не найден пакет next — запустите npm install');
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  const r = spawnSync(process.execPath, [nextBin, 'build'], {
    cwd: WEB_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      STATIC_EXPORT: '1',
      NEXT_PUBLIC_STATIC: '1',
      NEXT_PUBLIC_BASE_PATH: basePath,
    },
  });
  if (r.status !== 0) throw new Error('next build завершился с ошибкой');
  if (!existsSync(path.join(OUT_DIR, 'index.html'))) {
    throw new Error(`Сборка не создала ${OUT_DIR}/index.html`);
  }
}

/** Тот самый статический дамп базы, который отдает GitHub Pages */
function writeDump(): { count: number; bytes: number } {
  const dataDir = process.env.DATA_DIR ?? path.join(ROOT, 'data');
  const lots = new FileStore(dataDir).loadLots();
  if (lots.length === 0) {
    throw new Error(
      `В ${dataDir} нет лотов — выкладывать нечего. Сначала соберите данные: npm run ingest`,
    );
  }
  const json = JSON.stringify(buildDump(lots));
  const file = path.join(OUT_DIR, 'data', 'lots.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, json, 'utf-8');
  return { count: lots.length, bytes: Buffer.byteLength(json) };
}

function writeExtras(): void {
  // без .nojekyll GitHub Pages прячет папки на подчерке — а там весь _next
  writeFileSync(path.join(OUT_DIR, '.nojekyll'), '', 'utf-8');
  if (CNAME) writeFileSync(path.join(OUT_DIR, 'CNAME'), `${CNAME}\n`, 'utf-8');
}

// ---------- публикация ----------

function publish(): void {
  const wt = path.join(os.tmpdir(), `gh-pages-${path.basename(ROOT)}`);
  rmSync(wt, { recursive: true, force: true });
  git(['worktree', 'prune']);

  const hasLocal = gitTry(ROOT, ['rev-parse', '--verify', `refs/heads/${BRANCH}`]);
  const hasRemote = gitTry(ROOT, ['rev-parse', '--verify', `refs/remotes/${REMOTE}/${BRANCH}`]);
  if (hasLocal) git(['worktree', 'add', wt, BRANCH]);
  else if (hasRemote) git(['worktree', 'add', '-b', BRANCH, wt, `${REMOTE}/${BRANCH}`]);
  // сайт — не история кода: отдельная ветка-сирота, без общих коммитов с master
  else git(['worktree', 'add', '--orphan', '-b', BRANCH, wt]);

  try {
    for (const entry of readdirSync(wt)) {
      if (entry !== '.git') rmSync(path.join(wt, entry), { recursive: true, force: true });
    }
    cpSync(OUT_DIR, wt, { recursive: true });

    git(wt, ['add', '-A']);
    const dirty = git(wt, ['status', '--porcelain']);
    if (!dirty) {
      console.log('Изменений нет — коммит не нужен.');
      return;
    }
    const source = gitTry(ROOT, ['rev-parse', 'HEAD'])
      ? git(['rev-parse', '--short', 'HEAD'])
      : 'unknown';
    const msg = opt('message') ?? `Выкладка сайта (${new Date().toISOString()}, код ${source})`;
    git(wt, ['commit', '-m', msg]);

    if (NO_PUSH) {
      console.log(`Коммит в ${BRANCH} готов, пуш пропущен (--no-push).`);
      return;
    }
    console.log(`Пуш в ${REMOTE}/${BRANCH}…`);
    git(wt, ['push', REMOTE, `HEAD:refs/heads/${BRANCH}`]);
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, stdio: 'ignore' });
    rmSync(wt, { recursive: true, force: true });
  }
}

// ---------- main ----------

function main(): void {
  const url = remoteUrl();
  const repo = url ? parseRemote(url) : null;
  const basePath = resolveBasePath(repo);

  console.log(`Сборка статики${basePath ? ` с basePath ${basePath}` : ''}…`);
  buildStatic(basePath);

  const dump = writeDump();
  writeExtras();
  console.log(
    `Дамп базы: ${dump.count} лотов, ${(dump.bytes / 1048576).toFixed(1)} МБ → out/data/lots.json`,
  );

  if (BUILD_ONLY) {
    console.log(`Готово: ${OUT_DIR}`);
    console.log('Проверить локально: npx serve apps/web/out');
    return;
  }

  publish();

  const site = CNAME
    ? `https://${CNAME}/`
    : repo
      ? `https://${repo.owner}.github.io${basePath ? `${basePath}/` : '/'}`
      : '(адрес зависит от настроек репозитория)';
  console.log(`\nГотово. Сайт: ${site}`);
  console.log(
    `Если открывается 404 — в Settings → Pages репозитория выберите Source: Deploy from a branch, ветка ${BRANCH}, папка /(root).`,
  );
}

main();
