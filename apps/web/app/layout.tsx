import type { Metadata } from 'next';
import Link from 'next/link';
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
        <header className="site-header">
          <div className="inner">
            <Link href="/" className="brand">
              Лот<span className="accent">Архив</span>
            </Link>
            <nav className="site-nav">
              <Link href="/">Каталог</Link>
              <Link href="/sources">Источники</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
