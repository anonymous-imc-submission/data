#!/usr/bin/env python3
from datetime import date
from pathlib import Path

import click

from admeasure_py.utils import download_files_from_s3, normalize_id, s3_bucket, json

today = date.today().isoformat()

here = Path(__file__).parent

cache_dir = here / "cache"


@click.group()
def cli():
    pass


def log_files_for_prefix(prefix: str, job: bool = True, site: bool = True) -> tuple[dict[str, Path], dict[str, Path]]:
    prefix = normalize_id(prefix)
    bucket = s3_bucket()

    s3_site_files = []
    s3_job_files = []
    for file in bucket.objects.filter(Prefix=prefix):
        if site and file.key.endswith("console.json"):
            s3_site_files.append(file)
        if job and file.key.endswith("measure.json") or file.key.endswith("prime.json"):
            s3_job_files.append(file)

    print(f"{len(s3_site_files) + len(s3_job_files)} log files found.")

    site_files = download_files_from_s3(cache_dir, s3_site_files)
    job_files = download_files_from_s3(cache_dir, s3_job_files)

    return site_files, job_files


@cli.command()
@click.argument("prefix")
def show(prefix: str):
    site_files, job_files = log_files_for_prefix(prefix, True, True)

    logentries = []
    for f in site_files.values():
        logentries.extend(
            x for x in
            json.loads(f.read_bytes())
            if x["part"].startswith("measure-") or x["part"].startswith("prime-")
        )
    for f in job_files.values():
        logentries.extend(json.loads(f.read_bytes())["log"])

    logentries.sort(key=lambda e: e["time"])

    click.echo_via_pager(
        "\n" + click.style(f"[{l['part']}] ", fg="blue") + l['text']
        for l in logentries
    )


@cli.command()
@click.argument("pattern")
@click.argument("prefix", default=f"eval/{today}", required=False)
def grep(pattern: str, prefix: str):
    pattern = pattern.lower()

    site_files, job_files = log_files_for_prefix(prefix, True, True)

    for id, f in sorted(list(site_files.items()) + list(job_files.items())):
        messages = json.loads(f.read_bytes())
        if id in job_files:
            messages = messages["log"]
        for message in messages:
            if pattern in message["text"].lower():
                print(click.style(f"[{id.rpartition('/')[0]}]", fg="cyan"), message["text"])


if __name__ == "__main__":
    cli()
