export interface ValidationIssue {
  /** Document URL where the issue occurred */
  url: string;
  /** JSON Pointer (RFC 6901) into the document, e.g. "/product/name" or "" for root */
  path: string;
  /** Plain English explanation naming the field and what is wrong */
  message: string;
}

export interface SectionReport {
  /** Entry point id from the manifest */
  id: string;
  /** Resolved URL of the section document */
  url: string;
  /** True when the section was fetched and passed all schema and consistency checks */
  ok: boolean;
  /** Validation errors for this section */
  errors: ValidationIssue[];
}

export interface Report {
  /** Normalized site URL that was validated */
  url: string;
  /** Resolved manifest URL that was used (or attempted) */
  manifest_url: string;
  /** True when the manifest and all declared sections have zero errors */
  ok: boolean;
  /** Score from 0 to 100 (100 with no error and no warning, lower with each error) */
  score: number;
  /** All errors across the manifest and its sections */
  errors: ValidationIssue[];
  /** Warnings across the manifest and its sections */
  warnings: ValidationIssue[];
  /** Per-section validation results */
  sections: SectionReport[];
}

export interface ValidateSiteOptions {
  /** Custom fetch implementation (defaults to globalThis.fetch) */
  fetch?: typeof globalThis.fetch;
  /** Optional local fixtures directory for offline resolution */
  fixtures?: string;
}
