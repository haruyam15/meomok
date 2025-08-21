// src/app/api/search/route.ts
import { NextRequest, NextResponse } from 'next/server';
import ngeohash from 'ngeohash';
import { supabaseServer } from '@/lib/supabase-server';
import type { KakaoPlace, GooglePlace, PlaceUpsertInput } from '@/types/place';

const TTL_MS = 1000 * 60 * 60 * 6; // 6시간
const GH_PREC = 7; // ~150m 타일

type RequestBody = {
  lat: number;
  lng: number;
  radius?: number;
  query?: string;
  force?: boolean;
};

type ApiSearchResponse = {
  places?: unknown[]; // 실제 행 타입이 있다면 PlaceSearchRow[]로 교체
  cacheTile?: string;
  fetched?: boolean;
  error?: string;
};

const CUISINE = (s: string): string[] => {
  const t = (s || '').toLowerCase();
  const a: string[] = [];
  if (/한식|korean/.test(t)) a.push('korean');
  if (/중식|chinese|짜장|짬뽕/.test(t)) a.push('chinese');
  if (/일식|japanese|스시|라멘|돈카츠/.test(t)) a.push('japanese');
  if (/양식|western|이탈리안|피자|버거|스테이크|파스타/.test(t))
    a.push('western');
  return a.length ? a : ['western'];
};

async function shouldFetch(
  lat: number,
  lng: number,
  radius: number
): Promise<{ tile: string; needFetch: boolean }> {
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

async function upsertPlace(p: PlaceUpsertInput): Promise<void> {
  const { error } = await supabaseServer.from('place').upsert(
    {
      source: p.source,
      source_place_id: p.source_place_id,
      name: p.name,
      address: p.address ?? null,
      phone: p.phone ?? null,
      location: `SRID=4326;POINT(${p.lng} ${p.lat})`, // geography(Point,4326) WKT
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

// 응답이 JSON이 아닐 수도 있으므로 안전 파서
async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    const text = await res.text();
    console.error('Non-JSON response', res.status, text.slice(0, 200));
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
    } = (await req.json()) as RequestBody;

    const { tile, needFetch } = await shouldFetch(lat, lng, radius);

    let mustFetch: boolean = force || needFetch;
    if (!mustFetch) {
      const probe = await supabaseServer.rpc('search_places', {
        lat,
        lng,
        radius_m: radius,
        cuisines_filter: [],
        price_band: '',
        sort_by: 'distance',
        limit_n: 1,
        offset_n: 0,
      });
      if (!probe.error && (probe.data?.length ?? 0) === 0) mustFetch = true;
    }

    if (mustFetch) {
      // Kakao
      const kakaoRes: Response = await fetch(
        `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(
          query
        )}&x=${lng}&y=${lat}&radius=${radius}&size=12`,
        {
          headers: {
            Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}`,
          },
        }
      );

      let kakaoDocs: KakaoPlace[] = [];
      if (kakaoRes.ok) {
        const kakao = await safeJson<{ documents?: KakaoPlace[] }>(kakaoRes);
        kakaoDocs = kakao?.documents ?? [];
      } else {
        const text = await kakaoRes.text();
        console.error('Kakao error', kakaoRes.status, text.slice(0, 200));
      }

      for (const k of kakaoDocs) {
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

      // Google
      const googleRes: Response = await fetch(
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
            maxResultCount: 15,
            rankPreference: 'DISTANCE',
            languageCode: 'ko',
            locationRestriction: {
              circle: { center: { latitude: lat, longitude: lng }, radius },
            },
          }),
        }
      );

      let googlePlaces: GooglePlace[] = [];
      if (googleRes.ok) {
        const google = await safeJson<{ places?: GooglePlace[] }>(googleRes);
        googlePlaces = google?.places ?? [];
      } else {
        const text = await googleRes.text();
        console.error('Google error', googleRes.status, text.slice(0, 200));
      }

      for (const g of googlePlaces) {
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

    // 최종 조회
    const { data, error } = await supabaseServer.rpc('search_places', {
      lat,
      lng,
      radius_m: radius,
      cuisines_filter: [],
      price_band: '',
      sort_by: 'distance',
      limit_n: 50,
      offset_n: 0,
    });

    if (error) {
      console.error('search_places error', error.message);
      return NextResponse.json<ApiSearchResponse>(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json<ApiSearchResponse>({
      places: data ?? [],
      cacheTile: tile,
      fetched: mustFetch,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('route /api/search fatal', message);
    return NextResponse.json<ApiSearchResponse>(
      { error: 'Internal error' },
      { status: 500 }
    );
  }
}
