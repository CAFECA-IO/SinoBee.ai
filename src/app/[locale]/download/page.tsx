import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CopyCode } from "@/components/copy-code";
import { AGENT_URL } from "@/lib/links";
import { Icon } from "@/components/icon";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const t = await getTranslations({ locale: (await params).locale, namespace: "download" });
  return { title: t("title") };
}

const REPO = "https://github.com/CAFECA-IO/SinoBee";

export default async function DownloadPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("download");
  const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
    <section id={id} className="scroll-mt-24 space-y-4">
      <h2 className="h2">{title}</h2>
      {children}
    </section>
  );
  return (
    <div className="container-x grid grid-cols-1 gap-10 py-12 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <nav className="sticky top-24 space-y-1 text-sm">
          {(["requirements", "docker", "local-models", "pip", "first-run", "cli", "troubleshooting"] as const).map((id) => (
            <a key={id} href={`#${id}`} className="block rounded-lg px-3 py-1.5 text-muted hover:bg-panel-2 hover:text-accent">
              {t(`toc.${id}`)}
            </a>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 space-y-14">
        <header>
          <h1 className="h1">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-lg text-muted">{t("lead")}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <a href={REPO} target="_blank" rel="noreferrer" aria-label={t("github")} data-tip={t("github")} className="icon-btn solid lg"><Icon name="github" /></a>
            <a href={`${REPO}/archive/refs/heads/main.zip`} aria-label={t("zip")} data-tip={t("zip")} className="icon-btn outline lg"><Icon name="download" /></a>
            <a href={AGENT_URL} target="_blank" rel="noopener" aria-label={t("tryOnline")} data-tip={t("tryOnline")} className="icon-btn outline lg"><Icon name="rocket" /></a>
          </div>
          <p className="mt-3 text-sm text-muted">{t("tryOnlineNote")}</p>
        </header>

        <Section id="requirements" title={t("toc.requirements")}>
          <div className="grid gap-4 sm:grid-cols-3">
            {(["docker", "python", "local"] as const).map((k) => (
              <div key={k} className="card p-5">
                <div className="font-semibold">{t(`req.${k}.title`)}</div>
                <p className="mt-1.5 text-sm text-muted">{t(`req.${k}.body`)}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="docker" title={t("toc.docker")}>
          <p className="text-muted">{t("dockerLead")}</p>
          <CopyCode code={"git clone https://github.com/CAFECA-IO/SinoBee.git && cd SinoBee\ndocker compose up -d --build"} />
          <p className="text-sm text-muted">{t("dockerOpen")}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card p-5">
              <div className="font-semibold">{t("cloudTitle")}</div>
              <p className="mt-1.5 text-sm text-muted">{t("cloudBody")}</p>
            </div>
            <div className="card p-5">
              <div className="font-semibold">{t("startWithKeysTitle")}</div>
              <div className="mt-2">
                <CopyCode code={"SINOBEE_MODEL=anthropic/claude-sonnet-4-5 \\\nANTHROPIC_API_KEY=sk-ant-... \\\ndocker compose up -d --build"} />
              </div>
            </div>
          </div>
        </Section>

        <Section id="local-models" title={t("toc.local-models")}>
          <p className="text-muted">{t("localLead")}</p>
          <h3 className="h3">macOS (Apple Silicon)</h3>
          <p className="text-sm text-muted">{t("localMac")}</p>
          <CopyCode code={'SINOBEE_HOST_HARDWARE="$(scripts/host-hardware.sh)" docker compose up -d --build'} />
          <h3 className="h3">Windows / Linux</h3>
          <CopyCode code={'SINOBEE_HOST_HARDWARE="$(scripts/host-hardware.sh)" docker compose --profile local-llm up -d --build'} />
          <p className="text-sm text-muted">{t("localGpu")}</p>
          <CopyCode code={'SINOBEE_HOST_HARDWARE="$(scripts/host-hardware.sh)" \\\n  docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile local-llm up -d --build'} />
          <div className="card overflow-hidden">
            <Image src="/screenshots/settings-local-models.png" alt="" width={1600} height={1075} className="h-auto w-full" />
          </div>
        </Section>

        <Section id="pip" title={t("toc.pip")}>
          <p className="text-muted">{t("pipLead")}</p>
          <CopyCode code={'git clone https://github.com/CAFECA-IO/SinoBee.git && cd SinoBee\nbash scripts/install-command.sh   # venv + dependencies + `sinobee` command on your PATH\nsinobee serve                     # from any folder: http://localhost:10024'} />
          <p className="text-sm text-muted">{t("pipManual")}</p>
          <CopyCode code={'pip install -e ".[all]"          # macOS/Windows desktop control: ".[all,desktop-native]"\npython -m playwright install chromium\nsinobee serve --port 10024'} />
          <p className="rounded-xl border border-warn/40 bg-warn-soft p-4 text-sm text-warn">{t("pipMacNote")}</p>
        </Section>

        <Section id="first-run" title={t("toc.first-run")}>
          <ol className="list-decimal space-y-2 pl-5 text-muted">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i}>{t(`firstRun.${i}`)}</li>
            ))}
          </ol>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card overflow-hidden">
              <Image src="/screenshots/approval.png" alt="" width={1600} height={1075} className="h-auto w-full" />
            </div>
            <div className="card overflow-hidden">
              <Image src="/screenshots/skills.png" alt="" width={1600} height={1075} className="h-auto w-full" />
            </div>
          </div>
        </Section>

        <Section id="cli" title={t("toc.cli")}>
          <CopyCode
            code={[
              "sinobee serve                                       # Web UI + API on http://localhost:10024",
              "sinobee chat -m anthropic/claude-sonnet-4-5        # terminal chat",
              'sinobee run "整理 ~/Downloads 裡的 PDF 並列出清單"',
              "sinobee doctor                                      # check models, browser, desktop",
              "sinobee keys list|set <provider>|rm <provider>",
              "sinobee skills search <keyword>                     # search sinobee.ai Skill Hub",
              "sinobee skills install hub:<publisher>/<name>[@version]",
              "sinobee skills publish <name>                       # needs: sinobee keys set sinobee-hub",
              "sinobee usage month --by model",
              "sinobee work                                        # background work: past / now / next",
              "sinobee memory stats|maintain|compress              # layered memory upkeep",
            ].join("\n")}
          />
          <p className="text-sm text-muted">{t("cliHub")}</p>
          <CopyCode code={'# ~/.sinobee/config.yaml\nskills:\n  hub_url: https://sinobee.ai\n  hub_keys: ["<key from https://sinobee.ai/.well-known/sinobee-hub-keys.json>"]'} />
        </Section>

        <Section id="troubleshooting" title={t("toc.troubleshooting")}>
          <div className="card divide-y divide-line">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="grid gap-1 p-4 sm:grid-cols-[220px_1fr]">
                <div className="font-medium">{t(`trouble.${i}.q`)}</div>
                <div className="text-sm text-muted">{t(`trouble.${i}.a`)}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
