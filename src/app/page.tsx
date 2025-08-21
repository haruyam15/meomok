'use client';

import { supabaseClient } from '@/lib/supabase-client';
import { PlaceSearchRow } from '@/types/place';
import { useState } from 'react';

export default function Home() {
  const [items, setItems] = useState<PlaceSearchRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function search() {
    setLoading(true);
    const { data, error } = await supabaseClient.rpc('search_places', {
      lat: 37.4979,
      lng: 127.0276, // 강남역 4번 출구
      radius_m: 1000,
      cuisines_filter: [], // 예: ['korean']
      price_band: '',
      sort_by: 'distance',
      limit_n: 30,
      offset_n: 0,
    });
    if (error) alert(error.message);
    setItems(data ?? []);
    setLoading(false);
  }

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-4">뭐먹 – 주변 맛집</h1>
      <div className="flex gap-2 mb-4">
        <button className="px-3 py-2 rounded bg-gray-500" onClick={search}>
          강남역 1km 검색
        </button>
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
      </ul>
    </main>
  );
}
