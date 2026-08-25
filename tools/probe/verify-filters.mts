import { HttpClient } from '../../packages/connector-core/src/http';
const http = new HttpClient({ minIntervalMs: 900 });
const B = 'https://torgi.gov.ru/new/api/public/lotcards/search';
const tests: [string, string][] = [
  ['dynSubjRF=77', 'dynSubjRF=ZZZ'],
  ['subjectRFCode=77', 'subjectRFCode=ZZZ'],
  ['catCode=2', 'catCode=ZZZGARBAGE'],
  ['biddEndFrom=2026-09-01T00:00:00.000Z', 'biddEndFrom=GARBAGE'],
  ['pubFrom=2026-08-01T00:00:00.000Z', 'pubFrom=GARBAGE'],
  ['noticeDateFrom=2026-08-01', 'noticeDateFrom=GARBAGE'],
];
for (const pair of tests) {
  const out: string[] = [];
  for (const q of pair) {
    try {
      const d = await http.getJson<{ totalElements?: number }>(`${B}?size=1&page=0&biddType=229FZ&${q}`);
      out.push(`${q} -> ${d.totalElements}`);
    } catch (e) {
      out.push(`${q} -> ERR ${(e as Error).message.slice(0, 60)}`);
    }
  }
  console.log(out.join('  |  '));
}
