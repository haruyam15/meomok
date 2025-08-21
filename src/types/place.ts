export interface PlaceUpsertInput {
  source: 'kakao' | 'google' | 'foursquare';
  source_place_id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  lat: number;
  lng: number;
  cuisines: string[];
  price_level?: number | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  url?: string | null;
}

export interface PlaceSearchRow {
  place_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  cuisines: string[];
  price_level: number | null;
  rating_avg: number | null;
  rating_count: number | null;
  url: string | null;
  distance_m: number;
}

export interface KakaoPlace {
  id: string;
  place_name: string;
  road_address_name: string;
  address_name: string;
  phone: string;
  x: string; // lng
  y: string; // lat
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

export interface ApiSearchResponse {
  places?: PlaceSearchRow[];
  cacheTile?: string;
  fetched?: boolean;
  error?: string;
}
