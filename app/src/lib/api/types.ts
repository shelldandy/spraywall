export interface Gym {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
}

export interface Wall {
  id: string;
  gym_id: string;
  name: string;
  created_at: string;
}

export interface WallImage {
  id: string;
  wall_id: string;
  storage_key: string;
  image_url: string;
  is_active: boolean;
  created_at: string;
}

export interface Hold {
  id: string;
  wall_image_id: string;
  bbox: { x: number; y: number; w: number; h: number };
  polygon: number[][] | null;
  confidence: number;
}

export interface DetectionJob {
  id: string;
  wall_image_id: string;
  status: string;
  error: string | null;
  created_at: string;
}

export interface WallDetail {
  wall: Wall;
  image: {
    id: string;
    image_url: string;
    is_active: boolean;
    created_at: string;
  } | null;
  detection_status: string | null;
}
