import type { Report, ValidateSiteOptions, ValidationIssue } from "./types.js";
export declare function normalizeSiteUrl(rawUrl: string): string;
export declare function createFixtureFetch(fixturesDir: string): typeof globalThis.fetch;
export declare function validateManifestDocument(doc: unknown, manifestUrl: string): {
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
};
export declare function validateSectionDocument(doc: unknown, sectionUrl: string, expectedId: string): ValidationIssue[];
export declare function validateSite(url: string, options?: ValidateSiteOptions): Promise<Report>;
//# sourceMappingURL=validate.d.ts.map