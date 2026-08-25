import { HttpClient } from '../../packages/connector-core/src/http';
const http = new HttpClient({ minIntervalMs: 1000 });
const B = 'https://torgi.gov.ru/new/api/public/lotcards/search';
const candidates = [
  'pubFrom=1754006400000',                       // epoch ms
  'pubFrom=2026-08-01',                          // date only
  'pubFrom=01.08.2026',                          // ru
  'pubFrom=2026-08-01T00%3A00%3A00.000Z',        // ISO с экранированием
  'pubFrom=2026-08-01T00%3A00%3A00Z',
];
for (const q of candidates) {
  try {
    const d = await http.getJson<{ totalElements?: number }>(`${B}?size=1&page=0&biddType=229FZ&${q}`);
    console.log(`${decodeURIComponent(q)} -> OK totalElements=${d.totalElements}`);
  } catch (e) {
    console.log(`${decodeURIComponent(q)} -> ${(e as Error).message.slice(0, 50)}`);
  }
}
