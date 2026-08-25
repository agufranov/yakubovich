import { HttpClient } from '../../packages/connector-core/src/http';
const http = new HttpClient({ minIntervalMs: 1000 });
const B = 'https://torgi.gov.ru/new/api/public/lotcards/search';
for (const q of [
  'pubFrom=2026-08-20&pubTo=2026-08-22',
  'pubTo=2026-01-01',                    // глубина архива источника
  'pubFrom=2026-08-01&dynSubjRF=77',     // комбинирование срезов
]) {
  try {
    const d = await http.getJson<{ totalElements?: number }>(`${B}?size=1&page=0&biddType=229FZ&${q}`);
    console.log(`${q} -> ${d.totalElements}`);
  } catch (e) {
    console.log(`${q} -> ${(e as Error).message.slice(0, 50)}`);
  }
}
