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
COPY *.html *.js *.css *.png /pb/pb_public/

EXPOSE 8090

# --dir points at the mounted persistent disk so the SQLite DB + uploads survive redeploys.
CMD ["/pb/pocketbase", "serve", \
     "--http=0.0.0.0:8090", \
     "--dir=/pb/pb_data", \
     "--hooksDir=/pb/pb_hooks", \
     "--migrationsDir=/pb/pb_migrations", \
     "--publicDir=/pb/pb_public"]
