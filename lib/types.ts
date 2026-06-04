export type BoardFormat = 'daily' | 'weekly';
export type UploadStatus = 'pending' | 'extracting' | 'review' | 'published';
export type ActivityStatus = 'green' | 'yellow' | 'red';

export interface Project {
  id: string;
  name: string;
  building_geometry: unknown;
  created_at: string;
}

export interface TradeLegend {
  id: string;
  project_id: string;
  color_hex: string;
  trade_key: string;
  company_name: string;
  foreman_name: string | null;
  created_at: string;
}

export interface Upload {
  id: string;
  project_id: string;
  uploaded_by: string | null;
  uploaded_at: string;
  week_start_date: string | null;
  photo_urls: string[];
  board_format: BoardFormat;
  status: UploadStatus;
}

export interface Activity {
  id: string;
  upload_id: string;
  project_id: string;
  area: string;
  area_sub: string | null;
  level: number;
  day_key: string | null;
  week_of: string | null;
  trade: string;
  task_name: string;
  predecessor: string | null;
  crew_size: number | null;
  duration_days: number | null;
  duration_text: string | null;
  is_milestone: boolean;
  is_starred: boolean;
  status: ActivityStatus;
  constraint_text: string | null;
  confidence: number;
  needs_review: boolean;
  created_at: string;
  updated_at: string;
}
