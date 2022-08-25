import base64
import concurrent.futures
import contextlib
import gzip
import io
import sys

import orjson as json
import re
import subprocess
import tempfile
import textwrap
import time
from collections.abc import Generator
from functools import cache
from pathlib import Path
from typing import TypeVar, TypedDict, Union

import boto3
import botocore.exceptions
from botocore.exceptions import ClientError
from mypy_boto3_s3 import Client
from mypy_boto3_s3.service_resource import Bucket, Object, ObjectSummary
from publicsuffix2 import PublicSuffixList

MeasurementPlanV3 = dict

here = Path(__file__).parent


def s3_bucket() -> Bucket:
    session = boto3.session.Session(profile_name="admeasure")
    bucket = session.resource(
        "s3",
        endpoint_url="https://s3.eu-central-1.amazonaws.com"
    ).Bucket("admeasure")
    return bucket


def s3_client() -> Client:
    return s3_bucket().meta.client  # type: ignore


@cache
def psl() -> PublicSuffixList:
    return PublicSuffixList(str(here / "public_suffix_list.dat"))


class KeywordGroup(TypedDict):
    queries_dach: list[str]
    queries_ukie: list[str]
    patterns: list[str]


@cache
def keywords() -> dict[str, KeywordGroup]:
    return json.loads((here / "keywords.json").read_bytes())


def domain_from_url(url: str) -> str:
    """Get the full domain from a URL."""
    start = url.find("//") + 2
    if start == 1:
        start = 0
    end = len(url)
    end_port = url.find(":", start)
    if end_port > 0:
        end = min(end, end_port)
    end_slash = url.find("/", start)
    if end_slash > 0:
        end = min(end, end_slash)
    return url[start:end]


@cache
def digitalocean_image_id(image: str) -> str:
    with timeit(f"getting {image} image id"):
        return run(f"doctl compute snapshot list --format ID --no-header {image}").strip()


@cache
def get_resource_url(filename: str) -> str:
    bucket = s3_bucket()
    return bucket.meta.client.generate_presigned_url(
        'get_object',
        Params={'Bucket': bucket.name, 'Key': f"resources/{filename}"}
    ).split("?")[0]


def make_runner_cloudconfig(plan: MeasurementPlanV3):
    # language="Shell Script"
    return textwrap.dedent(f"""
    #!/usr/bin/bash
    set -e
    set -x

    cd /root
    echo {base64.b64encode(json.dumps(plan)).decode()} | base64 --decode > plan.json
    curl {get_resource_url('main.js')} -o main.js
    DEBUG=pw:browser xvfb-run -a node --max-old-space-size=8192 main.js run
    self-destroy
    """).strip()


def spawn_runner(plan: MeasurementPlanV3) -> str:
    with tempfile.TemporaryDirectory(dir=here) as tmpdir:
        cloudinit = Path(tmpdir) / "cloudinit.yaml"
        cloudinit.write_text(make_runner_cloudconfig(plan), "utf8")
        if plan["region"] in DIGITALOCEAN_REGIONS:
            base_id = digitalocean_image_id("admeasure-runner")
            # language="Shell Script"
            return run(f"""
            doctl compute droplet create \
                --image {base_id} \
                --region {plan['region']} \
                --size s-1vcpu-1gb \
                --ssh-keys "95:42:f6:37:ad:00:ec:40:96:1e:df:cd:e6:12:69:83" \
                --user-data-file {cloudinit} \
                --tag-name runner \
                r-{sanitize_hostname(plan['id'])}
            """)
        else:
            # language="Shell Script"
            return run(f"""
            aws lightsail create-instances-from-snapshot \
              --profile admeasure \
              --instance-snapshot-name admeasure-runner \
              --region {plan["region"]} --availability-zone {plan["region"]}a \
              --bundle-id micro_2_0 \
              --user-data file://{cloudinit} \
              --tags key=runner \
              --instance-names r-{sanitize_hostname(plan['id'])}
            """)


def bash(command: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        # language="Shell Script"
        """
        set -x
        set -e
        TIMEFORMAT=%R
        """ + command,
        shell=True,
        executable="bash",
    )


def run(args: str, **kwargs) -> str:
    proc = subprocess.run(args, shell=True, capture_output=True, text=True, **kwargs)
    if proc.stderr:
        raise RuntimeError(proc.stderr)
    # noinspection PyTypeChecker
    return proc.stdout


class timeit(contextlib.ContextDecorator):
    message: str
    short: bool
    start: float

    def __init__(self, message: str, short=True):
        self.message = message
        self.short = short

    def __enter__(self):
        if self.short:
            print(self.message, end="\u2026")
        else:
            print(self.message + "\u2026\n", end="")
        self.start = time.time()

    def __exit__(self, exc_type, exc_val, exc_tb):
        if not self.short:
            print(f"{self.message}: ", end="")
        print(f"{time.time() - self.start:.1f}s")


_raise = object()
T = TypeVar("T")


def get_from_s3(filename: Union[str, ObjectSummary], default: T = _raise) -> Union[T, bytes]:
    try:
        filename = filename.key
    except AttributeError:
        pass
    bucket = s3_bucket()
    buf = io.BytesIO()
    try:
        bucket.download_fileobj(filename, buf)
    except ClientError:
        if default is not _raise:
            return default
        raise
    try:
        return gzip.decompress(buf.getvalue())
    except gzip.BadGzipFile:
        return buf.getvalue()


def download_files_from_s3(
    directory: Path,
    files: list[Union[ObjectSummary, Object]],
    ignore_missing: bool = True,
) -> dict[str, Path]:
    def download_file(file):
        outfile = directory / id_to_path(file.key)
        if outfile.exists():
            return True, file.key, outfile
        outfile.parent.mkdir(parents=True, exist_ok=True)
        try:
            obj = file.get()
        except botocore.exceptions.ClientError:
            if ignore_missing:
                return False, file.key, None
            else:
                raise
        f = obj["Body"]
        if obj["ContentEncoding"] == "gzip":
            f = gzip.GzipFile(fileobj=f)
        content = f.read()
        outfile.write_bytes(content)
        return False, file.key, outfile

    local_files = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor, timeit("downloading missing files from s3"):
        futures = [
            executor.submit(download_file, file)
            for file in files
        ]
        downloads = 0
        for f in concurrent.futures.as_completed(futures):
            cached, id, filename = f.result()
            if filename is not None:
                local_files[id] = filename
            if not cached:
                downloads += 1
                print("." if filename is not None else "x", end="")
                if downloads % 100 == 0:
                    sys.stdout.flush()
    if downloads:
        print("")
    return local_files


def enumerate_bucket(prefix: str, delimiter: str) -> Generator[str]:
    prefixes = 0
    start = time.time()

    client = s3_client()
    bucket = s3_bucket()
    paginator = client.get_paginator("list_objects")
    for i, result in enumerate(paginator.paginate(Bucket=bucket.name, Prefix=prefix, Delimiter=delimiter)):
        for prefix in result.get("CommonPrefixes", []):
            prefixes += 1
            yield prefix["Prefix"]
        print(
            f"Enumerating bucket... {prefixes} entries after {i + 1} pages ({prefixes / (time.time() - start):.1f} entries/s)")


def id_to_path(id: str) -> str:
    return id.replace(":", "-")


def normalize_id(path: str) -> str:
    id = path.replace("\\", "/")
    if id.endswith(".json"):
        id, _, _ = id.rpartition("/")
    id = re.sub(r"T(\d+)-(\d+)-([.\d]+)Z", r"T\1:\2:\3Z", id)
    return id.strip("/")


def sanitize_hostname(x: str) -> str:
    """transform a string into something suitable as a VM hostname"""
    return re.sub(r"[^a-zA-Z0-9\-.]", "-", x).strip("-")


DIGITALOCEAN_REGIONS = ["fra1", "lon1"]
AWS_REGIONS = ["eu-central-1", "eu-west-1"]
