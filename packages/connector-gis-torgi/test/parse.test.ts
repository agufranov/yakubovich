/**
 * Тест parse на фикстуре реального ответа (docs/06: единственная стратегия,
 * которая работает с чужими API, — фикстуры реальных ответов).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gisTorgi } from '../src/gis-torgi';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(path.join(here, 'fixtures', 'lotcard-229fz.json'), 'utf-8'));

const ctx = { now: '2026-08-25T10:00:00.000Z', contentHash: 'testhash', prev: undefined };

test('parse: идентификация и источник', () => {
  const lot = gisTorgi.parse(fixture, ctx);
  assert.equal(lot.sourceCode, 'gis-torgi');
  assert.match(lot.id, /^gis-torgi:\d+_\d+$/);
  assert.ok(lot.sourceUrl.includes(lot.externalId));
});

test('parse: цены — точные строки, не float', () => {
  const lot = gisTorgi.parse(fixture, ctx);
  assert.equal(typeof lot.priceStart, 'string');
  // точное строковое поле источника, с копейками
  assert.equal(lot.priceStart, fixture.priceMinExact);
});

test('parse: правовая основа и статус замаплены', () => {
  const lot = gisTorgi.parse(fixture, ctx);
  assert.equal(lot.legalBasis, 'fssp_229fz');
  assert.notEqual(lot.status, 'unknown');
  assert.equal(lot.statusRaw, fixture.lotStatus);
});

test('parse: атрибуты только с заполненными значениями', () => {
  const lot = gisTorgi.parse(fixture, ctx);
  const withValue = (fixture.characteristics ?? []).filter(
    (c: { characteristicValue?: unknown }) => c.characteristicValue != null,
  ).length;
  assert.equal(lot.attributes.length, withValue);
  for (const a of lot.attributes) {
    assert.ok(a.value.length > 0);
    assert.equal(a.source, 'structured');
  }
});

test('parse: чистая функция — два вызова дают одинаковый результат', () => {
  const a = gisTorgi.parse(fixture, ctx);
  const b = gisTorgi.parse(fixture, ctx);
  assert.deepEqual(a, b);
});

test('parse: prev сохраняет firstSeenAt', () => {
  const first = gisTorgi.parse(fixture, ctx);
  const later = gisTorgi.parse(fixture, {
    ...ctx,
    now: '2026-09-01T00:00:00.000Z',
    prev: first,
  });
  assert.equal(later.firstSeenAt, first.firstSeenAt);
  assert.equal(later.lastSeenAt, '2026-09-01T00:00:00.000Z');
});

test('parse: карточка без id отклоняется, а не превращается в мусор', () => {
  assert.throws(() => gisTorgi.parse({}, ctx));
});
