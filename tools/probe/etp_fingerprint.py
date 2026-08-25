# -*- coding: utf-8 -*-
"""
Снятие отпечатков с ЭТП банкротства.

Задача: проверить гипотезу об общих white-label-движках. Если значительная часть
из 49 площадок работает на одном движке, коннекторов нужно не 49, а число движков.

Вход:  tools/probe/etp_list.json  (выгружен из реестра tbankrot)
Выход: отчет в stdout + tools/probe/out/etp_fingerprint.json

Скрипт только читает публичные главные страницы, по одному запросу на площадку.
"""
import concurrent.futures as cf
import io
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

# Признаки движков. Ищем в HTML и в заголовках ответа.
ENGINES = {
    "iTender":    [r"itender", r"iTender"],
    "Bitrix":     [r"bitrix", r"BX\.", r"bx-", r"/local/templates/"],
    "ASP.NET":    [r"__VIEWSTATE", r"asp\.net", r"\.aspx"],
    "Angular":    [r"ng-version", r"<app-root", r"runtime\.[0-9a-f]+\.js"],
    "React":      [r"__NEXT_DATA__", r"react(-dom)?[.-]", r"data-reactroot"],
    "Vue":        [r"vue(\.min)?\.js", r"data-v-[0-9a-f]{8}", r"__NUXT__"],
    "Laravel":    [r"laravel_session", r"csrf-token"],
    "1C-Bitrix":  [r"1C-Bitrix"],
    "jQuery":     [r"jquery[.-]"],
}


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               "Accept": "text/html,*/*",
                                               "Accept-Language": "ru-RU,ru;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.status, dict(r.headers), r.read(200_000)


def probe(entry):
    url = entry["url"]
    out = {"name": entry["name"], "url": url, "status": None, "title": "",
           "server": "", "powered": "", "engines": [], "note": ""}
    try:
        st, hdrs, body = fetch(url)
    except urllib.error.HTTPError as e:
        out["status"] = e.code
        out["note"] = "HTTP error"
        return out
    except Exception as e:
        out["note"] = type(e).__name__ + ": " + str(e)[:70]
        return out

    out["status"] = st
    out["server"] = hdrs.get("Server", "")[:40]
    out["powered"] = hdrs.get("X-Powered-By", "")[:40]

    # Кодировка: у части площадок windows-1251
    enc = "utf-8"
    m = re.search(rb'charset=["\']?\s*([\w-]+)', body[:3000], re.I)
    if m:
        enc = m.group(1).decode("ascii", "ignore").lower()
    try:
        text = body.decode(enc, "replace")
    except LookupError:
        text = body.decode("utf-8", "replace")

    t = re.search(r"<title[^>]*>(.*?)</title>", text, re.S | re.I)
    out["title"] = re.sub(r"\s+", " ", t.group(1)).strip()[:70] if t else ""

    hay = text + " " + json.dumps(hdrs)
    for eng, pats in ENGINES.items():
        if any(re.search(p, hay, re.I) for p in pats):
            out["engines"].append(eng)
    return out


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    entries = json.load(io.open(os.path.join(here, "etp_list.json"), encoding="utf-8"))["Банкротство"]

    results = []
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        for r in ex.map(probe, entries):
            results.append(r)

    ok = [r for r in results if r["status"] == 200]
    print(f"Площадок: {len(results)}, ответили 200: {len(ok)}\n")

    print(f"{'площадка':<34} {'код':<5} {'сервер':<22} движок")
    print("-" * 100)
    for r in results:
        eng = ", ".join(e for e in r["engines"] if e != "jQuery") or "-"
        print(f"{r['name'][:32]:<34} {str(r['status'] or 'ERR'):<5} "
              f"{(r['server'] or r['note'][:20])[:20]:<22} {eng[:40]}")

    print("\n=== Сводка по движкам ===")
    tally = {}
    for r in results:
        for e in r["engines"]:
            tally[e] = tally.get(e, 0) + 1
    for e, n in sorted(tally.items(), key=lambda x: -x[1]):
        print(f"  {e:<12} {n}")

    outdir = os.path.join(here, "out")
    os.makedirs(outdir, exist_ok=True)
    json.dump(results, io.open(os.path.join(outdir, "etp_fingerprint.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"\nПодробности: {os.path.join(outdir, 'etp_fingerprint.json')}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
