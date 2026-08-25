import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="page">
      <div className="empty">
        <p>Такого лота у нас нет — возможно, он ушел в архив под другим адресом.</p>
        <Link href="/">Вернуться в каталог</Link>
      </div>
    </main>
  );
}
