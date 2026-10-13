import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // skip API, Next internals, .well-known and files with an extension
  matcher: ["/((?!api|_next|_vercel|\\.well-known|.*\\..*).*)"],
};
