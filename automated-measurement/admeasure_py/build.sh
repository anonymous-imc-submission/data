#!/usr/bin/env sh
set -ex
cd -- "$(dirname -- "$0")"

cd ..
python setup.py bdist_wheel

cd dist
adm s3 resource-upload admeasure-0.0.0-py3-none-any.whl

for machine in $monitor gdpr
do
  ssh $machine curl $(adm s3 resource-url admeasure-0.0.0-py3-none-any.whl) -o /tmp/admeasure-0.0.0-py3-none-any.whl
  ssh $machine /root/venv/bin/pip install --force-reinstall /tmp/admeasure-0.0.0-py3-none-any.whl --no-deps
done
