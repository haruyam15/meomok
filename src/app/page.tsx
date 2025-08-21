// src/app/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { PlaceSearchRow, Cursor } from '@/types/place';

type Radius = 1000 | 3000 | 5000 | 10000;

export default function Home() {
  const LIMIT = 30;

  const [items, setItems] = useState<PlaceSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [radius, setRadius] = useState<Radius>(1000);
  const [center, setCenter] = useState({ lat: 37.4979, lng: 127.0276 });

  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<Cursor>(null);

  const mounted = useRef(false);
  const inFlight = useRef(false);

  // 현재 검색 세션의 스냅샷 (lat,lng,radius가 다르면 다른 세션으로 간주)
  const querySigRef = useRef<string>('');
  const makeSig = (lat: number, lng: number, r: number) =>
    `${lat.toFixed(6)}|${lng.toFixed(6)}|${r}`;

  // 디듀프 머지: place_id 기준, 거리순 정렬
  function mergeByPlaceId(prev: PlaceSearchRow[], next: PlaceSearchRow[]) {
    const map = new Map<string, PlaceSearchRow>();
    for (const p of prev) map.set(p.place_id, p);
    for (const n of next) map.set(n.place_id, n); // 새 데이터가 있으면 교체
    return Array.from(map.values()).sort(
      (a, b) =>
        a.distance_m - b.distance_m || a.place_id.localeCompare(b.place_id)
    );
  }

  async function fetchPage(opts: {
    append: boolean;
    force?: boolean;
    cursor?: Cursor;
    sessionSig?: string; // 세션 일관성 확인용
  }) {
    if (loading || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);

    // 호출 시점의 스냅샷 고정
    const lat = center.lat;
    const lng = center.lng;
    const r = radius;
    const sig = opts.sessionSig ?? makeSig(lat, lng, r);

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat,
          lng,
          radius: r,
          force: opts.force ?? false,
          limit: LIMIT,
          lastDistance: opts.cursor?.lastDistance ?? null,
          lastId: opts.cursor?.lastId ?? null,
        }),
      });

      const json = (await res.json()) as {
        places?: PlaceSearchRow[];
        hasMore?: boolean;
        nextCursor?: Cursor;
        error?: string;
      };
      if (json.error) alert(json.error);

      // 응답이 돌아오는 동안 세션이 바뀌었으면(중심/반경 변경) 이 응답은 버림
      if (sig !== querySigRef.current) return;

      setHasMore(Boolean(json.hasMore));
      setCursor(json.nextCursor ?? null);

      setItems((prev) =>
        opts.append
          ? mergeByPlaceId(prev, json.places ?? [])
          : json.places ?? []
      );
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }

  // 최초 1회: 지오로케이션 성공 후 첫 페이지(강제 수집)만 호출
  useEffect(() => {
    if (!navigator.geolocation) {
      const sig = makeSig(center.lat, center.lng, radius);
      querySigRef.current = sig;
      setItems([]);
      setCursor(null);
      setHasMore(true);
      fetchPage({ append: false, force: true, cursor: null, sessionSig: sig });
      mounted.current = true;
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCenter({ lat, lng });

        const sig = makeSig(lat, lng, radius);
        querySigRef.current = sig;
        setItems([]);
        setCursor(null);
        setHasMore(true);
        fetchPage({
          append: false,
          force: true,
          cursor: null,
          sessionSig: sig,
        });
      },
      () => {
        const sig = makeSig(center.lat, center.lng, radius);
        querySigRef.current = sig;
        setItems([]);
        setCursor(null);
        setHasMore(true);
        fetchPage({
          append: false,
          force: true,
          cursor: null,
          sessionSig: sig,
        });
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );

    mounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 반경 변경 시: 세션 리셋 후 첫 페이지부터 다시
  useEffect(() => {
    if (!mounted.current) return;
    const sig = makeSig(center.lat, center.lng, radius);
    querySigRef.current = sig;
    setItems([]);
    setCursor(null);
    setHasMore(true);
    fetchPage({ append: false, cursor: null, sessionSig: sig });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius]);

  async function loadMore() {
    if (!hasMore || loading || inFlight.current) return;
    await fetchPage({ append: true, cursor, sessionSig: querySigRef.current });
  }

  return (
    <main className="p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-bold">뭐먹 – 주변 맛집</h1>

      <div className="flex gap-2">
        {[1000, 3000, 5000, 10000].map((r) => (
          <button
            key={r}
            className={`px-3 py-2 rounded ${
              radius === r ? 'bg-gray-500 text-white' : 'bg-gray-200'
            }`}
            onClick={() => setRadius(r as Radius)}
            disabled={loading}
          >
            {r / 1000}km
          </button>
        ))}
        <button
          className="px-3 py-2 rounded bg-gray-500 text-white"
          onClick={() => {
            const sig = makeSig(center.lat, center.lng, radius);
            querySigRef.current = sig;
            setItems([]);
            setCursor(null);
            setHasMore(true);
            fetchPage({ append: false, cursor: null, sessionSig: sig });
          }}
          disabled={loading}
        >
          {loading ? '검색 중…' : '검색'}
        </button>
      </div>

      <div className="text-sm opacity-70">
        현재 중심: {center.lat.toFixed(5)}, {center.lng.toFixed(5)}
      </div>

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

      <div className="pt-2">
        {hasMore ? (
          <button
            className="px-4 py-2 rounded bg-gray-200"
            onClick={loadMore}
            disabled={loading}
          >
            더 보기
          </button>
        ) : (
          !loading && (
            <p className="text-sm text-gray-500">마지막 페이지예요.</p>
          )
        )}
      </div>
    </main>
  );
}
