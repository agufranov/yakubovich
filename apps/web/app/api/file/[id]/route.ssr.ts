/**
 * Прокси файлов ГИС Торги с кэшем на диске.
 * Зачем: (1) браузер пользователя может не доверять сертификату Минцифры,
 * (2) не дергаем источник повторно за тем же файлом (docs/10: кэшируем только
 * то, что реально открывают).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HttpClient, findRepoRoot } from '@bankrot/connector-core';
import { gisTorgiFileUrl } from '@bankrot/connector-gis-torgi';

// отдельный клиент под файлы: мягкий лимит, чтобы галерея не ждала вечность
const fileClient = new HttpClient({ minIntervalMs: 150, jitterMs: 100, retries: 2 });

const ID_RE = /^[0-9a-f]{24}$/;

function sniffContentType(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length >= 12 && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.length >= 4 && buf.slice(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
  return 'application/octet-stream';
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return new Response('bad id', { status: 400 });

  const cacheDir = path.join(findRepoRoot(), 'data', 'cache', 'files');
  mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, id);

  let body: Buffer;
  if (existsSync(cachePath)) {
    body = readFileSync(cachePath);
  } else {
    try {
      const res = await fileClient.get(gisTorgiFileUrl(id));
      body = res.body;
    } catch {
      return new Response('upstream error', { status: 502 });
    }
    const tmp = cachePath + `.tmp-${process.pid}`;
    writeFileSync(tmp, body);
    try {
      renameSync(tmp, cachePath);
    } catch {
      /* параллельная запись того же файла — не страшно */
    }
  }

  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': sniffContentType(body),
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
