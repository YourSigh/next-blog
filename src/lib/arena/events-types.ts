import type { BalancedMatch, Lane, Player } from './types.ts';

export type EventMode = 'play' | 'watch';
export type EventPlayer = Pick<Player, 'id' | 'nickname' | 'avatar' | 'provider' | 'area' | 'rank' | 'stars' | 'roleKey'>;
export type EventEntry = { player: EventPlayer; mode: EventMode; joinedAt: string; updatedAt: string };
export type CheckStatus = 'idle' | 'checking' | 'verified' | 'needs_login' | 'no_match' | 'mismatch' | 'incomplete' | 'ambiguous' | 'unavailable' | 'rate_limit';
export type EventCheck = { id: string; status: CheckStatus; reporterId: string; checkedAt: string; message: string };
export type BattlePlayer = {
  playerId: string; team: 'A' | 'B'; lane: Lane; heroId: string | null; heroName: string;
  kills: number | null; deaths: number | null; assists: number | null; score: number | null;
  gold: number | null; damage: number | null; damageTaken: number | null; participation: number | null;
};
export type VerifiedBattle = { sourceKey: string; gameId: string; playedAt: string; durationSeconds: number | null; winner: 'A' | 'B'; verifiedAt: string; reporterId: string; players: BattlePlayer[]; analysis: string[] };
export type EventRound = { id: string; number: number; status: 'active' | 'completed'; createdAt: string; completedAt?: string; allocation: BalancedMatch; players: EventPlayer[]; baselineMatchIds: string[]; check: EventCheck | null; attempts: EventCheck[]; candidates?: VerifiedBattle[]; result: VerifiedBattle | null };
export type DailyEvent = { version: 1; date: string; timezone: 'Asia/Shanghai'; revision: number; updatedAt: string; entries: EventEntry[]; rounds: EventRound[] };
export type DailyStanding = { playerId: string; nickname: string; played: number; wins: number; losses: number; kills: number | null; deaths: number | null; assists: number | null; kdaGames: number; scoredGames: number; averageScore: number | null };
export type EventView = { event: DailyEvent; dates: string[]; today: string; identityPlayerId: string | null; campConnected: boolean; standings: DailyStanding[] };
