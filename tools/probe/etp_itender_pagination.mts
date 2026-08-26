/**
 * Живой зонд механики iTender для написания коннектора:
 *   1) страница листинга: поля состояния WebForms + строки лотов;
 *   2) постбэк на страницу 2 — проверка, что состав лотов сменился;
 *   3) карточка лота: доступна ли по GET, что в таблице полей.
 *
 * Сохраняет HTML в фикстуры коннектора (усечение до нужных блоков — потом).
 * Запросов мало (4-5), клиент боевой: rate-limit, честный UA, TLS проверяется.
 *
 * Запуск: npx tsx tools/probe/etp_itender_pagination.mts [https://площадка/]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HttpClient, findRepoRoot } from '../../packages/connector-core/src/index';

const BASE = (process.argv[2] ?? 'https://bankrupt.centerr.ru').replace(/\/+$/, '');
const LISTING = '/public/auctions-all/'; // слэш обязателен — 404 без него (grabli.md)
const FIXDIR = path.join(findRepoRoot(), 'packages', 'connector-etp-itender', 'test', 'fixtures');

const http = new HttpClient({ minIntervalMs: 2500, jitterMs: 1000, retries: 2 });

const LOT_RE = /\/public\/([\w-]+)\/lots\/view\/(\d+)\//g;

function hidden(html: string, name: string): string | undefined {
  const m = html.match(new RegExp(`id="${name}"[^>]*value="([^"]*)"`));
  return m?.[1];
}

function lots(html: string): string[] {
  return [...new Set([...html.matchAll(LOT_RE)].map((m) => `${m[1]}/${m[2]}`))];
}

async function main(): Promise<void> {
  mkdirSync(FIXDIR, { recursive: true });

  // --- страница 1 ---
  const p1 = await http.get(BASE + LISTING);
  const html1 = p1.body.toString('utf-8');
  console.log(`GET ${LISTING} -> ${p1.status}, ${html1.length} байт`);
  const vs = hidden(html1, '__VIEWSTATE');
  const ev = hidden(html1, '__EVENTVALIDATION');
  const vsg = hidden(html1, '__VIEWSTATEGENERATOR');
  console.log(
    `__VIEWSTATE: ${vs ? vs.length + ' байт' : 'НЕТ'}, __EVENTVALIDATION: ${ev ? 'есть' : 'НЕТ'}, generator: ${vsg ?? 'нет'}`,
  );
  const lots1 = lots(html1);
  console.log(`лотов на странице: ${lots1.length}; первые: ${lots1.slice(0, 3).join(', ')}`);

  // цели постбэка пагинации
  const targets = [...new Set([...html1.matchAll(/__doPostBack\('([^']+)','([^']*)'\)/g)].map((m) => `${m[1]} | ${m[2]}`))];
  const pagerTargets = targets.filter((t) => /page/i.test(t));
  console.log(`__doPostBack целей: ${targets.length}, похожих на пагинацию: ${pagerTargets.length}`);
  for (const t of pagerTargets.slice(0, 6)) console.log(`  ${t}`);
  if (pagerTargets.length === 0) for (const t of targets.slice(0, 10)) console.log(`  ? ${t}`);

  writeFileSync(path.join(FIXDIR, 'listing-page1.html'), html1, 'utf-8');

  // форма: action и все hidden-поля (могут быть обязательные помимо VIEWSTATE)
  const action = html1.match(/<form[^>]*action="([^"]*)"/)?.[1];
  console.log(`form action: ${action}`);

  // --- постбэк на страницу 2 ---
  const pick = pagerTargets[0] ?? targets.find((t) => /Page\$2|page2/i.test(t));
  if (vs && pick) {
    const [target, argument] = pick.split(' | ');
    const form: Record<string, string> = {
      __EVENTTARGET: target!,
      __EVENTARGUMENT: argument!,
      __VIEWSTATE: vs,
    };
    if (ev) form.__EVENTVALIDATION = ev;
    if (vsg) form.__VIEWSTATEGENERATOR = vsg;
    const p2 = await http.post(BASE + LISTING, form, { Referer: BASE + LISTING });
    const html2 = p2.body.toString('utf-8');
    const lots2 = lots(html2);
    const overlap = lots2.filter((x) => lots1.includes(x)).length;
    console.log(
      `POST постбэк [${target} / ${argument}] -> ${p2.status}, лотов: ${lots2.length}, совпадений со стр.1: ${overlap}`,
    );
    writeFileSync(path.join(FIXDIR, 'listing-page2.html'), html2, 'utf-8');
  } else {
    console.log('постбэк не собрать: нет VIEWSTATE или цели пагинации');
  }

  // --- карточка лота по GET ---
  if (lots1[0]) {
    const [section, id] = lots1[0].split('/');
    const cardUrl = `${BASE}/public/${section}/lots/view/${id}/`;
    const c = await http.get(cardUrl);
    const chtml = c.body.toString('utf-8');
    console.log(`GET карточка ${cardUrl} -> ${c.status}, ${chtml.length} байт`);
    writeFileSync(path.join(FIXDIR, 'lotcard.html'), chtml, 'utf-8');

    // ключевые подписи таблицы
    for (const label of ['ЕФРСБ', 'Классификатор', 'Начальная цена', 'Статус', 'Шаг', 'задатк', 'Дата', 'прием', 'Повторн']) {
      const hit = chtml.includes(label);
      console.log(`  «${label}»: ${hit ? 'есть' : 'нет'}`);
    }
  }

  console.log(`\nHTTP: запросов ${http.stats.requests}, ретраев ${http.stats.retries}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
