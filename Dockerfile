# LoyTap backend — PocketBase serving both the API and the frontend (single origin).
# Built for Liara's Docker platform (linux/amd64).

FROM alpine:3.20

# Must match the version used locally so migrations/hooks behave identically.
ARG PB_VERSION=0.39.11

# openssl and curl are not decoration: web push needs P-256 (ECDH + ES256
# signing), which PocketBase's JS engine cannot do, and the encrypted body has
# to be POSTed as raw bytes, which $http.send() cannot carry. Both are shelled
# out to from backend/pb_hooks/webpush.js. Dropping either silently disables
# every staff notification.
RUN apk add --no-cache ca-certificates unzip wget openssl curl

WORKDIR /pb

# The Linux build of PocketBase (the local ./backend/pocketbase is macOS-only),
# shipped in the build context rather than downloaded.
#
# This was a wget from GitHub releases. Liara's build environment cannot reach
# that host: the build sat on the download until it hit the 20-minute ceiling,
# twice, identically, while everything before it finished in seconds. Alpine's
# CDN and Docker Hub are both reachable from there; GitHub releases is not. So
# the one remaining build-time fetch was the one that could not succeed.
#
# See vendor/README.md for why the zip is committed rather than gitignored, and
# for the command that refreshes it. Keep it in step with PB_VERSION above.
COPY vendor/pocketbase_linux_amd64.zip      /tmp/pb.zip
COPY vendor/pocketbase_linux_amd64.zip.sha256 /tmp/pb.zip.sha256

# Verified before unzipping: a truncated or substituted archive fails the build
# here, loudly, instead of producing an image that misbehaves at runtime.
RUN echo "$(cat /tmp/pb.zip.sha256)  /tmp/pb.zip" | sha256sum -c - \
    && unzip /tmp/pb.zip -d /pb \
    && rm /tmp/pb.zip /tmp/pb.zip.sha256

# Server-side logic (OTP, redeem, stats, card draw) + schema migrations.
COPY backend/pb_hooks/      /pb/pb_hooks/
COPY backend/pb_migrations/ /pb/pb_migrations/

# Frontend assets — copied as real files (pb_public/ symlinks don't survive into an image).
# *.txt carries the Enamad ownership file (72433515.txt) — an empty file Enamad
# fetches at the domain root to prove we control the site. It must stay reachable —
# as does robots.txt, which rides the same glob.
# *.xml is sitemap.xml. Without it PocketBase has no such file to serve and falls
# back to index.html, so /sitemap.xml answers 200 with HTML and every crawler
# that asks for the URL list gets a web page instead.
# sw.js rides the *.js glob. It MUST land at the public root: a service
# worker's scope is its own directory, so one served from a subdirectory could
# not receive pushes for /staff.
COPY *.html *.js *.css *.png *.jpg *.txt *.xml manifest*.json /pb/pb_public/
# Self-hosted fonts (woff2) so typography works where Google Fonts is blocked.
COPY fonts/ /pb/pb_public/fonts/

EXPOSE 8090

# --dir points at the mounted persistent disk so the SQLite DB + uploads survive redeploys.
CMD ["/pb/pocketbase", "serve", \
     "--http=0.0.0.0:8090", \
     "--dir=/pb/pb_data", \
     "--hooksDir=/pb/pb_hooks", \
     "--migrationsDir=/pb/pb_migrations", \
     "--publicDir=/pb/pb_public"]
