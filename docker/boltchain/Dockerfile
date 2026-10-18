# Boltchain node for SinoBee.ai's storage (SwarmStorage deals, Certificates).
# Built from source: the public testnet needs a node newer than the last release (v0.1.0 predates
# the 2026-09-26 restart and the `swarm` and `tee` forks; a node older than a fork stops at its block). `npm run swarm` builds and runs it automatically.
#
#   docker build -t sinobee-boltchain:8c0cd64 --build-arg BOLTCHAIN_REF=8c0cd64 docker/boltchain
FROM rust:1.95-bookworm AS build
ARG BOLTCHAIN_REPO=https://github.com/Luphia/Boltchain
ARG BOLTCHAIN_REF=8c0cd64
RUN apt-get update && apt-get install -y --no-install-recommends cmake clang libclang-dev g++ git \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# optional build secret `ca`: an extra CA bundle for networks behind a TLS-inspecting proxy
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export GIT_SSL_CAINFO=/run/secrets/ca; fi; \
    git clone --filter=blob:none "$BOLTCHAIN_REPO" . && git checkout --quiet "$BOLTCHAIN_REF"
RUN --mount=type=secret,id=ca,required=false \
    --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    if [ -s /run/secrets/ca ]; then export CARGO_HTTP_CAINFO=/run/secrets/ca SSL_CERT_FILE=/run/secrets/ca; fi; \
    cargo build --release --locked -p boltchain && cp target/release/boltchain /usr/local/bin/boltchain

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* \
 && useradd --system --home-dir /data --shell /usr/sbin/nologin boltchain && install -d -o boltchain -g boltchain /data
COPY --from=build /usr/local/bin/boltchain /usr/local/bin/boltchain
COPY --from=build /src/genesis /opt/boltchain/genesis
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
USER boltchain
VOLUME /data
# 8545 JSON-RPC (publish to 127.0.0.1 only), 8017 P2P (TCP + UDP/QUIC), 9017 /health
EXPOSE 8545 8017/tcp 8017/udp 9017
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD curl -fsS http://127.0.0.1:9017/health >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
