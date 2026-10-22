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

    # The scripts PUTM silently drops non-secret bindings on this
    # account (learned 2026-10-21: the CREDS KV binding vanished and
    # the registration callback failed to store). Re-attach via the
    # settings PATCH, which is the route that holds.
    import urllib.request, urllib.error, uuid as _uuid
    binds = [{"name": kv["binding"], "type": "kv_namespace", "namespace_id": kv["id"]}
             for kv in metadata.get("kv_namespaces", [])]
    if binds:
        tok = cf_oauth.access_token()
        boundary = "----cfpatch" + _uuid.uuid4().hex
        payload = json.dumps({"bindings": binds}).encode()
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"settings\"\r\nContent-Type: application/json\r\n\r\n".encode()
                + payload + b"\r\n" + f"--{boundary}--\r\n".encode())
        req = urllib.request.Request(
            f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/scripts/{SCRIPT}/settings",
            data=body, method="PATCH")
        req.add_header("Authorization", f"Bearer {tok}")
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
        try:
            out = json.loads(urllib.request.urlopen(req, timeout=60).read())
        except urllib.error.HTTPError as e:
            out = json.loads(e.read())
        print("bindings patch:", out.get("success"), "| errors:", out.get("errors"))

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
