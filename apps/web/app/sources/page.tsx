/**
 * Состояние источников — наблюдаемость с первого дня (docs/03, решение №6:
 * коннектор ломается молча; смотрим на объемы, а не на исключения).
 */
import type { Metadata } from 'next';
import { formatDateTime } from '@bankrot/shared';
import { getStore } from '@/lib/data';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Источники' };

export default function SourcesPage() {
  const store = getStore();
  const runs = store.loadRuns().slice(-50).reverse();
  const lots = store.loadLots();

  const bySource = new Map<string, number>();
  for (const lot of lots) bySource.set(lot.sourceCode, (bySource.get(lot.sourceCode) ?? 0) + 1);

  return (
    <main className="page">
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Источники</h1>

      <section className="panel">
        <h2>Лоты в базе</h2>
        <table className="runs-table">
          <thead>
            <tr>
              <th>Источник</th>
              <th>Лотов</th>
            </tr>
          </thead>
          <tbody>
            {[...bySource].map(([code, count]) => (
              <tr key={code}>
                <td>{code}</td>
                <td>{count.toLocaleString('ru-RU')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Прогоны коннекторов (свежие сверху)</h2>
        {runs.length === 0 ? (
          <p>Прогонов еще не было. Запустить: <code>npm run ingest</code></p>
        ) : (
          <table className="runs-table">
            <thead>
              <tr>
                <th>Источник</th>
                <th>Когда</th>
                <th>Стр.</th>
                <th>Увидено</th>
                <th>Новых</th>
                <th>Изм.</th>
                <th>Карточек</th>
                <th>HTTP err</th>
                <th>Parse err</th>
                <th>Прим.</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r, i) => (
                <tr key={i}>
                  <td>{r.sourceCode}</td>
                  <td>{formatDateTime(r.finishedAt, 180, 'МСК')}</td>
                  <td>{r.pagesScanned}</td>
                  <td>{r.itemsSeen}</td>
                  {/* ноль увиденного при ненулевых страницах — главный признак молчаливой поломки */}
                  <td className={r.itemsSeen > 0 && r.itemsNew + r.itemsChanged + r.itemsUnchanged === 0 ? 'warn' : ''}>
                    {r.itemsNew}
                  </td>
                  <td>{r.itemsChanged}</td>
                  <td>{r.cardsFetched}</td>
                  <td className={r.httpErrors > 0 ? 'warn' : ''}>{r.httpErrors}</td>
                  <td className={r.parseErrors > 0 ? 'warn' : ''}>{r.parseErrors}</td>
                  <td>{r.aborted ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="footnote">
        Алерты на аномалии объема (а не на исключения) — следующий шаг наблюдаемости.
      </p>
    </main>
  );
}
