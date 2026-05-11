export interface AdapterDraw {
  draw_no: string;
  draw_date: string;
  date?: string;
  numbers: number[];
  source?: string;
  source_url?: string | null;
  verified?: boolean;
}

export interface AdapterPrediction {
  id?: string | number;
  target_draw_no?: string | null;
  target_date?: string;
  latest_used_draw_no?: string;
  latest_used_draw_date?: string;
  single?: number;
  single_number?: number;
  two_star?: number[];
  three_star?: number[];
  four_star?: number[];
  five_star?: number[];
  bet_advice?: { level?: string; label?: string; confidence?: string; reason_text?: string; risk_flags?: string[] };
  confidence?: string;
  model_version?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface AdapterObservation {
  id?: string | number;
  prediction_id?: string | number | null;
  target_draw_no?: string | null;
  target_date?: string;
  selected_single?: number | null;
  selected_two_star?: number[];
  selected_three_star?: number[];
  selected_four_star?: number[];
  selected_five_star?: number[];
  three_star?: number[];
  actual_numbers?: number[] | null;
  single_hit?: boolean | number | null;
  two_star_hit?: boolean | number | null;
  three_star_hits?: number | null;
  four_star_hits?: number | null;
  five_star_hits?: number | null;
  advice?: string;
  advice_level?: string | null;
  advice_label?: string | null;
  confidence?: string | null;
  model_version?: string;
  created_at?: string;
  evaluated_at?: string | null;
  [key: string]: unknown;
}

export interface DatabaseAdapter {
  getDraws(limit?: number): Promise<AdapterDraw[]>;
  insertDraw(draw: AdapterDraw): Promise<'inserted' | 'existing'>;
  getLatestDraw(): Promise<AdapterDraw | null>;
  savePrediction(prediction: AdapterPrediction): Promise<string | number>;
  getPredictionByDrawNo(draw_no: string): Promise<AdapterPrediction | null>;
  saveObservation(log: AdapterObservation): Promise<void>;
  getObservations(limit?: number): Promise<AdapterObservation[]>;
  getStats(window: number): Promise<{ observations: AdapterObservation[] }>;
}
