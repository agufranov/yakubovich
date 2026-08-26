import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  KIND_LABELS,
  lotIdFromSlug,
  lotSlug,
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
import { fileUrl } from '@/lib/site';

interface Props {
  params: Promise<{ slug: string }>;
}

/**
 * Все карточки рендерятся заранее: на GitHub Pages рендерить в момент запроса
 * некому, а для SEO (docs/08 — главный канал трафика) страница лота должна быть
 * готовым HTML, а не пустой оболочкой с фетчем.
 */
export function generateStaticParams(): { slug: string }[] {
  return getStore()
    .loadLots()
    .map((lot) => ({ slug: lotSlug(lot.id) }));
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug } = await props.params;
  const lot = getStore().getLot(lotIdFromSlug(slug));
  return { title: lot ? lot.title.slice(0, 90) : 'Лот не найден' };
}

function fmtSize(bytes?: number): string | undefined {
  if (bytes == null) return undefined;
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default async function LotPage(props: Props) {
  const { slug } = await props.params;
  const lot = getStore().getLot(lotIdFromSlug(slug));
  if (!lot) notFound();

  const region = regionName(lot.regionCode);
  const left = daysLeft(lot.biddEndAt);
  const [cover, ...moreImages] = lot.images;
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
          {cover && (
            <div className="panel gallery">
              <div className="main">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl(cover)} alt={lot.title} />
              </div>
              {moreImages.length > 0 && (
                <div className="thumbs">
                  {moreImages.map((img) => (
                    <a key={img} href={fileUrl(img)} target="_blank" rel="noopener">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={fileUrl(img)} alt="" loading="lazy" />
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
                  <a key={f.fileId} href={fileUrl(f.fileId)} target="_blank" rel="noopener">
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
                  <Link key={p.id} href={`/lot/${lotSlug(p.id)}`}>
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
