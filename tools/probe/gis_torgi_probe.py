# -*- coding: utf-8 -*-
"""
Разведка API ГИС Торги (torgi.gov.ru).

Воспроизводит факты, зафиксированные в docs/research/gis-torgi-api.md:
  - перечень типов торгов (biddType) и отсутствие среди них банкротства;
  - работоспособность фильтров (контрольная проверка бессмысленным значением);
  - жесткий кламп size до 10 записей на страницу;
  - потолок выдачи в 10 000 записей (страницы 0..999);
  - структура карточки лота и нормализованные characteristics.

Запуск:  python tools/probe/gis_torgi_probe.py > probe.txt

ВНИМАНИЕ: скрипт отключает проверку TLS, потому что torgi.gov.ru использует
сертификат российского УЦ. Это допустимо ТОЛЬКО для разведки. В боевых коннекторах
ставится корневой сертификат в образ — см. docs/research/grabli.md.
"""
import collections
import json
import ssl
import sys
import urllib.error
import urllib.request

BASE = "https://torgi.gov.ru/new/api/public"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode = ssl.CERT_NONE


def get_json(path, timeout=40):
    url = path if path.startswith("http") else BASE + path
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ctx) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300].decode("utf-8", "replace")
    except Exception as e:
        return None, str(e)[:150]


def total(params):
    st, d = get_json(f"/lotcards/search?size=1&page=0&{params}")
    return d.get("totalElements") if isinstance(d, dict) else f"ERR {st} {d}"


def check_filter_works(param, real_value):
    """Единственный надежный способ проверить фильтр: подать бессмыслицу.
    0 -> фильтр работает. 10000 -> параметр молча игнорируется."""
    garbage = total(f"{param}=ZZZ_NONSENSE_ZZZ")
    real = total(f"{param}={real_value}")
    verdict = "работает" if garbage == 0 else "ИГНОРИРУЕТСЯ"
    print(f"  {param:<16} мусор={garbage:<8} {real_value}={real:<8} -> {verdict}")


def enumerate_bidd_types(pages=8):
    """Перебор типов торгов по нескольким срезам выдачи."""
    seen, names, etps = collections.Counter(), {}, collections.Counter()
    for q in ("sort=firstVersionPublicationDate,desc",
              "sort=firstVersionPublicationDate,asc",
              "sort=priceMin,desc",
              "lotStatus=PUBLISHED",
              "lotStatus=APPLICATIONS_SUBMISSION"):
        for page in range(pages):
            st, d = get_json(f"/lotcards/search?size=50&page={page}&{q}")
            if st != 200 or not isinstance(d, dict):
                break
            for lot in d.get("content", []):
                bt = lot.get("biddType") or {}
                seen[bt.get("code")] += 1
                names[bt.get("code")] = (bt.get("name") or "")[:120]
                if lot.get("etpCode"):
                    etps[lot["etpCode"]] += 1
    return seen, names, etps


def main():
    print("=== 1. Работают ли фильтры ===")
    check_filter_works("biddType", "ZK")

    print("\n=== 2. Есть ли банкротство (127-ФЗ)? ===")
    for code in ("127FZ", "FZ127", "BANKROT", "BANKRUPT", "BANKRUPTCY", "KP", "BFL"):
        print(f"  biddType={code:<12} -> {total(f'biddType={code}')}")
    print("  Ожидаемый результат: везде 0. Банкротства в ГИС Торги нет.")

    print("\n=== 3. Какие типы торгов существуют ===")
    seen, names, etps = enumerate_bidd_types()
    for code, n in seen.most_common():
        print(f"  {code:<16} n={n:<5} {names.get(code)}")
    print("\n  Площадки (etpCode):", ", ".join(f"{k}={v}" for k, v in etps.most_common(15)))

    print("\n=== 4. Ограничение размера страницы ===")
    print("  size клампится до 10; о чем сервер сообщает только в pageable.pageSize")
    for size in (5, 10, 50, 200):
        st, d = get_json(f"/lotcards/search?size={size}&page=0")
        if isinstance(d, dict):
            print(f"  запросили size={size:<4} получили n={d['numberOfElements']:<3} "
                  f"pageSize={d['pageable']['pageSize']:<3} totalPages={d['totalPages']}")

    print("\n=== 5. Граница пагинации ===")
    print("  доступны страницы 0..999; page=1000 отдает 200 OK с ПУСТЫМ телом")
    for page in (0, 999, 1000):
        st, d = get_json(f"/lotcards/search?size=10&page={page}")
        if isinstance(d, dict):
            print(f"  page={page:<5} -> n={d.get('numberOfElements')} total={d.get('totalElements')}")
        else:
            print(f"  page={page:<5} -> НЕ JSON: {str(d)[:70]}")

    print("\n=== 6. Структура карточки лота ===")
    st, d = get_json("/lotcards/search?size=1&page=0&biddType=229FZ")
    if isinstance(d, dict) and d.get("content"):
        lot_id = d["content"][0]["id"]
        st, card = get_json(f"/lotcards/{lot_id}")
        if isinstance(card, dict):
            print(f"  id={lot_id}")
            print(f"  поля: {', '.join(sorted(card.keys()))}")
            chars = [c.get("code") for c in card.get("characteristics") or []]
            print(f"  characteristics: {', '.join(chars)}")
            print(f"  вложений: {len(card.get('lotAttachments') or [])}, "
                  f"изображений: {len(card.get('lotImages') or [])}")


if __name__ == "__main__":
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    main()
