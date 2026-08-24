# Модель данных

## Центральная идея: лот ≠ имущество

Одна и та же машина продается несколько раз: первичные торги не состоялись →
повторные с ценой ниже → публичное предложение с падающей ценой. Это **три-четыре
разных лота на разных площадках, но один физический объект**.

Разделение `asset` (имущество) и `lot` (попытка продажи) — самое важное решение в
модели. Оно дает три вещи, которых нет у конкурентов:

- «этот объект пытались продать 3 раза, цена упала с 4 млн до 1,7 млн» — прямо в карточке;
- сравнение с проданными аналогами → оценка справедливой цены;
- отсутствие дублей в выдаче.

Если этого не заложить сразу, потом придется переразбирать весь архив.

## Схема

```
                    ┌───────────┐
                    │  debtor   │  должник (ИНН/ОГРН, ФИО, тип)
                    └─────┬─────┘
                          │
   ┌───────────┐    ┌─────▼─────┐    ┌──────────────┐
   │  source   │◀───│    lot    │───▶│    asset     │  физический объект
   │ ГИС/ЭТП   │    │ попытка   │    │ VIN/кадастр  │
   └───────────┘    │ продажи   │    └──────────────┘
                    └─────┬─────┘
          ┌───────────────┼───────────────┬──────────────────┐
          ▼               ▼               ▼                  ▼
   ┌────────────┐  ┌────────────┐  ┌────────────┐   ┌────────────────┐
   │ attachment │  │price_step  │  │lot_attribute│  │  price_history │
   │ документы  │  │график ПП   │  │ атрибуты   │   │  снимки цены   │
   └────────────┘  └────────────┘  └────────────┘   └────────────────┘
```

## Ключевые таблицы

### lot — попытка продажи

```sql
CREATE TABLE lot (
  id                bigserial PRIMARY KEY,
  source_code       text NOT NULL,            -- 'gis-torgi', 'etp-rts'
  external_id       text NOT NULL,            -- ID в источнике
  asset_id          bigint REFERENCES asset,  -- NULL пока не связали
  debtor_id         bigint REFERENCES debtor,

  title             text NOT NULL,
  description       text,
  category_id       int REFERENCES category,
  region_code       text,                     -- код субъекта РФ
  location_text     text,

  trade_kind        text NOT NULL,            -- auction | public_offer | competition
  legal_basis       text NOT NULL,            -- bankruptcy_127fz | fssp_229fz | privatization_178fz
  status            text NOT NULL,

  price_start       numeric(18,2),            -- ВСЕГДА numeric, никогда float
  price_current     numeric(18,2),            -- для ПП пересчитывается по графику
  price_min         numeric(18,2),            -- цена отсечения для ПП
  price_final       numeric(18,2),            -- по факту продажи
  price_step        numeric(18,2),
  deposit           numeric(18,2),

  bid_start_at      timestamptz,
  bid_end_at        timestamptz,
  auction_at        timestamptz,

  etp_code          text,
  etp_url           text NOT NULL,            -- ссылка «купить» — смысл продукта
  published_at      timestamptz,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL,
  raw_hash          text NOT NULL,

  search_vector     tsvector,
  UNIQUE (source_code, external_id)
);
```

`(source_code, external_id)` — единственный настоящий ключ. Всё остальное у источников
меняется, включая цену, статус и даже название.

`last_seen_at` — способ понять, что лот пропал из источника, без каскадных удалений.
Ничего никогда не удаляем: исчезнувший лот получает статус `archived`. **Архив — актив**
([01-strategy.md](01-strategy.md)).

### asset — физический объект

```sql
CREATE TABLE asset (
  id             bigserial PRIMARY KEY,
  kind           text NOT NULL,        -- vehicle | realty | land | equipment | receivable | share | other
  vin            text,                 -- ключ склейки для транспорта
  cadastral_no   text,                 -- ключ склейки для недвижимости и земли
  fingerprint    text,                 -- фолбэк: хеш (должник + тип + нормализованное описание)
  title          text
);
CREATE UNIQUE INDEX ON asset (vin) WHERE vin IS NOT NULL;
CREATE UNIQUE INDEX ON asset (cadastral_no) WHERE cadastral_no IS NOT NULL;
```

Стратегия склейки, по убыванию надежности:

1. **VIN** (транспорт) и **кадастровый номер** (недвижимость, земля) — точные ключи.
   ГИС Торги отдает их в `characteristics` готовыми; из текста ЭТП вынимаются регуляркой.
   Покрывают, по грубой оценке, большинство ходовых лотов.
2. `previousProcedures` из ГИС Торги — источник сам сообщает связь с прошлой процедурой.
3. **Fingerprint**: должник + тип + нормализованное описание + близость стартовой цены.
   Нечеткий, только для показа «похожие лоты», не для слияния.

Правило: **сомневаешься — не склеивай.** Ложное объединение двух разных квартир хуже,
чем показ двух карточек одной квартиры.

### price_step — график публичного предложения

```sql
CREATE TABLE price_step (
  lot_id     bigint NOT NULL REFERENCES lot ON DELETE CASCADE,
  step_no    int NOT NULL,
  from_at    timestamptz NOT NULL,
  to_at      timestamptz NOT NULL,
  price      numeric(18,2) NOT NULL,
  PRIMARY KEY (lot_id, step_no)
);
```

Ради этой таблицы существует половина продукта. Она позволяет отвечать на вопрос,
ради которого люди и заходят на такие сайты: *«когда цена на этот объект опустится до
моего бюджета?»* — и слать алерт в этот момент.

Заполняется: из полей источника, если есть; иначе разбором текста условий или PDF.
Разбор графика — отдельная задача этапа 3, не блокирует MVP.

### lot_attribute — атрибуты произвольного типа

Проблема «машина, дом, самолет, ядерный реактор» решается через EAV с контролируемым
словарем: у каждого типа имущества свой набор ключей.

```sql
CREATE TABLE lot_attribute (
  lot_id      bigint NOT NULL REFERENCES lot ON DELETE CASCADE,
  key         text NOT NULL,       -- 'vin', 'mileage', 'area_sqm', 'year'
  value_text  text,
  value_num   numeric,             -- заполняется для числовых — по нему фильтры и индексы
  unit        text,
  confidence  real,                -- 1.0 из структурного источника, <1 из текста/LLM
  source      text NOT NULL,       -- 'structured' | 'regex' | 'llm'
  PRIMARY KEY (lot_id, key)
);
```

`confidence` и `source` — не украшение. Атрибут из `characteristics` ГИС Торги и
атрибут, угаданный моделью из описания, — данные разного качества. Фильтровать по
первым можно жестко, по вторым — только мягко, и в UI их стоит помечать. Без этих
полей через полгода будет невозможно понять, чему верить.

### price_history — снимки цены

```sql
CREATE TABLE price_history (
  lot_id     bigint NOT NULL REFERENCES lot ON DELETE CASCADE,
  seen_at    timestamptz NOT NULL,
  price      numeric(18,2) NOT NULL,
  status     text NOT NULL,
  PRIMARY KEY (lot_id, seen_at)
);
```

Пишем при каждом изменении. Это сырье для будущей аналитики «за сколько реально
уходят такие объекты» — то есть для ответа на главный вопрос покупателя.

## Слой raw

```sql
CREATE TABLE raw_payload (
  id           bigserial PRIMARY KEY,
  source_code  text NOT NULL,
  external_id  text NOT NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  content_hash text NOT NULL,
  payload      jsonb NOT NULL,
  UNIQUE (source_code, external_id, content_hash)
);
```

Уникальность по хешу означает: повторный забор без изменений не создает строки.
Хранит только историю реальных версий. Переразбор всего архива — один проход по этой
таблице.

## Индексы

```sql
CREATE INDEX ON lot USING gin (search_vector);
CREATE INDEX ON lot USING gin (title gin_trgm_ops);
CREATE INDEX ON lot (status, bid_end_at) WHERE status = 'active';
CREATE INDEX ON lot (category_id, region_code, price_current);
CREATE INDEX ON lot_attribute (key, value_num) WHERE value_num IS NOT NULL;
```

Частичный индекс по активным лотам — главный для выдачи: активных всегда на порядок
меньше, чем всего.
