import type { RouteTagId } from "../routeTags";

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
  preview_image_url?: string | null;
}

export interface WallImage {
  id: string;
  wall_id: string;
  storage_key: string;
  image_url: string;
  is_active: boolean;
  created_at: string;
}

export interface ResetHold extends Hold {
  matched_old_hold_id: string | null;
}

export interface ResetRemovedHold {
  old_hold_id: string;
  bbox: Hold["bbox"];
  polygon: Hold["polygon"];
  confidence?: number;
}

export interface ResetDiff {
  detection_status?: string;
  new_holds: ResetHold[];
  removed_holds: ResetRemovedHold[];
  alignment: { ok: boolean; inliers: number };
  affected_routes: { id: string; name: string; grade: string | null; status: string; missing_hold_ids: string[] }[];
  kept_route_count: number;
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
  pending_reset?: { image_id: string; image_url: string; detection_status: string; created_at: string } | null;
  user_role?: string;
}

export interface HoldRoles {
  start: string[];
  finish: string[];
  foot?: string[];
}

export interface Circuit {
  id: string;
  wall_id: string;
  created_by: string;
  creator_name: string;
  name: string;
  color: string;
  emoji: string;
  is_shared: boolean;
  is_owner: boolean;
  route_ids: string[];
  created_at: string;
  updated_at: string;
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
  hold_roles: HoldRoles | null;
  active_hold_ids?: string[];
  active_hold_roles?: HoldRoles | null;
  created_at: string;
  send_count: number;
  has_sent: boolean;
  is_legacy: boolean;
  status: "draft" | "published";
  progress?: "not_tried" | "projects" | "sent";
  has_flashed?: boolean;
  rating_average?: number | null;
  rating_count?: number;
  my_rating?: number | null;
  /** Optional for compatibility with routes restored from older offline caches. */
  tags?: RouteTagId[];
}

export type ClimbOutcome = "attempt" | "send" | "flash";

export interface ClimbLog {
  id: string;
  route_id: string;
  outcome: ClimbOutcome;
  climbed_on: string;
  logged_at: string;
  notes: string | null;
  attempts?: number | null;
}

export interface LogbookEntry extends ClimbLog {
  user_id: string;
  /** Deprecated compatibility alias for cached send clients. */
  sent_at: string;
  route_name: string;
  route_grade: string | null;
  wall_id: string;
  wall_name: string;
  gym_id: string;
  gym_slug: string;
}

export interface AuthConfig {
  password_enabled: boolean;
  oidc: {
    enabled: boolean;
    /** Provider label for buttons, e.g. "Pocket ID". */
    name: string;
  };
}

export interface Identity {
  id: string;
  issuer: string;
  provider_name: string;
  email: string;
  created_at: string;
  // False for identities from a previously configured provider; they can't sign in.
  active: boolean;
}

export interface Me {
  id: string;
  email: string;
  display_name: string;
  role: string;
  created_at: string;
  /** Same-origin path (e.g. "/images/avatars/x.jpg"), served outside /api. */
  avatar_url: string | null;
  has_password: boolean;
  identities: Identity[];
}
