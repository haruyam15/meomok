'use client';

import { useEffect, useRef, useState } from 'react';
import type { ApiSearchResponse, PlaceSearchRow } from '@/types/place';

type Radius = 1000 | 3000 | 5000 | 10000;

export default function Home() {
  const [items, setItems] = useState<PlaceSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [radius, setRadius] = useState<Radius>(1000);
  const [center, setCenter] = useState<{ lat: number; lng: number }>({
    lat: 37.4979,
    lng: 127.0276,
  });
  const mounted = useRef(false);

  async function search(opts?: { force?: boolean }) {
    setLoading(true);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: center.lat,
          lng: center.lng,
          radius,
          force: opts?.force ?? false,
        }),
      });
      const json: ApiSearchResponse = await res.json();
      if (json.error) alert(json.error);
      setItems(json.places ?? []);
      // console.log('fetched?', json.fetched, 'tile:', json.cacheTile);
    } finally {
      setLoading(false);
    }
  }

  // 처음 들어오면 현재 위치로 이동 후 1회 강제 수집
  useEffect(() => {
    if (!navigator.geolocation) {
      // 지오로케이션 미지원 브라우저면 기본 좌표로 강제 수집
      search({ force: true });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCenter({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        search({ force: true }); // 최초 1회는 캐시 무시
      },
      () => {
        // 실패 시 기본 좌표로 강제 수집
        search({ force: true });
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
    mounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 반경 바뀌면 자동 재검색(캐시는 라우트에서 처리)
  useEffect(() => {
    if (!mounted.current) return;
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius]);

  return (
    <main className="p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-bold">뭐먹 – 주변 맛집</h1>

      {/* 반경 버튼 */}
      <div className="flex gap-2">
        {[1000, 3000, 5000, 10000].map((r) => (
          <button
            key={r}
            className={`px-3 py-2 rounded ${
              radius === r ? 'bg-gray-500 text-white' : 'bg-gray-200'
            }`}
            onClick={() => setRadius(r as Radius)}
          >
            {r / 1000}km
          </button>
        ))}

        {/* 수동 검색 버튼 */}
        <button
          className="px-3 py-2 rounded bg-gray-500 text-white"
          onClick={() => search()}
          disabled={loading}
        >
          {loading ? '검색 중…' : '검색'}
        </button>

        {/* 강제 수집 버튼(디버그용) */}
        <button
          className="px-3 py-2 rounded bg-gray-300 text-black"
          onClick={() => search({ force: true })}
          disabled={loading}
          title="캐시 무시하고 외부 API 재수집"
        >
          강제수집
        </button>
      </div>

      <div className="text-sm opacity-70">
        현재 중심: {center.lat.toFixed(5)}, {center.lng.toFixed(5)}
      </div>

      {loading && <p>불러오는 중...</p>}

      <ul className="space-y-3">
        {items.map((p) => (
          <li key={p.place_id} className="p-3 rounded border">
            <div className="font-medium">{p.name}</div>
            <div className="text-sm text-gray-600">
              {Math.round(p.distance_m)}m • ⭐ {p.rating_avg ?? '-'} • ₩
              {p.price_level ?? '-'}
            </div>
            <div className="text-sm">{p.address}</div>
          </li>
        ))}
        {!loading && items.length === 0 && (
          <li className="text-sm text-gray-500">주변 결과가 없어요.</li>
        )}
      </ul>
    </main>
  );
}
