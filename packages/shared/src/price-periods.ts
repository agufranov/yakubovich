/**
 * Публичное предложение: цена падает по расписанию, и покупателя интересует
 * не начальная цена, а «сколько сейчас и когда станет дешевле». Здесь только
 * выводы из графика — сам график приходит от источника (docs/12-lotum.md).
 */
import type { PricePeriod } from './types';

export interface PriceSchedule {
  /** период, идущий прямо сейчас */
  current?: PricePeriod;
  /** следующий период — то есть ближайшее снижение */
  next?: PricePeriod;
  /** цена последнего периода: ниже нее лот не опустится */
  floor?: PricePeriod;
  /** сколько снижений еще впереди */
  stepsLeft: number;
}

export function readSchedule(periods: PricePeriod[] | undefined, now = Date.now()): PriceSchedule {
  if (!periods || periods.length === 0) return { stepsLeft: 0 };
  const sorted = [...periods].sort((a, b) => a.no - b.no);
  const started = (p: PricePeriod): boolean => !p.startAt || Date.parse(p.startAt) <= now;
  const ended = (p: PricePeriod): boolean => !!p.endAt && Date.parse(p.endAt) <= now;

  const current = sorted.find((p) => started(p) && !ended(p));
  const next = current
    ? sorted.find((p) => p.no > current.no)
    : // торги еще не начались — «следующий» это первый период
      sorted.find((p) => !started(p));
  const stepsLeft = current ? sorted.filter((p) => p.no > current.no).length : sorted.length;

  return { current, next, floor: sorted[sorted.length - 1], stepsLeft };
}
