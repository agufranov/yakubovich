import Link from 'next/link';
import { formatMoney, lotSlug, regionName } from '@bankrot/shared';
import type { DumpLot } from '@/lib/dump';
import { fileUrl } from '@/lib/site';
import { KIND_ICONS, StatusChip, cardAttributes, deadlineInfo } from './bits';

export function LotCard({ lot }: { lot: DumpLot }) {
  const price = formatMoney(lot.priceStart, lot.currency);
  const deadline = deadlineInfo(lot);
  const attrs = cardAttributes(lot);
  const region = regionName(lot.regionCode);

  return (
    <Link href={`/lot/${lotSlug(lot.id)}`} className="lot-card">
      <div className="thumb">
        {lot.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fileUrl(lot.images[0])} alt="" loading="lazy" />
        ) : (
          <span className="placeholder" aria-hidden>
            {KIND_ICONS[lot.kind]}
          </span>
        )}
        <span className="status">
          <StatusChip status={lot.status} statusRaw={lot.statusRaw} />
        </span>
      </div>
      <div className="body">
        <div className="price">{price ?? <span className="none">цена не указана</span>}</div>
        <div className="title">{lot.title}</div>
        {attrs.length > 0 && (
          <div className="chip-row">
            {attrs.map((a) => (
              <span key={a} className="chip outline">
                {a}
              </span>
            ))}
          </div>
        )}
        <div className="meta">
          <span>{region ?? ' '}</span>
          {deadline && <span className={`deadline${deadline.soon ? ' soon' : ''}`}>{deadline.text}</span>}
        </div>
      </div>
    </Link>
  );
}
