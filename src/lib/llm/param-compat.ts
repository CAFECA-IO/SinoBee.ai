/**
 * Request parameters a model no longer accepts, learned from the provider's own 400s.
 *
 * Newer models drop parameters older ones took - Claude Opus 5.5 answers "`temperature` is deprecated for this model",
 * OpenAI reasoning models reject temperature / top_p. These parameters only tune sampling, so leaving one out keeps
 * the request's meaning: the relay retries once without it and remembers the model (for this process), so every
 * client - also old SinoBee versions that always send temperature - keeps working without a release.
 */

/** sampling knobs that may be left out; never content, tools or limits */
export const OPTIONAL_PARAMS = ["temperature", "top_p", "top_k"] as const;

const REJECT = (p: string) =>
  new RegExp(
    [
      `[\`'"]?${p}[\`'"]?[^\\n]{0,80}?\\b(?:is )?(?:deprecated|not supported|unsupported|not allowed|not permitted|cannot be (?:set|used)|is not available|has been removed|no longer supported)`,
      `(?:unsupported|unknown|unrecognized|unexpected|invalid|extra)[ _](?:parameter|argument|field|key|value)s?[^\\n]{0,40}?[\`'"]?${p}\\b`,
      `does not support[^\\n]{0,40}?[\`'"]?${p}\\b`,
      `[\`'"]?${p}[\`'"]?: extra inputs are not permitted`,
    ].join("|"),
    "i",
  );
const PATTERNS = Object.fromEntries(OPTIONAL_PARAMS.map((p) => [p, REJECT(p)])) as Record<string, RegExp>;

const learned = new Map<string, Set<string>>();

/** The optional parameter an upstream 400/422 says the model does not accept (one that was sent), or null */
export function rejectedParam(status: number, message: string, payload: Record<string, unknown>): string | null {
  if (status !== 400 && status !== 422) return null;
  for (const p of OPTIONAL_PARAMS) if (payload[p] !== undefined && PATTERNS[p].test(message)) return p;
  return null;
}

export function learn(model: string, param: string) {
  const s = learned.get(model) ?? new Set<string>();
  if (!s.has(param)) console.warn(`llm relay: ${model} does not accept ${param}; it is left out from now on`);
  s.add(param);
  learned.set(model, s);
}

/** Remove the parameters this model is known not to accept; returns what was removed */
export function stripKnown(model: string, payload: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const p of learned.get(model) ?? []) {
    if (payload[p] !== undefined) {
      delete payload[p];
      out.push(p);
    }
  }
  return out;
}

export function knownDropped(): Record<string, string[]> {
  return Object.fromEntries([...learned].map(([m, s]) => [m, [...s]]));
}

export function resetParamCompat() {
  learned.clear();
}
