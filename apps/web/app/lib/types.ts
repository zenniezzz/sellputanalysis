import type { IngestionRun, SnapshotMeta } from '@pss/pipeline';
import type { NearestMatch, ScreenFilters, ScreenedRow } from '@pss/screen';

export interface ScreenResponse {
  meta: SnapshotMeta;
  run: IngestionRun;
  filters: ScreenFilters;
  visible: ScreenedRow[];
  counts: { priced: number; visible: number; excluded: number };
  nearestMatches: NearestMatch[];
  excludedBy: Record<string, string[]>;
}

export interface ContractExplanationDto {
  occSymbol: string;
  strike: number;
  expiration: string;
  dte: number;
  isVisible: boolean;
  failedFilters: string[];
  pipelineExclusion: string | null;
}
