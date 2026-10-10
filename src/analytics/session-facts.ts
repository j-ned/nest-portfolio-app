/** Une visite (empreinte d'un appareil sur une journée UTC), telle que lue dans les tables brutes. */
export type SessionFacts = {
  /** Pages distinctes, URL sans fragment. */
  pages: number;
  /** Somme des durées mesurées, `null` si aucune page de la visite n'a de durée. */
  durationSum: number | null;
  durationSamples: number;
  /** Au moins un événement d'engagement sur la visite. */
  engaged: boolean;
};

export type SessionSummary = {
  sessions: number;
  pageviews: number;
  bounces: number;
  realBounces: number;
  engagedSessions: number;
  totalDuration: number;
  durationSamples: number;
};

/**
 * Classe chaque visite (ADR-0022) : rebond une page = une seule page ; rebond réel = une seule
 * page, aucun événement d'engagement et moins de `thresholdSeconds` de temps visible. Une durée
 * inconnue compte comme inférieure au seuil : le rebond réel majore, il ne minore jamais.
 */
export function summarizeSessions(
  facts: readonly SessionFacts[],
  thresholdSeconds: number,
): SessionSummary {
  const isBounce = (f: SessionFacts) => f.pages === 1;
  const isRealBounce = (f: SessionFacts) =>
    isBounce(f) && !f.engaged && (f.durationSum ?? 0) < thresholdSeconds;
  const total = (pick: (f: SessionFacts) => number) =>
    facts.reduce((sum, f) => sum + pick(f), 0);

  const realBounces = facts.filter(isRealBounce).length;
  return {
    sessions: facts.length,
    pageviews: total((f) => f.pages),
    bounces: facts.filter(isBounce).length,
    realBounces,
    engagedSessions: facts.length - realBounces,
    totalDuration: total((f) => f.durationSum ?? 0),
    durationSamples: total((f) => f.durationSamples),
  };
}
