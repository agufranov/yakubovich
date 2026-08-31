/**
 * Имена торговых площадок по кодам из `CoreLot.etpCode`.
 * Два семейства кодов:
 *   ETP_* — коды справочника ГИС Торги (площадка, где идут госторги);
 *   остальные — коды площадок наших ЭТП-коннекторов (совпадают с частью
 *   sourceCode после префикса семейства, см. connector-etp-itender).
 */
export const ETP_LABELS: Record<string, string> = {
  // справочник ГИС Торги
  ETP_SBAST: 'Сбербанк-АСТ',
  ETP_RTS: 'РТС-тендер',
  ETP_MMVB: 'НЭП (ММВБ)',
  ETP_RAD: 'Российский аукционный дом',
  ETP_EETP: 'ЕЭТП (Росэлторг)',
  ETP_GPB: 'ЭТП Газпромбанка',
  ETP_TEKTORG: 'ТЭК-Торг',
  ETP_AGZRT: 'Заказ РФ (agzrt)',
  ETP_ETPRF: 'ЭТП РФ',
  // семейство iTender (банкротство)
  utender: 'uTender',
  centerr: 'ЭП Центра реализации',
  bepspb: 'Балтийская ЭП',
  arbitat: 'Арбитат',
  'meta-invest': 'МЕТА-ИНВЕСТ',
  tendergarant: 'Тендер Гарант',
  gloria: 'ЭТП «Регион»',
  'tender-one': 'Единая торговая ЭП',
  torgibankrot: 'Южная ЭТП',
  etpu: 'Уральская ЭТП',
  utpl: 'Объединенная ТП',
  ets24: 'ЭТС24',
  arbbitlot: 'Арббитлот',
  zakazrf: 'ЭТП «Заказ РФ»',
  // одиночки со своим коннектором
  mets: 'МЭТС',
};

/** Человекочитаемое имя площадки; неизвестный код показываем как есть, без ETP_ */
export function etpName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return ETP_LABELS[code] ?? code.replace(/^ETP_/, '');
}
