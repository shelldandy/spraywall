export interface Gym {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
  user_role?: string;
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
  user_role?: string;
}

export interface Route {
  id: string;
  wall_id: string;
  wall_image_id: string;
  created_by: string;
  name: string;
  grade: string | null;
  description: string | null;
  hold_ids: string[];
  created_at: string;
  send_count: number;
  has_sent: boolean;
  is_legacy: boolean;
  status: "draft" | "published";
}

export interface Send {
  id: string;
  route_id: string;
  user_id: string;
  sent_at: string;
  attempts: number | null;
  notes: string | null;
}

export interface LogbookEntry {
  id: string;
  route_id: string;
  user_id: string;
  sent_at: string;
  attempts: number | null;
  notes: string | null;
  route_name: string;
  route_grade: string | null;
  wall_name: string;
}
