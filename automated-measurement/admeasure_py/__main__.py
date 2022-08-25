import datetime
import runpy
import time
from pathlib import Path

import click
import rich

from admeasure_py.utils import AWS_REGIONS, DIGITALOCEAN_REGIONS, bash, get_from_s3, get_resource_url, normalize_id, \
    run, s3_bucket, spawn_runner, timeit, json

here = Path(__file__).parent


@click.group()
def cli():
    pass


# go ahead, judge me :D
for x in ["button-texts", "consent-test", "log", "eval"]:
    try:
        cli.add_command(runpy.run_path(here / f"../{x}/run.py")["cli"], x)
    except FileNotFoundError:
        pass

@cli.command()
@click.argument("id")
def url(id):
    id = normalize_id(id)
    plan_id, _, step = id.rpartition("/")
    part, _, i = step.partition("-")
    part_data = json.loads(get_from_s3(f"{plan_id}/{part}.json"))
    url = part_data["urls"][int(i)]
    print(url)


@cli.group("vm")
def vm():
    pass


@vm.command()
@click.argument('plans', type=click.File())
def spawn(plans):
    plans = json.loads(plans.read())
    if isinstance(plans, dict):
        plans = [plans]
    for plan in plans:
        assert plan["region"] in DIGITALOCEAN_REGIONS or plan["region"] in AWS_REGIONS

    with click.progressbar(plans) as p:
        for plan in p:
            spawn_runner(plan)


@vm.command()
@click.argument("tag")
def delete(tag):
    # language="Shell Script"
    bash(f"""
    for region in eu-central-1 eu-west-1
    do
        aws lightsail get-instances --region $region --query "instances[?tags[?key=='{tag}']].name" \
            | jq -r ".[]" \
            | while read instance; do
          aws lightsail delete-instance --region $region --instance-name $instance &
        done
    done
    
    do_ids=$(doctl compute droplet list --format ID --no-header --tag-name {tag})
    if [ -n "$do_ids" ]
    then
        doctl compute droplet delete -f $do_ids 
    fi
    wait
    """)


@vm.command()
@click.argument("tag")
@click.argument("timeout", type=int)
def wait_complete(tag, timeout):
    raise NotImplementedError("AWS Support missing")
    # noinspection PyUnreachableCode
    start = time.time()
    while time.time() < start + timeout:
        print(f"[{datetime.datetime.utcnow().isoformat(timespec='seconds')}] ", end="")
        # language="Shell Script"
        if out := run(f"doctl compute droplet list --tag-name {tag} --no-header --format ID"):
            count = out.count('\n')
            print(f"{count} {tag} instances still alive.")
        else:
            print(f"finished after {time.time() - start:.0f}s")
            return
        time.sleep(5)
    print("Timeout, killing...")
    # language="Shell Script"
    bash(f"""
    doctl compute droplet delete $(doctl compute droplet list --format ID --no-header --tag-name {tag}) -f
    """)


@cli.group("s3")
def s3():
    pass


@s3.command()
@click.argument("filename")
@click.argument("id")
@click.option("--pretty/--no-pretty", default=False)
def get(filename, id, pretty):
    id = normalize_id(id)
    val = get_from_s3(f"{id}/{filename}")
    if pretty:
        try:
            val = json.loads(val)
        except Exception:
            pass
        rich.print(val)
    else:
        print(val.decode())


@s3.command("delete")
@click.argument("prefix")
def rm(prefix):
    """empty the bucket, fast."""
    click.confirm(f"Delete everything under {prefix!r}?", abort=True)
    bucket = s3_bucket()
    with timeit("Deleting..."):
        bucket.objects.filter(Prefix=prefix).delete()


@s3.command()
@click.argument("filename", nargs=-1)
def resource_upload(filename):
    bucket = s3_bucket()
    for f in filename:
        with timeit(f):
            bucket.upload_file(f, f"resources/{f}", ExtraArgs={'ACL': 'public-read'})


@s3.command()
@click.argument("filename")
def resource_url(filename):
    print(get_resource_url(filename), end="")


if __name__ == "__main__":
    cli()
