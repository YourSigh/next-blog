import { NextResponse } from 'next/server';

/**
 * 从本次请求中直接获取访问者 IP，不依赖任何第三方服务。
 * 优先从代理/负载均衡设置的 x-forwarded-for、x-real-ip 读取（最左边为真实客户端 IP）。
 */
function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return null;
}

type GeoResponse = {
  status: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  zip?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  query?: string;
};

export async function GET(request: Request) {
  const ip = getClientIp(request);
  const url = new URL(request.url);
  const skipGeo = url.searchParams.get('geo') === '0';

  const isLocal =
    !ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.');

  if (isLocal) {
    return NextResponse.json({
      ip: ip || '未知',
      isLocal: true,
      location: null,
      timezone: null,
    });
  }

  if (skipGeo) {
    return NextResponse.json({
      ip,
      isLocal: false,
      location: null,
      timezone: null,
    });
  }

  try {
    const res = await fetch(
      `https://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,zip,lat,lon,timezone,query`,
      { next: { revalidate: 3600 } }
    );
    // 仅用第三方做「IP → 地理位置」解析，IP 本身来自上面 getClientIp
    const data = (await res.json()) as GeoResponse;

    if (data.status !== 'success') {
      return NextResponse.json({
        ip,
        isLocal: false,
        location: null,
        timezone: data.timezone || null,
      });
    }

    const parts = [data.country, data.regionName, data.city].filter(Boolean);
    const location = parts.length > 0 ? parts.join(' · ') : null;

    return NextResponse.json({
      ip: data.query || ip,
      isLocal: false,
      location,
      country: data.country ?? null,
      countryCode: data.countryCode ?? null,
      region: data.regionName ?? null,
      city: data.city ?? null,
      zip: data.zip ?? null,
      lat: data.lat ?? null,
      lon: data.lon ?? null,
      timezone: data.timezone ?? null,
    });
  } catch {
    return NextResponse.json({
      ip,
      isLocal: false,
      location: null,
      timezone: null,
    });
  }
}
