import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // skip API, Next internals, .well-known and files with an extension — except documents inside a share
  // (/s/<id>/v/report.md is a page, not a static file)
  matcher: ["/((?!api|_next|_vercel|\\.well-known|.*\\..*).*)", "/s/:id/v/:path*", "/en/s/:id/v/:path*"],
};
