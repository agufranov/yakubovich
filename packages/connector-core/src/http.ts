/**
 * HTTP-клиент для чужих API. Весь опыт из docs/research/grabli.md зашит здесь:
 *  - TLS с сертификатами Минцифры (НЕ отключаем проверку);
 *  - rate-limit: чужие источники троттлят уже на сотнях запросов;
 *  - ретраи с экспоненциальной паузой на 429/503/сетевых обрывах, Retry-After;
 *  - «чужой API врет молча»: проверяем то, что вернулось, а не что запросили —
 *    HTML вместо JSON, 200 с пустым телом и т.п. дают типизированные ошибки.
 */
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_UA =
  'Mozilla/5.0 (compatible; LotArchiveBot/0.1; +mailto:al.gufranov@gmail.com)';

/** Ищем корень репозитория (там лежат certs/ и data/) от любого cwd */
export function findRepoRoot(startFrom?: string): string {
  let dir = startFrom ?? path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, 'certs')) && existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // фолбэк: от текущей директории процесса
  dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, 'certs'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Не найден корень репозитория (директория certs/)');
}

let cachedCa: string[] | null = null;
/**
 * Российские корневые сертификаты. Грабля: у gu-st.ru под известной ссылкой
 * лежит СТАРЫЙ Sub CA; для torgi.gov.ru нужен Sub CA 2024. В бандле — корень и
 * оба промежуточных.
 *
 * Отдаем ВМЕСТЕ с системными корнями: поле `ca` в Node ЗАМЕНЯЕТ хранилище
 * доверия, а не дополняет его. Голый бандл Минцифры ломал бы TLS ко всем ЭТП
 * с обычными сертификатами (Let's Encrypt и родня).
 */
export function russianCaBundle(): string[] {
  if (cachedCa) return cachedCa;
  const p = path.join(findRepoRoot(), 'certs', 'russian_trusted_bundle.pem');
  const pem = readFileSync(p, 'utf-8');
  const certs = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  cachedCa = [...tls.rootCertificates, ...certs];
  return cachedCa;
}

export class HttpError extends Error {
  constructor(public status: number, public url: string, public bodySnippet: string) {
    super(`HTTP ${status} for ${url}`);
  }
}
export class EmptyBodyError extends Error {
  constructor(public url: string) {
    super(`200 OK с пустым телом: ${url}`);
  }
}
export class NotJsonError extends Error {
  constructor(public url: string, public contentType: string, public bodySnippet: string) {
    super(`Не-JSON ответ (${contentType || 'без content-type'}): ${url}`);
  }
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export interface ClientOptions {
  /** минимальный интервал между запросами, мс */
  minIntervalMs?: number;
  /** случайная добавка к интервалу, мс */
  jitterMs?: number;
  retries?: number;
  timeoutMs?: number;
  userAgent?: string;
  useRussianCa?: boolean;
}

export class HttpClient {
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();
  /** Куки по хостам. WebForms без сессионной куки теряет состояние постбэков. */
  private cookies = new Map<string, Map<string, string>>();
  readonly stats = { requests: 0, retries: 0, errors: 0 };

  constructor(private opts: ClientOptions = {}) {}

  /** GET c rate-limit и ретраями. Отдает сырые байты. */
  async get(url: string, headers: Record<string, string> = {}): Promise<HttpResponse> {
    // сериализуем запросы: один клиент — одна очередь к источнику
    const run = this.queue.then(() => this.requestWithRetries('GET', url, headers));
    this.queue = run.catch(() => undefined); // ошибка одного запроса не рвет очередь
    return run;
  }

  /**
   * POST формы (application/x-www-form-urlencoded) — постбэки ASP.NET WebForms
   * у ЭТП семейства iTender. Ретраи те же, что у GET: постбэк листинга читает,
   * а не меняет, повторить его безопасно.
   */
  async post(
    url: string,
    form: Record<string, string>,
    headers: Record<string, string> = {},
  ): Promise<HttpResponse> {
    const body = new URLSearchParams(form).toString();
    const run = this.queue.then(() =>
      this.requestWithRetries(
        'POST',
        url,
        { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
        body,
      ),
    );
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** GET, от которого ждем JSON. Проверяет то, что ВЕРНУЛОСЬ. */
  async getJson<T = unknown>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.get(url, { Accept: 'application/json', ...headers });
    const text = res.body.toString('utf-8');
    if (text.trim() === '') throw new EmptyBodyError(url);
    const looksJson = text.trimStart().startsWith('{') || text.trimStart().startsWith('[');
    if (!looksJson) {
      throw new NotJsonError(url, String(res.headers['content-type'] ?? ''), text.slice(0, 200));
    }
    return JSON.parse(text) as T;
  }

  private async requestWithRetries(
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<HttpResponse> {
    const retries = this.opts.retries ?? 4;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await this.throttle();
      try {
        this.stats.requests++;
        const res = await this.rawRequest(method, url, headers, body);
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers['retry-after']) || 0;
          const backoff = Math.max(retryAfter * 1000, 2000 * 2 ** attempt);
          lastErr = new HttpError(res.status, url, res.body.toString('utf-8').slice(0, 200));
          this.stats.retries++;
          await sleep(backoff);
          continue;
        }
        if (res.status >= 400) {
          throw new HttpError(res.status, url, res.body.toString('utf-8').slice(0, 200));
        }
        return res;
      } catch (e) {
        if (e instanceof HttpError) throw e; // 4xx не ретраим
        // сетевой обрыв (ECONNRESET и родня) — транзиентен, ретраим
        lastErr = e;
        this.stats.retries++;
        await sleep(1500 * 2 ** attempt);
      }
    }
    this.stats.errors++;
    throw lastErr;
  }

  private async throttle(): Promise<void> {
    const min = this.opts.minIntervalMs ?? 600;
    const jitter = Math.random() * (this.opts.jitterMs ?? 300);
    const wait = this.lastRequestAt + min + jitter - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  // ---------- куки (минимум для сессий: имя=значение по хосту) ----------

  private cookieHeader(host: string): string | undefined {
    const jar = this.cookies.get(host);
    if (!jar || jar.size === 0) return undefined;
    return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private storeCookies(host: string, setCookie: string | string[] | undefined): void {
    if (!setCookie) return;
    const jar = this.cookies.get(host) ?? new Map<string, string>();
    for (const line of Array.isArray(setCookie) ? setCookie : [setCookie]) {
      const pair = line.split(';', 1)[0] ?? '';
      const eq = pair.indexOf('=');
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    this.cookies.set(host, jar);
  }

  private async rawRequest(
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>,
    body?: string,
    redirectsLeft = 5,
  ): Promise<HttpResponse> {
    const u = new URL(url);
    const res = await this.rawOnce(method, u, headers, body);
    this.storeCookies(u.host, res.headers['set-cookie']);

    // редиректы: у WebForms POST часто отвечает 302, http-площадки шлют на https
    const loc = res.headers['location'];
    if (res.status >= 300 && res.status < 400 && typeof loc === 'string' && redirectsLeft > 0) {
      const next = new URL(loc, u).toString();
      // после 301/302/303 браузеры повторяют GET без тела — делаем так же
      return this.rawRequest('GET', next, headers, undefined, redirectsLeft - 1);
    }
    return res;
  }

  private rawOnce(
    method: 'GET' | 'POST',
    u: URL,
    headers: Record<string, string>,
    body?: string,
  ): Promise<HttpResponse> {
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const cookie = this.cookieHeader(u.host);
    const options: https.RequestOptions = {
      method,
      headers: {
        'User-Agent': this.opts.userAgent ?? DEFAULT_UA,
        'Accept-Language': 'ru-RU,ru;q=0.9',
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
        ...(body != null ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
      timeout: this.opts.timeoutMs ?? 40_000,
    };
    if (isHttps && (this.opts.useRussianCa ?? true)) options.ca = russianCaBundle();
    return new Promise((resolve, reject) => {
      const req = lib.request(u, options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error(`timeout: ${u}`)));
      req.on('error', reject);
      if (body != null) req.write(body);
      req.end();
    });
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
