import QRCode from "qrcode";
import { config } from "@/lib/config";

/** Render a CAFECA deep link as SVG QR (only links to the configured wallet are accepted) */
export async function GET(req: Request) {
  const d = new URL(req.url).searchParams.get("d") ?? "";
  if (!d.startsWith(config.cafecaWallet + "/") || d.length > 4000) return new Response("bad request", { status: 400 });
  const svg = await QRCode.toString(d, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "no-store" } });
}
