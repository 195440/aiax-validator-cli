# AIAX Validator CLI (`aiax-validate`)

Validate and score any site's AIAX v0.1 surface (`/.well-known/aiax.json` or `/aiax/manifest.json` and all declared Tier 1 capability sections) against the official AIAX schemas (`schemas/manifest.schema.json` and `schemas/section.schema.json`).

## Requirements

- Node.js 20 or later

## Installation

```bash
npm install
npm run build
```

Or run directly via `npx`:

```bash
npx aiax-validate <url> [--json] [--fixtures <dir>]
```

## CLI Usage

```bash
# Validate a live site (plain text output)
npx aiax-validate https://lax.kognai.ai

# Validate a live site and print full JSON Report
npx aiax-validate https://www.kognai.ai --json

# Validate offline against a local fixtures directory
npx aiax-validate https://lax.kognai.ai --fixtures ./fixtures/lax-kognai --json
```

### Exit Codes

- `0`: Site is valid (`report.ok === true`)
- `1`: Site failed validation (`report.ok === false`)
- `2`: CLI usage error (missing `<url>`, invalid URL, or unknown option)

## Programmatic API

```ts
import { validateSite, createFixtureFetch } from "@godman-protocols/aiax";

// Live validation
const report = await validateSite("https://lax.kognai.ai");
console.log(report.ok, report.score, report.sections.length);

// Offline validation with custom fetch or fixtures directory
const offlineReport = await validateSite("https://lax.kognai.ai", {
  fetch: createFixtureFetch("./fixtures/lax-kognai"),
});
```

### Report Shape

```ts
interface ValidationIssue {
  url: string;
  path: string; // JSON Pointer (RFC 6901) into the document
  message: string; // Plain English message naming the field and issue
}

interface SectionReport {
  id: string;
  url: string;
  ok: boolean;
  errors: ValidationIssue[];
}

interface Report {
  url: string;
  manifest_url: string;
  ok: boolean;
  score: number; // 0 to 100 (100 with 0 errors and 0 warnings)
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  sections: SectionReport[];
}
```

## Included Fixtures

- `fixtures/lax-kognai/`: Offline snapshot of `https://lax.kognai.ai` (passes with score 100)
- `fixtures/www-kognai/`: Offline snapshot of `https://www.kognai.ai` (passes with score 100)
- `fixtures/broken-manifest/`: Broken manifest demonstrating missing required field (`updated_at`), wrong type (`pricing_summary`), extra field (`unexpected_extra`), and invalid entry point id (`BAD ID!`)
- `fixtures/broken-sections/`: Broken Tier 1 capability sections demonstrating missing field (`purpose`), invalid pricing (`model`, `amount`), mismatched `section_id`, invalid JSON, and missing 404 section
- `fixtures/missing-manifest/`: Empty fixture demonstrating missing manifest handling

## Running Tests

```bash
npm test
```

## License

CC-BY-4.0 (Specification) / MIT (Validator Code)
