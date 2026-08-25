'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Заметная индикация навигации: полоса сверху, спиннер, затемнение контента.
 * Страницы серверные, фильтры — обычные ссылки; без этого клик по фасету
 * не дает никакой реакции, пока сервер не отрендерит новую выдачу.
 */
export function NavProgress() {
  const [busy, setBusy] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // URL изменился — навигация завершена
  useEffect(() => {
    setBusy(false);
    clearTimeout(timer.current);
  }, [pathname, search]);

  useEffect(() => {
    const start = () => {
      setBusy(true);
      // страховка: если навигация не случилась (ошибка сети и т.п.) — снять
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setBusy(false), 10_000);
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a');
      if (!a || a.target || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      // клик по ссылке на текущий URL — навигации не будет
      if (url.pathname === location.pathname && url.search === location.search) return;
      start();
    };
    // GET-формы (поиск, сортировка) уходят полной перезагрузкой страницы
    const onSubmit = (e: SubmitEvent) => {
      if (!e.defaultPrevented) start();
    };
    const onPop = () => start();
    // возврат из bfcache после полной навигации — состояние компонента могло остаться busy
    const onPageShow = () => setBusy(false);

    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    window.addEventListener('popstate', onPop);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('pageshow', onPageShow);
      clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('nav-busy', busy);
    return () => document.documentElement.classList.remove('nav-busy');
  }, [busy]);

  if (!busy) return null;
  return (
    <>
      <div className="nav-bar" aria-hidden />
      <div className="nav-spinner" role="status" aria-label="Загрузка" />
    </>
  );
}
