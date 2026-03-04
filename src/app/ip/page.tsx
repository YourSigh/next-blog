'use client';

import { useEffect, useState } from 'react';

type IpInfo = {
  ip: string;
  isLocal: boolean;
  location: string | null;
  timezone: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  lat?: number | null;
  lon?: number | null;
};

const cardStyle = {
  padding: 16,
  borderRadius: 12,
  border: '1px solid color-mix(in oklab, var(--foreground) 12%, transparent)',
  background: 'color-mix(in oklab, var(--foreground) 4%, transparent)',
};

export default function IpPage() {
  const [info, setInfo] = useState<IpInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skipGeo, setSkipGeo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/ip${skipGeo ? '?geo=0' : ''}`)
      .then((res) => {
        if (!res.ok) throw new Error(`请求失败: ${res.status}`);
        return res.json();
      })
      .then((data: IpInfo) => {
        if (!cancelled) setInfo(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || '获取 IP 信息失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skipGeo]);

  if (loading) {
    return (
      <div
        style={{
          maxWidth: 560,
          margin: '0 auto',
          padding: '24px 16px',
          minHeight: 'calc(100vh - var(--app-header-h) - 48px)',
        }}
      >
        <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>本机 IP 与位置</h1>
        <p style={{ opacity: 0.7, margin: 0, fontSize: 14 }}>正在获取当前访问本站的 IP 及地理位置…</p>
        <div style={{ ...cardStyle, marginTop: 20, textAlign: 'center', opacity: 0.8 }}>
          加载中…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          maxWidth: 560,
          margin: '0 auto',
          padding: '24px 16px',
          minHeight: 'calc(100vh - var(--app-header-h) - 48px)',
        }}
      >
        <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>本机 IP 与位置</h1>
        <p style={{ opacity: 0.7, margin: 0, fontSize: 14 }}>当前访问本网站时使用的 IP 及大致位置</p>
        <div style={{ ...cardStyle, marginTop: 20, color: 'var(--foreground)' }}>{error}</div>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 560,
        margin: '0 auto',
        padding: '24px 16px',
        minHeight: 'calc(100vh - var(--app-header-h) - 48px)',
      }}
    >
      <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>本机 IP 与位置</h1>
      <p style={{ opacity: 0.7, margin: 0, fontSize: 14 }}>
        当前访问本网站时使用的 IP 及大致位置
      </p>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={skipGeo}
          onChange={(e) => setSkipGeo(e.target.checked)}
        />
        仅显示 IP（不请求第三方，IP 由服务器从本次请求直接得到）
      </label>

      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>当前 IP</div>
          <div style={{ fontSize: 20, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>
            {info?.ip ?? '—'}
          </div>
          <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>
            IP 由您访问本站时的请求头（x-forwarded-for / x-real-ip）直接得到，不经过任何第三方
          </div>
          {info?.isLocal && (
            <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>内网 / 本地访问</div>
          )}
        </div>

        {(info?.location ?? info?.city ?? info?.region ?? info?.country) && (
          <div style={cardStyle}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>位置（来自第三方 Geo 服务，可选）</div>
            <div style={{ fontSize: 16 }}>
              {info?.location ?? [info?.country, info?.region, info?.city].filter(Boolean).join(' · ') ?? '—'}
            </div>
            {(info?.timezone) && (
              <div style={{ fontSize: 13, opacity: 0.8, marginTop: 8 }}>时区：{info.timezone}</div>
            )}
          </div>
        )}

        {info?.lat != null && info?.lon != null && (
          <div style={cardStyle}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>经纬度</div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 14 }}>
              {info.lat.toFixed(4)}, {info.lon.toFixed(4)}
            </div>
          </div>
        )}

        {info && !info.location && !info.city && !info.region && !info.country && !info.isLocal && (
          <div style={{ ...cardStyle, opacity: 0.85 }}>暂无地理位置信息</div>
        )}
      </div>
    </div>
  );
}
