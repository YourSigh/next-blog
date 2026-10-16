export const LANES = ['clash', 'jungle', 'mid', 'farm', 'roam'] as const;
export type Lane = typeof LANES[number];
export const LANE_LABELS: Record<Lane, string> = { clash: '对抗路', jungle: '打野', mid: '中路', farm: '发育路', roam: '游走' };
export type Provider = 'qq' | 'wechat';
export type HeroStat = { id: string | null; name: string; games: number | null; wins: number | null; losses?: number | null; winRate: number | null; power: number | null; proficiency: number | null; maxPower?: number | null; icon?: string | null; lanes?: Lane[] };
export type SeasonStats = { games: number | null; wins: number | null; winRate: number | null; averageScore: number | null; maxWinStreak: number | null; goldMedals: number | null; silverMedals: number | null; heroes: Array<{id:string|null;name:string|null;games:number|null;wins:number|null;winRate:number|null;power:number|null}> };
export type SeasonStat = { id: string | null; name: string | null; rank: string | null; stars: number | null; maxRank?: string | null; maxStars?: number | null; peakScore: number | null; games: number | null; wins: number | null; winRate: number | null; averageScore: number | null; rankStats?: SeasonStats; peakStats?: SeasonStats; startTime?: string | null; endTime?: string | null };
export type MatchStat = { id?: string; heroId: string | null; heroName: string; result: string | null; mode: string | null; kills: number | null; deaths: number | null; assists: number | null; score: number | null; playedAt: string | null; durationSeconds?: number | null };
export type PlayerPreferences = { preferredLanes: Lane[]; avoidedLanes: Lane[]; laneAdjustments: Partial<Record<Lane, number>> };
export type Player = {
  id: string; provider: Provider; nickname: string; avatar: string | null; area: string | null;
  rank: string | null; stars: number | null; updatedAt: string; importedAt: string;
  heroes: HeroStat[]; seasons: SeasonStat[]; matches: MatchStat[];
  preferences: PlayerPreferences; coverage: { heroRecords: number; seasonRecords: number; matchRecords: number; catalogMatched: boolean; limitations: string[] };
  sample?: boolean;
};
export type LaneRating = { score: number; confidence: number; games: number; winRate: number | null; preference: number; reasons: string[] };
export type PlayerRating = { playerId: string; overall: number; confidence: number; lanes: Record<Lane, LaneRating>; reasons: string[]; version: string };
export type LaneLock = { playerId: string; lane?: Lane; team?: 'A' | 'B' };
export type BalanceOptions = { selectedIds: string[]; locks: LaneLock[]; seed?: string; variety?: number };
export type TeamSeat = { playerId: string; lane: Lane; score: number; confidence: number; preferred: boolean };
export type BalancedMatch = {
  id: string; seed: string; teams: { A: TeamSeat[]; B: TeamSeat[] }; totals: { A: number; B: number };
  gap: number; laneGaps: Record<Lane, number>; objective: number; alternatives: number; reasons: string[]; algorithmVersion: string;
};
export type ArenaState = { authenticated: boolean; configured: boolean; currentPlayerId?: string | null; players: Player[]; ratings: PlayerRating[]; providers: { qq: { enabled: boolean; message?: string }; wechat: { enabled: boolean; message?: string } }; message?: string };
