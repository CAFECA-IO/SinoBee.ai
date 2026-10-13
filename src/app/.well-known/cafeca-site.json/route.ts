/** Site metadata shown in the CAFECA wallet during sign-in (domain is always the primary identifier) */
export function GET() {
  return Response.json(
    { name: "SinoBee.ai", icon: "/icon.svg" },
    { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" } },
  );
}
