import { NextRequest, NextResponse } from 'next/server';
import ngeohash from 'ngeohash';
import { supabaseServer } from '@/lib/supabase-server';
import type {
  KakaoPlace,
  GooglePlace,
  PlaceUpsertInput,
  PlaceSearchRow,
} from '@/types/place';

const TTL_MS = 1000 * 60 * 60 * 6;
const GH_PREC = 7;

type RequestBody = {
  lat: number;
  lng: number;
  radius?: number;
  query?: string;
  force?: boolean;
  limit?: number;
  // 커서(지난 페이지의 마지막 항목)
  lastDistance?: number | null;
  lastId?: string | null;
};

const CUISINE = (s: string) => {
  const t = (s || '').toLowerCase();
  const a: string[] = [];
  if (/한식|korean/.test(t)) a.push('korean');
  if (/중식|chinese|짜장|짬뽕/.test(t)) a.push('chinese');
  if (/일식|japanese|스시|라멘|돈카츠/.test(t)) a.push('japanese');
  if (/양식|western|이탈리안|피자|버거|스테이크|파스타/.test(t))
    a.push('western');
  return a.length ? a : ['western'];
};

async function shouldFetch(lat: number, lng: number, radius: number) {
  const tile = ngeohash.encode(lat, lng, GH_PREC);
  const { data } = await supabaseServer
    .from('place_fetch_cache')
    .select('fetched_at')
    .eq('tile_id', tile)
    .eq('radius_m', radius)
    .maybeSingle();
  const fresh =
    !!data &&
    Date.now() - new Date(data.fetched_at as string).getTime() < TTL_MS;
  return { tile, needFetch: !fresh };
}

async function upsertPlace(p: PlaceUpsertInput) {
  const { error } = await supabaseServer.from('place').upsert(
    {
      source: p.source,
      source_place_id: p.source_place_id,
      name: p.name,
      address: p.address ?? null,
      phone: p.phone ?? null,
      location: `SRID=4326;POINT(${p.lng} ${p.lat})`,
      cuisines: p.cuisines,
      price_level: p.price_level ?? null,
      rating_avg: p.rating_avg ?? null,
      rating_count: p.rating_count ?? null,
      url: p.url ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'source,source_place_id' }
  );
  if (error) throw error;
}

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const {
      lat,
      lng,
      radius = 1000,
      query = '음식점',
      force = false,
      limit: rawLimit,
      lastDistance = null,
      lastId = null,
    } = (await req.json()) as RequestBody;

    const limit = Math.min(Math.max(rawLimit ?? 30, 1), 200);

    const { tile, needFetch } = await shouldFetch(lat, lng, radius);

    // DB가 비어있으면 강제 수집
    let mustFetch = force || needFetch;
    if (!mustFetch) {
      const probe = await supabaseServer.rpc('search_places_cursor', {
        in_lat: lat,
        in_lng: lng,
        in_radius_m: radius,
        in_last_distance_m: null,
        in_last_place_id: null,
        in_limit_n: 1,
      });
      if (!probe.error && (probe.data?.length ?? 0) === 0) mustFetch = true;
    }

    if (mustFetch) {
      // Kakao(1페이지만; 필요시 반복수집 추가 가능)
      const kakaoRes = await fetch(
        `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(
          query
        )}&x=${lng}&y=${lat}&radius=${radius}&size=15&page=1`,
        {
          headers: {
            Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}`,
          },
        }
      );
      const kakao = kakaoRes.ok
        ? await safeJson<{ documents?: KakaoPlace[] }>(kakaoRes)
        : null;
      for (const k of kakao?.documents ?? []) {
        await upsertPlace({
          source: 'kakao',
          source_place_id: k.id,
          name: k.place_name,
          address: k.road_address_name || k.address_name || null,
          phone: k.phone || null,
          lat: parseFloat(k.y),
          lng: parseFloat(k.x),
          cuisines: CUISINE(`${k.category_name} ${k.place_name}`),
          price_level: null,
          rating_avg: null,
          rating_count: null,
          url: k.place_url || null,
        });
      }

      // Google(1페이지만)
      const gRes = await fetch(
        'https://places.googleapis.com/v1/places:searchNearby',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY ?? '',
            'X-Goog-FieldMask':
              'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel',
          },
          body: JSON.stringify({
            includedTypes: ['restaurant'],
            rankPreference: 'DISTANCE',
            languageCode: 'ko',
            maxResultCount: 20,
            locationRestriction: {
              circle: { center: { latitude: lat, longitude: lng }, radius },
            },
          }),
        }
      );
      const google = gRes.ok
        ? await safeJson<{ places?: GooglePlace[] }>(gRes)
        : null;
      for (const g of google?.places ?? []) {
        await upsertPlace({
          source: 'google',
          source_place_id: g.id,
          name: g.displayName?.text ?? 'Unknown',
          address: null,
          phone: null,
          lat: g.location?.latitude ?? lat,
          lng: g.location?.longitude ?? lng,
          cuisines: CUISINE(g.displayName?.text ?? ''),
          price_level:
            typeof g.priceLevel === 'number' && g.priceLevel > 0
              ? g.priceLevel
              : null,
          rating_avg: g.rating ?? null,
          rating_count: g.userRatingCount ?? null,
          url: null,
        });
      }

      await supabaseServer.from('place_fetch_cache').upsert({
        tile_id: tile,
        radius_m: radius,
        fetched_at: new Date().toISOString(),
      });
    }

    // === 커서 기반 최종 조회 ===
    const { data, error } = await supabaseServer.rpc('search_places_cursor', {
      in_lat: lat,
      in_lng: lng,
      in_radius_m: radius,
      in_last_distance_m: lastDistance,
      in_last_place_id: lastId,
      in_limit_n: limit,
    });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []) as PlaceSearchRow[];
    const hasMore = rows.length === limit;
    const nextCursor = rows.length
      ? {
          lastDistance: rows[rows.length - 1].distance_m,
          lastId: rows[rows.length - 1].place_id,
        }
      : null;

    return NextResponse.json({
      places: rows,
      cacheTile: tile,
      fetched: mustFetch,
      hasMore,
      nextCursor,
    });
  } catch (e) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
