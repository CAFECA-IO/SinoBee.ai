# bolt-vault (WebAssembly, Node.js)

Generated from [Luphia/Boltchain](https://github.com/Luphia/Boltchain) `crates/vault` at commit `b4fba15`:

```sh
cargo build -p bolt-vault --release --target wasm32-unknown-unknown --features wasm
wasm-bindgen --target nodejs --out-dir vendor/bolt-vault target/wasm32-unknown-unknown/release/bolt_vault.wasm   # wasm-bindgen-cli 0.2.108
```

Seals files for SwarmStorage deals: XChaCha20-Poly1305 chunks, Reed–Solomon 4+2 shards,
HPKE (X25519) recipients; envelope / manifest / shard blocks are raw CIDv1 (sha2-256).
Do not edit the generated files; rebuild them when Boltchain's vault format changes.
