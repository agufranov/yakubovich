# -*- coding: utf-8 -*-
"""
Проверка семейства iTender среди ЭТП банкротства.

Воспроизводит выводы docs/research/etp-registry.md:
  - какие площадки из реестра отвечают на сигнатуру путей iTender;
  - идентичность структуры URL между ними;
  - механику пагинации (ASP.NET postback) и состав полей карточки лота.

Запуск: python tools/probe/etp_itender_probe.py

TLS не проверяется — только для разведки, см. docs/research/grabli.md.
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

# Замыкающий слэш обязателен: без него движок отдает 404.
LISTINGS = ("/public/auctions-all/", "/public/public-offers-all/")
LOT_RE = re.compile(r"/public/[\w-]+/lots/view/(\d+)/")


def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            return r.status, r.read(300_000)
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception:
        return None, b""


def decode(body):
    enc = "utf-8"
    m = re.search(rb'charset=["\']?\s*([\w-]+)', body[:3000], re.I)
    if m:
        enc = m.group(1).decode("ascii", "ignore").lower()
    try:
        return body.decode(enc, "replace")
    except LookupError:
        return body.decode("utf-8", "replace")


def root_of(url):
    return re.match(r"(https?://[^/]+)", url).group(1)


def check(entry):
    root = root_of(entry["url"])
    res = {"name": entry["name"], "url": entry["url"]}
    for path in LISTINGS:
        st, body = get(root + path)
        html = decode(body)
        res[path] = {"status": st,
                     "lots": len(set(LOT_RE.findall(html))),
                     "itender_marker": bool(re.search(r"itender", html, re.I))}
    a = res[LISTINGS[0]]
    res["is_itender"] = a["status"] == 200 and (a["lots"] > 0 or a["itender_marker"])
    return res


def describe_lot_card(url):
    """Состав полей карточки и механика пагинации."""
    st, body = get(url)
    if st != 200:
        print(f"  карточка недоступна: {url} -> {st}")
        return
    html = decode(body)
    pairs = re.findall(r"<t[dh][^>]*>\s*([^<>]{3,60}?)\s*:?\s*</t[dh]>\s*<td[^>]*>(.*?)</td>",
                       html, re.S)

    def clean(x):
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x)).strip()

    key_fields = ("ЕФРСБ", "Классификатор", "Начальная цена", "Шаг",
                  "Статус", "Повторные торги", "Дата")
    print(f"  {url}")
    seen = set()
    for k, v in pairs:
        k2, v2 = clean(k), clean(v)[:60]
        if k2 and v2 and k2 not in seen and any(f in k2 for f in key_fields):
            seen.add(k2)
            print(f"    {k2[:40]:<42} {v2}")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    entries = json.load(io.open(os.path.join(here, "etp_list.json"), encoding="utf-8"))["Банкротство"]

    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(check, entries))

    hits = [r for r in results if r["is_itender"]]
    print(f"=== Сигнатура iTender: {len(hits)} из {len(entries)} площадок ===\n")
    print(f"{'площадка':<34} {'аукционы':<12} {'публ.предл.':<12} лотов/стр")
    print("-" * 76)
    for r in hits:
        a, p = r[LISTINGS[0]], r[LISTINGS[1]]
        print(f"{r['name'][:32]:<34} {str(a['status']):<12} {str(p['status']):<12} {a['lots']}")

    print("\n=== Механика пагинации (ASP.NET postback) ===")
    if hits:
        st, body = get(root_of(hits[0]["url"]) + LISTINGS[0])
        html = decode(body)
        methods = re.findall(r'<form[^>]*method="(\w+)"', html, re.I)[:1]
        postbacks = html.count("__doPostBack")
        has_vs = "__VIEWSTATE" in html
        print(f"  __doPostBack: {postbacks}, __VIEWSTATE: {has_vs}, form method: {methods}")
        print("  -> обход списка требует POST с переносом __VIEWSTATE, а не GET по ?page=")

        print("\n=== Ключевые поля карточки лота ===")
        lots = LOT_RE.findall(html)
        if lots:
            sec = re.search(r"(/public/[\w-]+/lots/view/%s/)" % lots[0], html)
            if sec:
                describe_lot_card(root_of(hits[0]["url"]) + sec.group(1))

    outdir = os.path.join(here, "out")
    os.makedirs(outdir, exist_ok=True)
    json.dump(results, io.open(os.path.join(outdir, "etp_itender.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
