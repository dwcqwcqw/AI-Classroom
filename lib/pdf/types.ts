/**
 * PDF Parsing Provider Type Definitions
 */

/** MinerU Cloud v4 `model_version`（见官网精准解析 API） */
export type MinerUCloudModelVersion = 'pipeline' | 'vlm' | 'MinerU-HTML';

/**
 * PDF Provider IDs
 */
export type PDFProviderId = 'unpdf' | 'mineru' | 'mineru-cloud';

/**
 * PDF Provider Configuration
 */
export interface PDFProviderConfig {
  id: PDFProviderId;
  name: string;
  requiresApiKey: boolean;
  baseUrl?: string;
  icon?: string;
  features: string[]; // ['text', 'images', 'tables', 'formulas', 'layout-analysis', etc.]
}

/**
 * PDF Parser Configuration for API calls
 */
export interface PDFParserConfig {
  providerId: PDFProviderId;
  apiKey?: string;
  baseUrl?: string;
  /** MinerU Cloud：`/file-urls/batch` 内 `files[].is_ocr`，默认按实现开启以兼顾扫描件 */
  mineruIsOcr?: boolean;
  /** MinerU Cloud：`files[].page_ranges`，如 `5-12` 或 `2,4-6` */
  mineruPageRanges?: string;
  /** MinerU Cloud：根级 `model_version` */
  mineruModelVersion?: MinerUCloudModelVersion;
}

// Note: ParsedPdfContent is imported from @/lib/types/pdf to avoid duplication
