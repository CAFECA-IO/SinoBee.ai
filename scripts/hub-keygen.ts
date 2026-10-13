/** Generate an ed25519 key pair for signing reviewed Skill Hub versions. */
import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const priv = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const spki = publicKey.export({ format: "der", type: "spki" });
const pub = Buffer.from(spki.subarray(spki.length - 32)).toString("base64");
console.log("# add to .env (keep secret!)");
console.log(`HUB_SIGNING_KEY=${priv}`);
console.log("\n# public key published at /.well-known/sinobee-hub-keys.json — SinoBee users pin it as skills.hub_keys");
console.log(pub);
