/**
 * Площадки семейства iTender (движок опознан зондом 2026-08-25,
 * docs/research/etp-registry.md). Один коннектор обслуживает все: у движка
 * идентичные URL и верстка. У каждой площадки свой sourceCode `itender-<code>`
 * — прогоны, state и наблюдаемость раздельные (решение №6: площадка ломается
 * молча, аномалию объема надо видеть по каждой).
 */
export interface ItenderPlatform {
  /** короткий код: попадает в sourceCode и в CoreLot.etpCode */
  code: string;
  name: string;
  /** без завершающего слэша */
  baseUrl: string;
  /** выдача была пуста при зондировании — подтвердить живость при подключении */
  emptyAtProbe?: boolean;
}

export const ITENDER_PLATFORMS: ItenderPlatform[] = [
  { code: 'utender', name: 'uTender', baseUrl: 'http://utender.ru' },
  { code: 'centerr', name: 'ЭП Центра реализации', baseUrl: 'https://bankrupt.centerr.ru' },
  { code: 'bepspb', name: 'Балтийская ЭП', baseUrl: 'https://bankruptcy.bepspb.ru' },
  { code: 'arbitat', name: 'Арбитат', baseUrl: 'http://www.arbitat.ru' },
  { code: 'meta-invest', name: 'МЕТА-ИНВЕСТ', baseUrl: 'http://www.meta-invest.ru' },
  { code: 'tendergarant', name: 'Тендер Гарант', baseUrl: 'http://www.tendergarant.com' },
  { code: 'gloria', name: 'ЭТП «Регион»', baseUrl: 'https://bankruptcy.gloriaservice.ru' },
  { code: 'tender-one', name: 'Единая торговая ЭП', baseUrl: 'https://bankrupt.tender.one' },
  { code: 'torgibankrot', name: 'Южная ЭТП', baseUrl: 'https://torgibankrot.ru' },
  { code: 'etpu', name: 'Уральская ЭТП', baseUrl: 'https://bankrupt.etpu.ru' },
  { code: 'utpl', name: 'Объединенная ТП', baseUrl: 'https://bankrupt.utpl.ru' },
  { code: 'ets24', name: 'ЭТС24', baseUrl: 'http://bankrupt.ets24.ru', emptyAtProbe: true },
  { code: 'arbbitlot', name: 'Арббитлот', baseUrl: 'https://torgi.arbbitlot.ru' },
  { code: 'zakazrf', name: 'ЭТП «Заказ РФ»', baseUrl: 'http://bankrot.zakazrf.ru', emptyAtProbe: true },
];

export function platformByCode(code: string): ItenderPlatform | undefined {
  return ITENDER_PLATFORMS.find((p) => p.code === code);
}
