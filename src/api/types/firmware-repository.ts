export type FirmwareRepositoryStatus = "saved" | "published" | "obsolete";
export type FirmwareRepositoryFile = "yaml" | "bin" | "md5";
export type FirmwareRepositoryArtifactType = "ota" | "factory";

export interface FirmwareRepositorySaveMetadata {
  summary: string;
  release_url?: string;
}

export interface FirmwareRepositoryAccessToken {
  id: string;
  name: string;
  last_four: string;
  created_at: string;
}

export interface FirmwareRepositoryAccessTokenCreated extends FirmwareRepositoryAccessToken {
  token: string;
}

export interface FirmwareRepositoryRecord {
  device: string;
  friendly_name?: string;
  esphome_name?: string;
  version: string;
  compiled_at?: string | null;
  esphome_version?: string;
  ota_bin?: string | null;
  ota_md5?: string | null;
  factory_bin?: string | null;
  factory_md5?: string | null;
  status: FirmwareRepositoryStatus;
  yaml: string;
  bin?: string | null;
  md5?: string | null;
  saved_at: string;
  published_at?: string;
}
