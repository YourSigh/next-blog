import catalogJson from './hero-catalog.json' with { type: 'json' };
import { LANES, type HeroStat, type Lane } from './types.ts';

export const HERO_LANE_VERSION = 'catalog-roles-2026-10-16-v1';
export type CatalogHero = { ename: number; cname: string; roles?: string; hero_type: number; hero_type2?: number };
export const HERO_CATALOG: readonly CatalogHero[] = catalogJson;
const byId = new Map(HERO_CATALOG.map(hero => [String(hero.ename), hero]));
const byName = new Map(HERO_CATALOG.map(hero => [hero.cname, hero]));

// This is the application's explicit mapping version, not an assertion that
// hero_type (warrior/mage/tank/assassin/shooter/support) means a playing lane.
const roleCodes: Record<string, Lane> = { '1': 'clash', '2': 'jungle', '3': 'mid', '4': 'farm', '5': 'roam' };
export const isLane = (value: unknown): value is Lane => typeof value === 'string' && (LANES as readonly string[]).includes(value);

export function resolveHeroLanes(hero: Pick<HeroStat, 'id' | 'name' | 'lanes'>): { lanes: Lane[]; confidence: number; source: string } {
  const explicit = [...new Set((hero.lanes ?? []).filter(isLane))];
  if (explicit.length) return { lanes: explicit, confidence: 0.7, source: 'provided-lanes' };
  const entry = byId.get(String(hero.id ?? '')) ?? byName.get(hero.name);
  if (!entry) return { lanes: [], confidence: 0, source: 'unknown-hero' };
  const lanes = [...new Set((entry.roles ?? '').split('|').map(code => roleCodes[code]).filter(isLane))];
  // hero_type is deliberately not a fallback: e.g. tanks can be clash or roam,
  // and assassins can be mid. Unknown metadata stays unknown.
  return { lanes, confidence: lanes.length ? 0.8 : 0, source: HERO_LANE_VERSION };
}

export function heroIcon(id: string | number | null): string | null {
  const entry = byId.get(String(id));
  return entry ? `https://game.gtimg.cn/images/yxzj/img201606/heroimg/${entry.ename}/${entry.ename}.jpg` : null;
}
