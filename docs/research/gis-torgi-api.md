# ГИС Торги: техническая спецификация API

> Восстановлено зондированием 2026-08-24. Официальной публичной документации не найдено.
> Воспроизводится скриптами [tools/probe/](../../tools/probe/).

Базовый URL: `https://torgi.gov.ru/new/api/public`
Авторизация: **не требуется.** Формат: JSON (Spring Data Page).

## Эндпоинты

### Поиск лотов

```
GET /lotcards/search?size=50&page=0&sort=firstVersionPublicationDate,desc
```

Ответ:

```jsonc
{
  "content": [ /* массив лотов */ ],
  "categoryFacet": [ /* фасеты по категориям — готовая агрегация */ ],
  "totalElements": 10000,   // ВНИМАНИЕ: жестко ограничено сверху, см. «Лимиты»
  "totalPages": 1000,
  "number": 0, "size": 50, "last": false, "first": true
}
```

### Карточка лота (полная)

```
GET /lotcards/{noticeNumber}_{lotNumber}
```

Пример: `/lotcards/22000213210000000025_1`. Отдает всё из поиска плюс `priceStep`,
`previousProcedures` и `lotAttachments` с метаданными файлов.

### Файлы (изображения и вложения)

```
GET https://torgi.gov.ru/new/file-store/v1/{fileId}
```

Отдает бинарник напрямую (`Content-Type: image/jpeg` и т.п.). `fileId` берется из
`lotImages[]` или `lotAttachments[].fileId`.

## Структура лота

| Поле | Тип | Заметки |
|---|---|---|
| `id` | string | `{noticeNumber}_{lotNumber}` — natural key |
| `noticeNumber` | string | Номер извещения |
| `lotNumber` | int | Номер лота внутри извещения |
| `lotStatus` | enum | `PUBLISHED`, `APPLICATIONS_SUBMISSION`, `FAILED`, … |
| `biddType` | {code,name} | Тип торгов, см. [02-data-sources.md](../02-data-sources.md) |
| `biddForm` | {code,name} | `EA` — электронный аукцион и др. |
| `lotName` / `lotDescription` | string | Свободный текст |
| `priceMin` / `priceFin` | number | Начальная / финальная цена |
| `priceMinExact` / `priceFinExact` | string | Точные значения строкой — **брать их**, не float |
| `priceStep` | number | Только в карточке |
| `biddEndTime` | ISO8601 | Окончание приема заявок, UTC |
| `subjectRFCode` | string | Код субъекта РФ (`77` — Москва, `86` — ХМАО) |
| `category` | {code,name} | Госклассификатор: `100001` Легковые автомобили, `11` Нежилые помещения, `301` Земли населенных пунктов… |
| `etpCode` | string | Площадка: `ETP_RTS`, `ETP_SBAST`, `ETP_EETP`, `ETP_RAD`, … Бывает `null` |
| `characteristics[]` | array | **Нормализованные атрибуты**, см. ниже |
| `lotImages[]` | string[] | fileId изображений |
| `lotAttachments[]` | array | `fileId`, `fileName`, `fileSize`, `hash` (sha256), `signatureId`, `uploadDate` |
| `previousProcedures[]` | array | Ссылки на предыдущие процедуры по тому же имуществу |
| `createDate`, `noticeFirstVersionPublicationDate` | ISO8601 | |
| `timeZoneName`, `timezoneOffset` | string | Часовой пояс лота |
| `lotVat`, `currencyCode`, `typeTransaction`, `isAnnulled`, `isStopped` | | |

### characteristics[] — самое ценное

Массив объектов `{code, name, characteristicValue, type, unit}`. Государство уже
привело атрибуты к справочнику. Встреченные коды:

**Автомобили:** `vin`, `carMarka`, `carModel`, `typeCar`, `yearProduction`, `mileage`,
`engineCapacity`, `enginePower`, `transmission`, `drive`, `environmentalClass`,
`regNumber`, `dateRegNumber`

**Недвижимость:** `cadastralNumberRealty`, `cadastralNumberObjectRealty`,
`cadastralValue`, `totalAreaRealty`, `yearCommissioning`, `locationObjectRealty`,
`typeNolivingQuarters`, `restrictionsEncumbrances`, `typeRestrictionsEncumbrances`

**Земля:** `CadastralNumber`, `SquareZU`, `SquareZU_project`, `PurposeZU`,
`PermittedUse`, `subsidiaryPermittedUse`, `territorialZones`, `generalPurpose`

**Прочее:** `electronicType`, `electronicCondition`, `regNumberEGROKN`

Поле `characteristicValue` **отсутствует**, если значение не заполнено, — код
характеристики при этом всё равно присутствует. Не путать «нет ключа» и «нет значения».

## Лимиты и подводные камни

**`size` жестко ограничен 10 записями.** Запрос `size=50` не вызывает ошибку — сервер
молча отдает 10 и проставляет `pageable.pageSize: 10`. Значения меньше 10 работают
(`size=5` отдает 5). Проверено на 5/10/20/50/100/200.

**`totalElements` ограничен 10 000.** Это не реальное количество, а потолок выдачи.
Любой широкий запрос вернет ровно `10000`. Настоящее число лотов узнать этим полем
нельзя.

**Доступны страницы 0…999, не больше.** При `size=10` это ровно 10 000 записей на срез.
`page=1000` отдает **HTTP 200 с пустым телом** — не ошибку. Наивный `JSON.parse`
на этом падает с невнятным сообщением; обрабатывать явно.

Отдельно: единичные запросы иногда обрываются по сети (`ECONNRESET`). Это транзиентный
сбой, а не граница — тот же запрос при повторе проходит. Ретраить.

**Следствия для архитектуры сбора** (важны для оценки трудоемкости):

1. Один срез вычерпывается за **1000 запросов по 10 записей**. При вежливых
   2 запросах в секунду это ~8 минут на срез. Полная историческая загрузка — это часы
   и десятки срезов, планировать как фоновую задачу с возобновлением с курсора.
2. Нельзя просто «пройти всё постранично». Нужно **нарезать пространство запросов**
   на срезы меньше 10 000 записей — по комбинации `biddType` × `subjectRFCode` ×
   окно дат публикации.
3. Ежедневное обновление устроено иначе и дешево: обход по
   `sort=firstVersionPublicationDate,desc` с остановкой на первом уже виденном ID.

**Фильтры надо проверять поштучно.** Подтверждено рабочим: `biddType` (неверный код
дает 0), `lotStatus` (`PUBLISHED` дал 2195 против потолка 10000). Остальные параметры
из UI (`dynSubjRF`, `catCode`, `priceFrom`, `text`, диапазоны дат) **не подтверждены** —
широкий запрос упирается в потолок 10000 и по нему невозможно отличить рабочий фильтр
от проигнорированного. Методика проверки: подавать заведомо бессмысленное значение и
смотреть, вернется ли 0 (фильтр работает) или 10000 (параметр игнорируется).

**TLS.** Сайт использует сертификат российского УЦ. Стандартные хранилища доверия его
не знают — Python/Node/.NET падают с ошибкой доверия. См. [grabli.md](grabli.md).
