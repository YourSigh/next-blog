import { NextResponse } from 'next/server';

type ProxyRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

const ALLOWED_ORIGINS = new Set([
  'https://pubapp.shb.ltd',
  'https://cloud.shb.ltd',
]);

function isAllowedTarget(targetUrl: URL) {
  return ALLOWED_ORIGINS.has(targetUrl.origin);
}

export async function POST(req: Request) {
  let payload: ProxyRequest;
  try {
    payload = (await req.json()) as ProxyRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!payload?.url) {
    return NextResponse.json({ error: 'Missing "url"' }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(payload.url);
  } catch {
    return NextResponse.json({ error: 'Invalid target url' }, { status: 400 });
  }

  if (!isAllowedTarget(target)) {
    return NextResponse.json(
      { error: `Target origin not allowed: ${target.origin}` },
      { status: 403 }
    );
  }

  const method = (payload.method || 'GET').toUpperCase();
  const headers = new Headers(payload.headers || {});

  // 安全：避免透传 Host / Connection 等 hop-by-hop 头
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length');

  let body: string | undefined = payload.body;
  if (method === 'GET' || method === 'HEAD') body = undefined;

  try {
    const upstreamResp = await fetch(target.toString(), {
      method,
      headers,
      body,
      redirect: 'manual',
      cache: 'no-store',
    });

    const contentType = upstreamResp.headers.get('content-type') || '';
    const raw = await upstreamResp.arrayBuffer();

    return new NextResponse(raw, {
      status: upstreamResp.status,
      headers: {
        'content-type': contentType || 'application/octet-stream',
        'x-shb-proxy-target': target.origin,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Upstream fetch failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

