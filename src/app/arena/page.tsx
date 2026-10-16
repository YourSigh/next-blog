import type { Metadata } from 'next';
import ArenaClient from './ArenaClient';

export const metadata: Metadata = { title: 'ARENA · 峡谷组局室', description: '公开授权选手档案、五分路评估与十人公平分队。' };

export default function ArenaPage() { return <ArenaClient />; }
