export const dynamic = "force-dynamic";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { config } from "@/lib/config";
import { CopyCode } from "@/components/copy-code";

export const metadata = { title: "Skill Hub API v1" };

const ROWS = [
  ["GET", "/api/v1/skills?q=&page=", "{ items: [{ id, name, description, latest, trust, publisher, downloads }], page, total }"],
  ["GET", "/api/v1/skills/{publisher}/{name}", "{ id, name, license, publisher: { id, verified }, versions: [{ version, sha256, bundle_url, signature, reviewed, published_at, scan: { verdict, findings } }] }"],
  ["GET", "/api/v1/bundles/{publisher}/{name}/{version}.tar.gz", ".tar.gz — single <name>/ folder + .sinobee-manifest.json"],
  ["GET", "/api/v1/revocations", "{ revoked: [\"sha256:…\"] }"],
  ["POST", "/api/v1/skills", "Bearer sbh_… · multipart bundle + manifest → { id, version, status: \"pending_review\" }"],
  ["GET", "/.well-known/sinobee-hub-keys.json", "{ alg: \"ed25519\", keys: [\"<base64 raw public key>\"] }"],
];

export default async function HubApiDocs({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("hubApi");
  return (
    <div className="container-x max-w-4xl space-y-8 py-12">
      <div>
        <h1 className="h1">Skill Hub API v1</h1>
        <p className="mt-3 text-muted">{t("lead")}</p>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {ROWS.map(([m, p, d]) => (
              <tr key={p} className="border-b border-line last:border-0">
                <td className="p-3 font-mono font-bold text-accent">{m}</td>
                <td className="p-3 font-mono">{p}</td>
                <td className="p-3 text-muted">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="space-y-3">
        <h2 className="h2">{t("trustTitle")}</h2>
        <ol className="list-decimal space-y-1 pl-5 text-muted">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i}>{t(`trust.${i}`)}</li>
          ))}
        </ol>
      </section>
      <section className="space-y-3">
        <h2 className="h2">{t("exampleTitle")}</h2>
        <CopyCode code={`curl ${config.origin}/api/v1/skills?q=research\ncurl ${config.origin}/api/v1/skills/cafeca/web-research\ncurl -H "Authorization: Bearer sbh_..." -F bundle=@my-skill-1.0.0.tar.gz -F manifest=@manifest.json ${config.origin}/api/v1/skills`} />
      </section>
    </div>
  );
}
