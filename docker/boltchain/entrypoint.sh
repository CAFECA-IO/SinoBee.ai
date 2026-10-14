#!/bin/sh
# Runs a non-validating Boltchain testnet node with block hosting (--rpc-storage) for SinoBee.ai.
#   BOLT_BOOTNODES   space-separated multiaddrs (default: the public testnet bootnodes)
#   BOLT_CHECKPOINT  <number>:<hash> of a recent epoch-end block: a fresh datadir starts from that
#                    snapshot instead of syncing from genesis (npm run swarm fills it in)
#   BOLT_GENESIS     genesis file (default: testnet)
set -eu
GENESIS=${BOLT_GENESIS:-/opt/boltchain/genesis/testnet.json}
BOOT=${BOLT_BOOTNODES:-"/ip4/211.22.118.149/udp/8017/quic-v1/p2p/12D3KooWCFZiVi5pkzNA83AZqaUevCbi5fYULiEGtmz8FSvMuhDo /ip4/211.22.118.149/tcp/8017/p2p/12D3KooWCFZiVi5pkzNA83AZqaUevCbi5fYULiEGtmz8FSvMuhDo"}
set -- validator --genesis "$GENESIS" --datadir /data/chain --node-key /data/node.key \
  --rpc 0.0.0.0:8545 --rpc-storage --metrics 0.0.0.0:9017 "$@"
for b in $BOOT; do set -- "$@" --bootnode "$b"; done
# a checkpoint only applies to an empty datadir
if [ -n "${BOLT_CHECKPOINT:-}" ] && [ ! -d /data/chain ]; then set -- "$@" --checkpoint "$BOLT_CHECKPOINT"; fi
export RUST_LOG=${RUST_LOG:-info,libmdbx=warn,libp2p=warn}
exec boltchain "$@"
