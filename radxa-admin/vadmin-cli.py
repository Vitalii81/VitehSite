#!/usr/bin/env python3
"""Command line for the owner and for deploy-from-radxa.sh (over ssh).
  vadmin-cli.py list | export <id> | verify <id> | mark-published <id> | set-password | build"""
import getpass
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))

from vadmin import auth, build, core                    # noqa: E402
from vadmin.core import ApiError                        # noqa: E402


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    cmd, args, paths = argv[0], argv[1:], core.Paths()
    try:
        if cmd == "list":
            state = build.read_state(paths)
            for b in build.list_builds(paths):
                print("%s  %5d files  %8d bytes%s%s" % (b["id"], b["files"] or 0, b["bytes"] or 0, "  [built]" if b["current"] else "", "  [published]" if b["published"] else ""))
            return 0
        if cmd == "export":
            build.export_tar(paths, args[0], sys.stdout.buffer)
            return 0
        if cmd == "verify":
            result = build.verify_build(paths, args[0])
            print("OK %d files" % result["count"] if result["ok"] else "FAIL: " + ", ".join(result["bad"]))
            return 0 if result["ok"] else 1
        if cmd == "mark-published":
            with core.locked(paths):
                build.verify_build(paths, args[0])
                state = build.read_state(paths)
                state["published"] = args[0]
                core.write_json(paths.state, state)
            print("published =", args[0])
            return 0
        if cmd == "build":
            result = build.build(paths)
            print(result if result["ok"] else "\n".join("- %s: %s" % (p["where"], p["message"]) for p in result["problems"]))
            return 0 if result["ok"] else 1
        if cmd == "set-password":
            phrase = getpass.getpass("Нова фраза входу (від %d символів): " % auth.MIN_PASSPHRASE)
            if phrase != getpass.getpass("Повторіть: "):
                print("Фрази не збігаються")
                return 1
            os.makedirs(paths.secret, mode=0o700, exist_ok=True)
            auth.set_passphrase(paths, phrase)
            print("Збережено хеш у", paths.auth)
            return 0
        if cmd == "revoke-sessions":
            auth.revoke_all(paths)
            print("Усі сесії скасовано")
            return 0
    except ApiError as e:
        sys.stderr.write("%s\n" % e.message)
        return 1
    except IndexError:
        sys.stderr.write("Потрібен аргумент: id збірки\n")
        return 2
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
