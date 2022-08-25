#!/usr/bin/env python3
import collections
import re
from datetime import date
from pathlib import Path

import click

from admeasure_py.utils import download_files_from_s3, s3_bucket, json

today = date.today().isoformat()

here = Path(__file__).parent

cache_dir = here / "cache"


@click.command()
@click.argument("prefix", default=f"consent-test/{today}", required=False)
def cli(prefix):
    bucket = s3_bucket()
    s3_manager_files = []
    s3_modal_files = []

    for file in bucket.objects.filter(Prefix=prefix):
        if file.key.endswith("sourcepoint-manager.json"):
            s3_manager_files.append(file)
        elif file.key.endswith("sourcepoint-modal.json"):
            s3_modal_files.append(file)

    print(f"{len(s3_modal_files)} modal and {len(s3_manager_files)} manager files found.")

    manager_files = download_files_from_s3(cache_dir, s3_manager_files).values()
    modal_files = download_files_from_s3(cache_dir, s3_modal_files).values()

    manager_data = [
        json.loads(f.read_bytes())
        for f in manager_files
    ]

    modal = [json.loads(f.read_bytes()) for f in modal_files]
    types = [m["types"] for m in manager_data]
    buttons = [m["buttons"] for m in manager_data]
    actions = [m["actions"] for m in manager_data]
    actionsParents = [m["actionParents"] for m in manager_data]

    patterns = {
        group: [re.compile(p, re.I) for p in patterns]
        for group, patterns in json.loads((here / "../runner/strategies/patterns.json").read_bytes()).items()
    }

    def can_pick(buttons: list[str], match_rex: list[re.Pattern], avoid_rex: list[re.Pattern]) -> bool:
        # remove duplicates and emptystr
        buttons = {b.strip() for b in buttons}
        buttons.discard("")
        buttons = list(buttons)

        if any(
            rex.search(btn)
            for rex in match_rex
            for btn in buttons
        ):
            return True
        not_avoided = [
            btn
            for btn in buttons
            if not any(rex.search(btn) for rex in avoid_rex)
        ]
        if len(not_avoided) == 1 and len(buttons) > 1:
            return True
        return False

    single_choice = [btns for btns in modal if len(btns) == 1]
    multiple_choice = [btns for btns in modal if len(btns) > 1]

    print("# Sourcepoint Modal Single choice: Cannot accept")
    for btns in single_choice:
        if not can_pick(btns, patterns["accept"], patterns["prefs"]):
            print(btns[0])

    print("# Sourcepoint Modal Multiple choice: Cannot accept")
    for btns in multiple_choice:
        if not can_pick(btns, patterns["accept"], patterns["prefs"]):
            print([x.lower() for x in btns])

    print("# Sourcepoint Modal Multiple choice: Cannot open prefs")
    for btns in multiple_choice:
        if not can_pick(btns, patterns["prefs"], patterns["accept"]):
            print([x.lower() for x in btns])

    print("# Sourcepoint Actions")
    for btns, btnsParents in zip(actions, actionsParents):
        if not btns:
            continue
        if not can_pick(btns, patterns["legInt"], patterns["gvl"]):
            if not can_pick(btnsParents, patterns["legInt"], patterns["gvl"]):
                print([x.lower() for x in btns], "->", [x.lower() for x in btnsParents])

    print("# Sourcepoint Save Buttons")
    for btns in buttons:
        if not can_pick(btns, patterns["save"], patterns["accept"]):
            print([x.lower() for x in btns])

    print("# Sourcepoint Types")
    c = collections.Counter([t for lst in types for t in lst])
    for t, c in c.most_common():
        print(f"{c}x {t}")




if __name__ == "__main__":
    cli()
