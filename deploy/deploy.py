#!/usr/bin/env python3
"""Deploy the gitpp-app Worker via the fleet's OAuth route
(~/workspace/winnings/cf_oauth.py). The cf_api.py surrogate token is
dead — do not use it (AGENTS.md has the history).

Refuses to deploy if the manifest embedded in worker.js differs from
manifest.json: the landing page must show exactly what the repo says
the owner will be creating.

Prints success flags only; never prints credentials or tokens.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.expanduser("~/workspace/winnings"))
import cf_oauth  # noqa: E402

ACCOUNT = "049ff5e84ecf636b53b162cbb580aae6"
SCRIPT = "gitpp-app"
HOSTNAME = "gitpp-app.superinstance.dev"


def main():
    worker = open(os.path.join(ROOT, "worker.js"), "rb").read()
    manifest_repo = json.load(open(os.path.join(ROOT, "manifest.json")))
    m = re.search(
        rb"/\*MANIFEST-BEGIN\*/(.*?)/\*MANIFEST-END\*/", worker, re.S
    )
    if not m:
        print("manifest markers not found in worker.js — refusing")
        return 1
    manifest_embedded = json.loads(m.group(1))
    if manifest_embedded != manifest_repo:
        print("MANIFEST DRIFT: worker.js != manifest.json — refusing")
        return 1
    print("manifest check: embedded == manifest.json")

    metadata = json.load(open(os.path.join(HERE, "metadata.json")))
    r = cf_oauth.multipart_put(
        f"/client/v4/accounts/{ACCOUNT}/workers/scripts/{SCRIPT}",
        metadata,
        {"worker.js": ("worker.js", worker, "application/javascript+module")},
    )
    print("upload success:", r.get("success"), "| errors:", r.get("errors"))
    if not r.get("success"):
        return 1

    domains = cf_oauth.request(
        "GET", f"/client/v4/accounts/{ACCOUNT}/workers/domains"
    )
    existing = {
        d.get("hostname"): d.get("service") for d in (domains.get("result") or [])
    }
    if existing.get(HOSTNAME) == SCRIPT:
        print("domain already attached:", HOSTNAME, "->", SCRIPT)
    else:
        body = json.dumps(
            {"hostname": HOSTNAME, "service": SCRIPT, "environment": "production"}
        ).encode()
        d = cf_oauth.request(
            "PUT", f"/client/v4/accounts/{ACCOUNT}/workers/domains", data=body
        )
        print("domain attach success:", d.get("success"), "| errors:", d.get("errors"))
        if not d.get("success"):
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
