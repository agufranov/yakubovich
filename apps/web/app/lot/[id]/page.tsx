import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  KIND_LABELS,
  LEGAL_BASIS_LABELS,
  TRADE_KIND_LABELS,
  formatDate,
  formatDateTime,
  formatMoney,
  regionName,
  daysLeft,
  plural,
} from '@bankrot/shared';
import { StatusChip } from '@/components/bits';
import { getStore } from '@/lib/data';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { id } = await props.params;
  const lot = getStore().getLot(decodeURIComponent(id));
  return { title: lot ? lot.title.slice(0, 90) : 'Лот не найден' };
}

function fmtSize(bytes?: number): string | undefined {
  if (bytes == null) return undefined;
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default async function LotPage(props: Props) {
  const { id } = await props.params;
  const lot = getStore().getLot(decodeURIComponent(id));
  if (!lot) notFound();

  const region = regionName(lot.regionCode);
  const left = daysLeft(lot.biddEndAt);
  const prevLots = lot.prevProcedureIds
    .map((pid) => getStore().getLot(`${lot.sourceCode}:${pid}`))
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  return (
    <main className="page lot-page">
      <div className="crumbs">
        <Link href="/">Каталог</Link>
        {' · '}
        <Link href={`/?kind=${lot.kind}`}>{KIND_LABELS[lot.kind]}</Link>
        {region && (
          <>
            {' · '}
            <Link href={`/?region=${lot.regionCode}`}>{region}</Link>
          </>
        )}
      </div>

      <h1>{lot.title}</h1>
      <div className="sub">
        <StatusChip status={lot.status} statusRaw={lot.statusRaw} />
        <span className="chip">{LEGAL_BASIS_LABELS[lot.legalBasis]}</span>
        <span className="chip">{TRADE_KIND_LABELS[lot.tradeKind]}</span>
        {lot.categoryName && <span>{lot.categoryName}</span>}
      </div>

      <div className="lot-layout">
        <div>
          {lot.images.length > 0 && (
            <div className="panel gallery">
              <div className="main">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/file/${lot.images[0]}`} alt={lot.title} />
              </div>
              {lot.images.length > 1 && (
                <div className="thumbs">
                  {lot.images.slice(1).map((img) => (
                    <a key={img} href={`/api/file/${img}`} target="_blank" rel="noopener">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/file/${img}`} alt="" loading="lazy" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {lot.description && (
            <section className="panel">
              <h2>Описание</h2>
              <div className="desc">{lot.description}</div>
            </section>
          )}

          {lot.attributes.length > 0 && (
            <section className="panel">
              <h2>Характеристики</h2>
              <table className="attr-table">
                <tbody>
                  {lot.attributes.map((a) => (
                    <tr key={a.key}>
                      <td>{a.name}</td>
                      <td>
                        {a.value}
                        {a.unit ? ` ${a.unit}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {(lot.address || region) && (
            <section className="panel">
              <h2>Местоположение</h2>
              <div>{lot.address ?? region}</div>
            </section>
          )}

          {lot.attachments.length > 0 && (
            <section className="panel">
              <h2>Документы ({lot.attachments.length})</h2>
              <div className="files">
                {lot.attachments.map((f) => (
                  <a key={f.fileId} href={`/api/file/${f.fileId}`} target="_blank" rel="noopener">
                    <span>📎 {f.name}</span>
                    <span className="size">{fmtSize(f.size)}</span>
                  </a>
                ))}
              </div>
            </section>
          )}

          {prevLots.length > 0 && (
            <section className="panel">
              <h2>Предыдущие процедуры по этому имуществу</h2>
              <div className="files">
                {prevLots.map((p) => (
                  <Link key={p.id} href={`/lot/${encodeURIComponent(p.id)}`}>
                    {p.title.slice(0, 90)}
                  </Link>
                ))}
              </div>
            </section>
          )}

          <details className="raw">
            <summary>Служебные данные лота</summary>
            <pre>{JSON.stringify(lot, null, 2)}</pre>
          </details>
        </div>

        <aside className="lot-aside">
          <div className="aside-card">
            <div className="big-price">
              <small>Начальная цена</small>
              {formatMoney(lot.priceStart, lot.currency) ?? '—'}
            </div>

            <dl className="kv">
              {lot.priceStep && (
                <>
                  <dt>Шаг</dt>
                  <dd>{formatMoney(lot.priceStep, lot.currency)}</dd>
                </>
              )}
              {lot.deposit && (
                <>
                  <dt>Задаток</dt>
                  <dd>{formatMoney(lot.deposit, lot.currency)}</dd>
                </>
              )}
            </dl>

            <hr className="divider" />

            <dl className="kv">
              {lot.publishedAt && (
                <>
                  <dt>Опубликован</dt>
                  <dd>{formatDate(lot.publishedAt)}</dd>
                </>
              )}
              {lot.biddStartAt && (
                <>
                  <dt>Заявки с</dt>
                  <dd>{formatDateTime(lot.biddStartAt, lot.tzOffsetMin, lot.tzName)}</dd>
                </>
              )}
              {lot.biddEndAt && (
                <>
                  <dt>Заявки до</dt>
                  <dd className={left != null && left <= 3 ? 'hot' : ''}>
                    {formatDateTime(lot.biddEndAt, lot.tzOffsetMin, lot.tzName)}
                  </dd>
                </>
              )}
              {left != null && (
                <>
                  <dt>Осталось</dt>
                  <dd className={left <= 3 ? 'hot' : ''}>
                    {left === 0 ? 'меньше дня' : `${left} ${plural(left, 'день', 'дня', 'дней')}`}
                  </dd>
                </>
              )}
              {lot.auctionAt && (
                <>
                  <dt>Торги</dt>
                  <dd>{formatDateTime(lot.auctionAt, lot.tzOffsetMin, lot.tzName)}</dd>
                </>
              )}
            </dl>

            <hr className="divider" />

            <dl className="kv">
              {region && (
                <>
                  <dt>Регион</dt>
                  <dd>{region}</dd>
                </>
              )}
              {lot.etpCode && (
                <>
                  <dt>Площадка</dt>
                  <dd>{lot.etpCode.replace(/^ETP_/, '')}</dd>
                </>
              )}
            </dl>

            <a className="btn primary big" href={lot.sourceUrl} target="_blank" rel="noopener">
              Смотреть на torgi.gov.ru →
            </a>
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              Участие в торгах — на официальной площадке. Мы не проводим торги и не
              принимаем задатки.
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
