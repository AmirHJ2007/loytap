# vendor/

`pocketbase_linux_amd64.zip` — the Linux build of PocketBase that the Docker
image runs. Committed on purpose, which is unusual enough to explain.

The Dockerfile used to `wget` this from GitHub releases at build time. That
stopped working: Liara's build environment cannot reach
`github.com/.../releases/download/...`, and the build sat on the download until
it hit the 20-minute ceiling — twice, identically, with everything before it
(the Alpine package install) completing in seconds. Deploys were simply stuck.

Alpine's CDN and Docker Hub are both reachable from that builder; GitHub
releases is not. So the only fetch left in the build is the one that fails, and
removing it is what makes a deploy deterministic.

It cannot be gitignored instead: the Liara CLI honours `.gitignore` when it
builds the upload ("use .gitignore to reduce the size"), so an ignored file
never reaches the builder and `COPY` fails.

## Refreshing it

Keep in step with `ARG PB_VERSION` in the Dockerfile and with the local
`backend/pocketbase` — all three are the same PocketBase version, and migrations
and hooks are expected to behave identically across them.

    V=0.39.11
    curl -sL -o vendor/pocketbase_linux_amd64.zip \
      "https://github.com/pocketbase/pocketbase/releases/download/v${V}/pocketbase_${V}_linux_amd64.zip"
    shasum -a 256 vendor/pocketbase_linux_amd64.zip | awk '{print $1}' \
      > vendor/pocketbase_linux_amd64.zip.sha256

The `.sha256` beside it is what the build checks before unzipping, so a
truncated or substituted download fails the build loudly instead of producing
an image that misbehaves at runtime.
