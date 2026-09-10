/**
 * Réduit un `document.referrer` brut à un hôte affichable : `https://www.google.com/` → `google.com`.
 * Renvoie `null` pour une navigation interne (hôte du site) ou une valeur qui n'est pas une URL :
 * la provenance ne doit lister que des sources externes.
 */
export function normalizeReferrer(
  raw: string | undefined,
  siteOrigins: readonly string[],
): string | null {
  if (!raw) return null;

  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;

  const bare = stripWww(host);
  const siteHosts = siteOrigins.map((origin) => {
    try {
      return stripWww(new URL(origin).hostname.toLowerCase());
    } catch {
      return null;
    }
  });
  if (siteHosts.includes(bare)) return null;

  return bare;
}

function stripWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host;
}
