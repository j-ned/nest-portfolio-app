// Fuseau des tests unitaires : UTC par défaut, pour des résultats identiques sur tout poste.
// Un `TZ` explicite est respecté, pour rejouer la suite sous un autre fuseau
// (`TZ=Pacific/Kiritimati pnpm test -- src/analytics`) et prouver que le code ne dépend pas du
// fuseau du processus.
export default function globalSetup(): void {
  process.env.TZ ??= 'UTC';
}
