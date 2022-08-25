from pathlib import Path

here = Path(__file__).parent

if __name__ == "__main__":
    collections = [x.stem for x in here.glob("*.json")]
    print(f"{collections=}")

    with (here / "index.ts").open("w", newline="\n") as f:
        print("// This file is auto-generated from make_index.py, do not edit manually.", file=f)
        for c in collections:
            print(f'import {c} from "./{c}.json";', file=f)
        print(file=f)

        print("export default {", file=f)
        for c in collections:
            print(f"    {c},", file=f)
        print("}", file=f)
