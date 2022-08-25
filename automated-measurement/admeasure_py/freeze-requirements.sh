#!/usr/bin/env sh
set -ex
cd -- "$(dirname -- "$0")"

rm -rf freeze-venv
python3 -m venv freeze-venv
freeze-venv/bin/python -m pip install -U pip
freeze-venv/bin/pip install -e ..
freeze-venv/bin/pip freeze --all --exclude-editable > ../requirements.txt
rm -rf freeze-venv
