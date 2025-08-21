// DB에 upsert할 때 사용하는 입력 타입
export interface PlaceUpsertInput {
  source: 'kakao' | 'google' | 'foursquare';
  source_place_id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  lat: number; // upsert 시에는 lat/lng 분리
  lng: number;
  cuisines: string[];
  price_level?: number | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  url?: string | null;
}

// search_places RPC로 조회할 때 받는 행 타입
export interface PlaceSearchRow {
  place_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  lat: number; // RPC에서 뽑아주는 컬럼
  lng: number;
  cuisines: string[];
  price_level: number | null;
  rating_avg: number | null;
  rating_count: number | null;
  url: string | null;
  distance_m: number; // RPC에서 계산됨
}

// Kakao / Google 원본 응답 타입 (간단형)
export interface KakaoPlace {
  id: string;
  place_name: string;
  road_address_name: string;
  address_name: string;
  phone: string;
  x: string; // 경도
  y: string; // 위도
  category_name: string;
  place_url: string;
}

export interface GooglePlace {
  id: string;
  displayName?: { text: string };
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: number;
  websiteUri?: string;
}
