import type { Metadata } from 'next';
import ArenaClient from '../ArenaClient';
export const metadata: Metadata = { title: '每日比赛 · ARENA', description: '每日报名、观战、共享分队与核验赛果归档。' };
export default function ArenaEventsPage() { return <ArenaClient initialTab="events" />; }
