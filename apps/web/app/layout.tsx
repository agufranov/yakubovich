import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { NavProgress } from '@/components/NavProgress';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'ЛотАрхив — имущество с торгов', template: '%s — ЛотАрхив' },
  description:
    'Лоты с государственных и банкротных торгов: арестованное имущество, приватизация. Поиск, карточки, переход на площадку.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        {/* useSearchParams требует Suspense-границу */}
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <header className="site-header">
          <div className="inner">
            <Link href="/" className="brand">
              Лот<span className="accent">Архив</span>
            </Link>
            <nav className="site-nav">
              <Link href="/">Каталог</Link>
              <Link href="/sources">Источники</Link>
              <Link href="/status">Статус проекта</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
