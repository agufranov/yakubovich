/**
 * Тесты разбора iTender на фикстурах реального ответа площадки
 * (bankrupt.centerr.ru, снято зондом tools/probe/etp_itender_pagination.mts).
 * Верстка движка общая для 14 площадок — фикстуры и есть контракт с ним.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hiddenInputs, parseMoney, parseRuDate } from '../src/html';
import { makeItenderConnector, nextPageLink, parseListing } from '../src/itender';

const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const listing = readFileSync(path.join(FX, 'listing-page1.html'), 'utf-8');
const card = readFileSync(path.join(FX, 'lotcard.html'), 'utf-8');

const conn = makeItenderConnector({
  code: 'centerr',
  name: 'ЭП Центра реализации',
  baseUrl: 'https://bankrupt.centerr.ru',
});

test('листинг: 20 лотов, externalId кодирует раздел', () => {
  const items = parseListing(listing);
  assert.equal(items.length, 20);
  assert.equal(items[0]!.externalId, 'auctions_1167418');
  assert.ok(items.every((i) => /^[\w-]+_\d+$/.test(i.externalId)));
});

test('отпечаток листинга не тикает вместе со счетчиком «(N дн.)»', () => {
  const a = parseListing(listing);
  const b = parseListing(listing.replace(/\(29 дн\.\)/g, '(28 дн.)'));
  assert.equal(a[0]!.fingerprint, b[0]!.fingerprint);
  // но на смену статуса — реагирует (replaceAll: первое вхождение — в фильтре формы)
  const c = parseListing(listing.replaceAll('Прием заявок', 'Идут торги'));
  assert.notEqual(a[0]!.fingerprint, c[0]!.fingerprint);
});

test('пагинация: цель постбэка для страницы 2, hidden-поля формы целиком', () => {
  const nav = nextPageLink(listing, 2);
  assert.ok(nav);
  assert.match(nav.target, /PurchasesSearchResult\$ctl01\$ctl02$/);
  const hidden = hiddenInputs(listing);
  // состояние WebForms живет в __CVIEWSTATE (а __VIEWSTATE пустой) — пересылаем все
  assert.ok((hidden.__CVIEWSTATE ?? '').length > 1000);
  assert.ok((hidden.__EVENTVALIDATION ?? '').length > 100);
  assert.equal(hidden.__VIEWSTATE, '');
});

test('карточка: полный CoreLot с ключом ЕФРСБ', () => {
  const lot = conn.parse(
    {
      url: 'https://bankrupt.centerr.ru/public/auctions/lots/view/1167418/',
      section: 'auctions',
      lotId: '1167418',
      html: card,
    },
    { now: '2026-08-26T12:00:00Z', contentHash: 'hash' },
  );

  assert.equal(lot.id, 'itender-centerr:auctions_1167418');
  assert.equal(lot.sourceCode, 'itender-centerr');
  assert.equal(lot.title, 'Машиноместо');
  assert.equal(lot.legalBasis, 'bankruptcy_127fz');
  assert.equal(lot.tradeKind, 'auction');
  assert.equal(lot.status, 'applications');
  assert.equal(lot.statusRaw, 'Прием заявок');
  assert.equal(lot.kind, 'realty');
  // цены — строки из источника, без float
  assert.equal(lot.priceStart, '5609411.71');
  assert.equal(lot.priceStep, '280470.59');
  assert.equal(lot.deposit, '5609.41');
  // даты в допущении МСК (см. itender.ts)
  assert.equal(lot.publishedAt, '2026-07-10T00:00:00+03:00');
  assert.equal(lot.biddStartAt, '2026-08-20T12:00:00+03:00');
  assert.equal(lot.biddEndAt, '2026-09-25T12:00:00+03:00');
  assert.equal(lot.auctionAt, '2026-10-12T12:00:00+03:00');
  assert.equal(lot.etpCode, 'centerr');

  // канонический сквозной ключ — номер сообщения ЕФРСБ (главная ценность карточки)
  const efrsb = lot.attributes.find((a) => a.key === 'efrsbMessageId');
  assert.equal(efrsb?.value, '23349218');
  const classifier = lot.attributes.find((a) => a.key === 'efrsbClassifier');
  assert.match(classifier?.value ?? '', /Незавершенное строительство/);

  // документы — абсолютные ссылки на площадку (мы файлы не храним, решение №4)
  assert.equal(lot.attachments.length, 2);
  assert.ok(lot.attachments.every((a) => a.fileId.startsWith('https://bankrupt.centerr.ru/public/attachments/file/')));
  assert.equal(lot.attachments[0]!.name, 'Договор купли-продажи недвижимого имущества.pdf');
});

test('первое «Наименование» (торгов) не подменяет наименование лота', () => {
  const lot = conn.parse(
    { url: 'u', section: 'auctions', lotId: '1', html: card },
    { now: '2026-08-26T12:00:00Z', contentHash: 'h' },
  );
  // в карточке выше по документу есть «Наименование: Имущество» (у торгов)
  assert.notEqual(lot.title, 'Имущество');
});

test('деньги и даты: формат источника', () => {
  assert.equal(parseMoney('5 609 411,71'), '5609411.71');
  assert.equal(parseMoney('280&#160;470,59'), '280470.59');
  assert.equal(parseMoney('5 609 411,71 Купить с агентом'), '5609411.71');
  assert.equal(parseMoney(''), undefined);
  assert.equal(parseRuDate('25.09.2026 12:00', '+03:00'), '2026-09-25T12:00:00+03:00');
  assert.equal(parseRuDate('10.07.2026', '+03:00'), '2026-07-10T00:00:00+03:00');
  assert.equal(parseRuDate('скоро', '+03:00'), undefined);
});

test('статусы движка -> наши', () => {
  const parseWith = (statusHtml: string) =>
    conn.parse(
      {
        url: 'u',
        section: 'auctions',
        lotId: '1',
        html: `<table><tr><td>Наименование:</td><td>Лот</td></tr><tr><td>Статус:</td><td>${statusHtml}</td></tr></table>`,
      },
      { now: '2026-08-26T12:00:00Z', contentHash: 'h' },
    ).status;
  assert.equal(parseWith('Прием заявок'), 'applications');
  assert.equal(parseWith('Торги не состоялись'), 'failed');
  assert.equal(parseWith('Торги состоялись'), 'finished');
  assert.equal(parseWith('Торги отменены'), 'canceled');
  assert.equal(parseWith('Подведение итогов'), 'determining');
  assert.equal(parseWith('Что-то новое'), 'unknown');
});
