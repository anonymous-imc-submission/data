import json
from pathlib import Path

import pandas as pd

here = Path(__file__).parent


def write_collection(name, urls):
    with (here / f"{name}.json").open("w", newline="\n") as f:
        json.dump(urls, f, indent=4)


if __name__ == "__main__":
    tags = pd.read_feather(here / "../../snapshot-captures/cmps.feather")

    cmps = {
        "cmp_quantcast": "quantcast.com",
        "cmp_sourcepoint": "sourcepoint.com",
        "cmp_onetrust": "onetrust.com",
    }
    for name, id in cmps.items():
        write_collection(
            name,
            tags[tags.js_cmp_id == id].url.tolist()
        )
    for dataset in ["dach", "ukie"]:
        write_collection(
            f"cmp_{dataset}",
            tags[(tags.dataset == dataset) & tags.js_cmp_id.isin(cmps.values())].url.tolist()
        )

    keywords = pd.read_feather(here / "../../snapshot-captures/keywords.feather")

    for keyword, items in keywords.groupby("keyword"):
        for dataset in ["dach", "ukie"]:
            write_collection(
                f"keyword_{keyword}_{dataset}",
                items[items.dataset == dataset].url.tolist()
            )

    for collection in here.glob("../../search-results/*.json"):
        write_collection(
            f"search_{collection.stem}",
            json.loads(collection.read_bytes())
        )
