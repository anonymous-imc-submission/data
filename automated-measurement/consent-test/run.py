#!/usr/bin/env python3
from datetime import date
from pathlib import Path

import click
import pandas as pd
import statsmodels.formula.api as smf

from admeasure_py.utils import bash, download_files_from_s3, get_from_s3, json, s3_bucket

today = date.today().isoformat()

here = Path(__file__).parent

cache_dir = here / "cache"


@click.group()
def cli():
    pass


@cli.command()
def measure():
    plan_file = here / f"../runner/plans/consent-test.js"
    if not plan_file.exists():
        plan_file = Path("/tmp/consent-test.js")
        plan_file.write_bytes(get_from_s3("resources/plans/consent-test.js"))
    bash(f"""
    node {plan_file} | adm vm spawn -
    """)


@cli.command()
@click.argument("prefix", default=f"consent-test/{today}", required=False)
def analyze(prefix):
    bucket = s3_bucket()
    s3_consent_files = []
    s3_plan_files = []

    for file in bucket.objects.filter(Prefix=prefix):
        if file.key.endswith("consent.json"):
            s3_consent_files.append(file)
        elif file.key.endswith("plan.json"):
            s3_plan_files.append(file)

    print(f"{len(s3_plan_files)} plans and {len(s3_consent_files)} consent files found.")

    if len(s3_plan_files) == len(s3_consent_files) == 0:
        return

    consent_files = download_files_from_s3(cache_dir, s3_consent_files)
    plan_files = download_files_from_s3(cache_dir, s3_plan_files).values()

    plans = {}
    for f in plan_files:
        data = json.loads(f.read_bytes())
        plans[data["id"]] = data

    contents = {}
    for id, f in consent_files.items():
        data = json.loads(f.read_bytes())
        site_id = id.rpartition("/")[0]
        plan_id = site_id.rpartition("/")[0]
        data["plan"] = plans[plan_id]
        data["id"] = site_id
        contents[site_id] = data

    for c in contents.values():
        if c["version"] == 2:
            tcData = c["tcData"].get("useractioncomplete") or c["tcData"].get("tcloaded") or {}
            c["cmpId"] = tcData.get("cmpId") or (c["pingLoaded"] or {}).get("cmpId") or (c["pingWaiting"] or {}).get(
                "cmpId")

    df = pd.DataFrame(contents.values())
    df = df[df.cmpId.isin([6, 10, 28])]

    def outcome(row):
        if row.consent is None:
            return "0_err"
        if row.consent and row.legInt:
            return "4_both"
        if row.consent:
            return "3_consent"
        if row.legInt:
            return "2_legInt"
        return "1_neither"

    def correctness(row):
        should_accept = row.strategy == "consent_accept"
        if should_accept == row.consent == row.legInt:
            return 1
        if row.consent == row.legInt:
            return 0
        return 0.25

    df["outcome"] = df.apply(outcome, axis=1)
    df["correctness"] = df.apply(correctness, axis=1)
    df["cmp"] = df.cmpId.apply(lambda id: {6: "Sourcepoint", 10: "Quantcast", 28: "OneTrust"}[id])
    df["location"] = df.plan.apply(lambda p: p["region"])
    df["device"] = df.plan.apply(lambda p: p["device"]["type"])
    df = df[
        ["cmp", "url", "location", "device", "strategy", "consent", "legInt", "outcome", "correctness", "id"]
    ].reset_index(drop=True)
    df.to_feather("results.feather")

    dist = df.groupby(["cmp", "strategy"]).outcome.value_counts(normalize=True).unstack(fill_value=0)
    print(dist)

    with (here / "stats.tex").open("w", newline="\n") as f:
        for (cmp, strategy), data in dist.iterrows():
            strategy = strategy.split("_")[1].title()
            for outcome, val in data.items():
                outcome = outcome.split("_")[1].title()
                x = r"\providecommand{\%s%s%s}{%.4f}" % (cmp, strategy, outcome, val)
                print(x)
                print(x, file=f)

    print(
        smf.glm("correctness ~ location : strategy : cmp - 1", df).fit().summary()
    )
    print(
        smf.glm("correctness ~ device : cmp - 1", df).fit().summary()
    )

    df.groupby(["cmp", "strategy"])["outcome"].value_counts().unstack(0).unstack(0).plot.bar(
        subplots=True, figsize=(10, 10), layout=(3, 2)
    )[0][0].figure.savefig(str(here / "crosstab.png"))

    click.secho("group samples:", fg="green")
    for (cmp, strategy, outcome), rows in df.groupby(["cmp", "strategy", "outcome"]):
        if strategy == "consent_accept":
            strategy = "accept ✔️"
            outcome = {
                          "0_err": "🔴",
                          "1_neither": "🔴",
                          "2_legInt": "🔴",
                          "3_consent": "🟡",
                          "4_both": "🟢",
                      }[outcome] + " " + outcome[2:]
        else:
            strategy = "reject ❌"
            outcome = {
                          "0_err": "🔴",
                          "1_neither": "🟢",
                          "2_legInt": "🟡",
                          "3_consent": "🔴",
                          "4_both": "🔴",
                      }[outcome] + " " + outcome[2:]

        click.secho(f"{len(rows):4d} {cmp} {strategy}: {outcome}", fg="yellow")
        if outcome.startswith("🟢"):
            pass
            # click.secho("     (skipped)", dim=True)
            # continue
        for _, sample in rows.sample(min(5, len(rows))).iterrows():
            print(
                f"     {sample.id} node main.js t -s {sample.strategy} -u {sample.url}")


if __name__ == "__main__":
    cli()
