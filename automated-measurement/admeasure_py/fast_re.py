#!/usr/bin/env python3
import re
import warnings
import threading

from admeasure_py.utils import keywords, timeit

search_terms: list[str] = [
    term
    for group in keywords().values()
    for term in group["patterns"]
]
search_terms_bytes = [x.encode() for x in search_terms]
search_terms_rex: re.Pattern[bytes] = re.compile(
    b"|".join(search_terms_bytes),
    re.IGNORECASE
)


def _count_matches_re(x: bytes) -> dict[str, int]:
    matches: dict[str, int] = {
        t: 0
        for t in search_terms
    }
    for match in search_terms_rex.findall(x):
        for t in search_terms_bytes:
            if re.match(t, match, re.IGNORECASE):
                matches[t.decode()] += 1
                break
        else:
            raise RuntimeError(f"None of the individual patterns match: {match}")
    return matches


try:
    import hyperscan

    hyperscan_lock = threading.Lock()
    db = hyperscan.Database()
    db.compile(
        expressions=search_terms_bytes,
        elements=len(search_terms_bytes),
        ids=list(range(len(search_terms_bytes))),
        flags=hyperscan.HS_FLAG_CASELESS
    )


    def _count_matches_hyperscan(data):
        matches: dict[str, int] = {
            t: 0
            for t in search_terms
        }

        def on_match(id: int, from_: int, to: int, flags: int, context):
            matches[search_terms[id]] += 1

        with hyperscan_lock:
            db.scan(data, match_event_handler=on_match)
        return matches


    count_matches = _count_matches_hyperscan
except ImportError:
    warnings.warn("Using slow regex-based fallback.")
    count_matches = _count_matches_re

if __name__ == "__main__":
    assert _count_matches_hyperscan
    for text in [b"we want a four wheel drive suv, but fast!" * 100_000]:
        print(text[:100])
        with timeit("hyper"):
            hyper_results = _count_matches_hyperscan(text)
        with timeit("re"):
            re_results = _count_matches_re(text)
        if hyper_results != re_results:
            raise RuntimeError(f"{hyper_results=}\n{re_results=}")
        print({
            k: v
            for k, v in hyper_results.items()
            if v > 0
        })
