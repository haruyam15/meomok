import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server'; // 서버 전용 클라이언트
import { PlaceUpsertInput, KakaoPlace, GooglePlace } from '@/types/place';

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

async function upsertPlace(p: PlaceUpsertInput) {
  const { error } = await supabaseServer.from('place').upsert(
    {
      source: p.source,
      source_place_id: p.source_place_id,
      name: p.name,
      address: p.address ?? null,
      phone: p.phone ?? null,
      // geography 입력은 WKT로
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

export async function POST(req: NextRequest) {
  const { lat, lng, radius = 1000, query = '음식점' } = await req.json();

  // Kakao
  const kakaoJson: { documents?: KakaoPlace[] } = await fetch(
    `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(
      query
    )}&x=${lng}&y=${lat}&radius=${radius}&size=10`,
    { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` } }
  ).then((r) => r.json());

  for (const k of kakaoJson.documents ?? []) {
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

  // Google Places Nearby
  const googleJson: { places?: GooglePlace[] } = await fetch(
    'https://places.googleapis.com/v1/places:searchNearby',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY!,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.websiteUri',
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
  ).then((r) => r.json());

  for (const g of googleJson.places ?? []) {
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
      url: g.websiteUri ?? null,
    });
  }

  return NextResponse.json({
    kakao: kakaoJson.documents?.length ?? 0,
    google: googleJson.places?.length ?? 0,
  });
}
