# LoyTap backend — PocketBase serving both the API and the frontend (single origin).
# Built for Liara's Docker platform (linux/amd64).

FROM alpine:3.20

# Must match the version used locally so migrations/hooks behave identically.
ARG PB_VERSION=0.39.11

RUN apk add --no-cache ca-certificates unzip wget

WORKDIR /pb

# Download the Linux build of PocketBase (the local ./backend/pocketbase is macOS-only).
RUN wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" -O /tmp/pb.zip \
    && unzip /tmp/pb.zip -d /pb \
    && rm /tmp/pb.zip

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
