/**
 * Тесты разбора МЭТС на фикстурах реальных ответов площадки (снято 31.08.2026).
 * Фикстуры и есть контракт с источником: верстка машинная, дрейф ловится здесь.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { infoItems, parseMoney, parseRuDate } from '../src/html';
import { makeMetsConnector, mapStatus, mapTradeKind, parseSitemapIndex, parseSitemapUrls } from '../src/mets';
import { encodeQuery, searchUrl } from '../src/search';

const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const offerHtml = readFileSync(path.join(FX, 'lotcard-public-offer.html'), 'utf-8');
const auctionHtml = readFileSync(path.join(FX, 'lotcard-auction.html'), 'utf-8');
const multilotHtml = readFileSync(path.join(FX, 'lotcard-multilot.html'), 'utf-8');
const sitemapIndex = readFileSync(path.join(FX, 'sitemap-index.xml'), 'utf-8');
const sitemapActive = readFileSync(path.join(FX, 'sitemap-active-head.xml'), 'utf-8');

const conn = makeMetsConnector();
const parse = (lotPath: string, html: string) =>
  conn.parse(
    { url: `https://m-ets.ru/${lotPath}`, lotPath, html },
    { now: '2026-08-31T12:00:00Z', contentHash: 'hash' },
  );

const offer = parse('231205-1', offerHtml);
const auction = parse('231193-1', auctionHtml);

test('sitemap: карта лотов и отпечаток по lastmod', () => {
  const maps = parseSitemapIndex(sitemapIndex, false);
  assert.ok(maps.length >= 2);
  assert.ok(maps.every((u) => u.includes('active_lots')));
  // завершенные лоты подключаются отдельно — их в карте на порядок больше
  assert.ok(parseSitemapIndex(sitemapIndex, true).length > maps.length);

  const urls = parseSitemapUrls(sitemapActive);
  assert.equal(urls.length, 50);
  assert.equal(urls[0]!.externalId, '180235-1');
  assert.match(urls[0]!.lastmod, /^\d{4}-\d{2}-\d{2}/);
  // новости и статьи в карте есть, в лоты не попадают
  assert.ok(urls.every((u) => /^\d+-\d+$/.test(u.externalId)));
});

test('карточка публичного предложения: полный CoreLot', () => {
  assert.equal(offer.id, 'etp-mets:231205-1');
  assert.equal(offer.title, 'Hyundai Solaris, 2022 года, 122,6 лс, 189869 км, АКПП');
  assert.equal(offer.legalBasis, 'bankruptcy_127fz');
  assert.equal(offer.tradeKind, 'public_offer');
  assert.equal(offer.status, 'published');
  assert.equal(offer.statusRaw, 'Объявленные торги');
  assert.equal(offer.kind, 'vehicle');
  assert.equal(offer.categoryName, 'Легковой автомобиль');
  assert.equal(offer.regionCode, '77');
  assert.equal(offer.etpCode, 'mets');
  assert.equal(offer.caseNumber, 'А41-41498/2025');
  // цены строками (решение №3)
  assert.equal(offer.priceStart, '1090827');
  assert.equal(offer.biddStartAt, '2026-09-01T10:00:00+03:00');
  assert.equal(offer.biddEndAt, '2026-10-01T10:00:00+03:00');
  assert.equal(offer.tzName, 'МСК');
  assert.equal(offer.attachments.length, 3);
  assert.ok(offer.attachments.every((a) => a.fileId.startsWith('https://m-ets.ru/download/')));
});

test('график снижения цены разбирается таблицей, а не текстом условий', () => {
  const periods = offer.pricePeriods ?? [];
  assert.equal(periods.length, 6);
  assert.deepEqual(
    periods.map((p) => p.no),
    [1, 2, 3, 4, 5, 6],
  );
  assert.equal(periods[0]!.price, '1090827.00');
  assert.equal(periods[0]!.startAt, '2026-09-01T10:00:00+03:00');
  assert.equal(periods[0]!.deposit, '54541.35');
  assert.equal(periods[5]!.price, '818120.25');
  // цена отсечения — цена последнего периода; задаток лота — задаток первого
  assert.equal(offer.priceMin, '818120.25');
  assert.equal(offer.deposit, '54541.35');
  // у аукциона графика нет, зато есть шаг и задаток отдельными полями
  assert.equal(auction.pricePeriods, undefined);
  assert.equal(auction.priceStep, '48645');
  assert.equal(auction.deposit, '194580');
});

test('сущности: должник и арбитражный управляющий разделены по разделам', () => {
  const by = (role: string) => offer.parties?.find((p) => p.role === role);
  const debtor = by('debtor');
  assert.equal(debtor?.name, 'Бартош Сергей Викторович');
  assert.equal(debtor?.kind, 'person');
  assert.equal(debtor?.inn, '325305352511');
  // сквозной ключ сущности: карточка лица в ЕФРСБ
  assert.equal(debtor?.efrsbId, 'fb815a50670b0ca8a184c66b67a7e965');

  const manager = by('manager');
  assert.equal(manager?.name, 'Мартынов Вячеслав Васильевич');
  assert.equal(manager?.inn, '507503623311');
  assert.equal(manager?.sro, 'ПАУ ЦФО');

  assert.equal(by('organizer')?.email, 'martynov.torgi@gmail.com');
  // ИНН залогового кредитора площадка прячет в подсказку
  assert.equal(by('pledgee')?.name, 'АО БАНК ИНГО');
  assert.equal(by('pledgee')?.inn, '7714056040');

  // у второго лота должник и управляющий другие — значит разбор не угадывает
  assert.equal(auction.parties?.find((p) => p.role === 'debtor')?.name, 'Хворостенко Дмитрий Сергеевич');
  assert.equal(auction.parties?.find((p) => p.role === 'manager')?.sro, 'ААУ "Эверест"');
});

test('СНИЛС должника площадка отдает, а мы его не храним (152-ФЗ, docs/07)', () => {
  // поле на карточке есть — иначе тест ничего не проверял бы
  assert.ok(infoItems(offerHtml).some((i) => i.label === 'СНИЛС'));
  assert.ok(!JSON.stringify(offer).includes('138-473-991'));
  assert.ok(!JSON.stringify(auction).includes('188-392-975'));
});

test('свойства машины приходят полями, а не текстом описания', () => {
  const attr = (key: string) => offer.attributes.find((a) => a.key === key)?.value;
  assert.equal(attr('vin'), 'Z94K241CBNR341900');
  assert.equal(attr('brand'), 'Hyundai');
  assert.equal(attr('model'), 'Solaris');
  assert.equal(attr('year'), '2022');
  assert.equal(attr('mileage'), '189 869');
  assert.equal(offer.attributes.find((a) => a.key === 'mileage')?.unit, 'км');
  assert.equal(attr('efrsbTradeId'), '24416385');
  assert.equal(auction.attributes.find((a) => a.key === 'vin')?.value, 'Z94C241BAKR122294');
});

test('разделы карточки различают одноименные поля', () => {
  const items = infoItems(offerHtml);
  const inns = items.filter((i) => i.label === 'ИНН');
  // ИНН есть и у должника, и у управляющего, и у организатора
  assert.ok(inns.length >= 3);
  assert.ok(inns.some((i) => /Сведения о должнике/.test(i.section)));
  assert.ok(inns.some((i) => /управляющий/i.test(i.section)));
});

test('статусы и формы торгов площадки -> наши', () => {
  assert.equal(mapStatus('Объявленные торги'), 'published');
  assert.equal(mapStatus('Прием заявок'), 'applications');
  assert.equal(mapStatus('Прием заявок завершен'), 'determining');
  assert.equal(mapStatus('Проведение аукциона'), 'determining');
  assert.equal(mapStatus('Торги завершены'), 'finished');
  assert.equal(mapStatus('Торги отменены'), 'canceled');
  assert.equal(mapStatus('Торги приостановлены'), 'canceled');
  assert.equal(mapStatus('Что-то новое'), 'unknown');

  assert.equal(mapTradeKind('Открытые торги посредством публичного предложения'), 'public_offer');
  assert.equal(mapTradeKind('Открытый аукцион с открытой формой представления предложений о цене'), 'auction');
  assert.equal(mapTradeKind('Конкурс'), 'competition');
  assert.equal(mapTradeKind(undefined), 'other');
});

test('деньги и даты: формат площадки', () => {
  assert.equal(parseMoney('1 090 827 руб. НДС не облагается'), '1090827');
  assert.equal(parseMoney('641 331&nbsp;&#8381;'), '641331');
  assert.equal(parseMoney('54 541,35'), '54541.35');
  assert.equal(parseMoney('нет'), undefined);
  assert.equal(parseRuDate('01.09.2026 10:00', '+03:00'), '2026-09-01T10:00:00+03:00');
  assert.equal(parseRuDate('24.07.2025', '+03:00'), '2025-07-24T00:00:00+03:00');
});

test('поисковый запрос кодируется так же, как это делает форма площадки', () => {
  // адрес снят с живого поиска: категория «Легковой автомобиль» + банкротство
  assert.equal(encodeQuery({ isbankr: 'on', search_category: '1' }), 'eyJpc2JhbmtyIjoib24iLCJzZWFyY2hfY2F0ZWdvcnkiOiIxIn0');
  // ключи сортируются независимо от порядка передачи
  assert.equal(encodeQuery({ search_category: '1', isbankr: 'on' }), encodeQuery({ isbankr: 'on', search_category: '1' }));
  assert.equal(
    searchUrl('https://m-ets.ru', { categories: ['1'], bankruptcyOnly: true }, 2),
    'https://m-ets.ru/search?q=eyJpc2JhbmtyIjoib24iLCJzZWFyY2hfY2F0ZWdvcnkiOiIxIn0&page=2',
  );
});

test('в торгах несколько лотов: каждый получает СВОИ характеристики', () => {
  // страница `/215458-2` рендерит все три лота торгов подряд; разбор по всему
  // документу отдавал бы второму лоту VIN первого (поймано живым прогоном)
  const lot2 = parse('215458-2', multilotHtml);
  const lot1 = parse('215458-1', multilotHtml);
  const vin = (l: typeof lot1) => l.attributes.find((a) => a.key === 'vin')?.value;
  assert.equal(vin(lot1), 'KMHR381ADLU126882');
  assert.equal(vin(lot2), 'XWER381ADM0001144');
  assert.notEqual(lot1.title, lot2.title);
  assert.notEqual(lot1.priceStart, lot2.priceStart);

  // а сведения о торгах и сторонах общие — они лежат ниже блоков лотов
  assert.equal(lot1.caseNumber, lot2.caseNumber);
  assert.equal(
    lot1.parties?.find((p) => p.role === 'debtor')?.name,
    lot2.parties?.find((p) => p.role === 'debtor')?.name,
  );
  // категория и регион берутся из блока лота, а не из хлебных крошек
  assert.equal(lot2.regionCode, '18');
  assert.equal(lot2.categoryCode, '1');
});

test('карточка не похожа на лот -> ошибка, а не пустой CoreLot', () => {
  // источник врет молча: снятый лот отвечает 200 обычной страницей
  assert.throws(() => parse('1-1', '<html><body>Страница не найдена</body></html>'), /ни одного поля/);
});
