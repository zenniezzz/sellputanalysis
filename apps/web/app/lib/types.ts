import type { IngestionRun, SnapshotMeta } from '@pss/pipeline';
import type { NearestMatch, ScreenFilters, ScreenedRow } from '@pss/screen';

export interface ScreenResponse {
  meta: SnapshotMeta;
  run: IngestionRun;
  filters: ScreenFilters;
  watchlist: string[];
  visible: ScreenedRow[];
  counts: { priced: number; visible: number; excluded: number };
  nextCursor?: string | null;
  nearestMatches: NearestMatch[];
}

export interface SavedScreenDto {
  id: string;
  name: string;
  query: string;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotBookmarkDto {
  id: string;
  userId: string | null;
  name: string;
  snapshotRunId: string;
  filterQuery: string;
  createdAt: string;
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
