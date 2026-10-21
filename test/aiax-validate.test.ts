import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFixtureFetch, runCli, validateSite } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "fixtures");
const CLI_PATH = path.join(ROOT, "dist", "cli.js");

test("A1: Passes (ok, exit code 0, score >= 90) on lax.kognai.ai and www.kognai.ai", async () => {
  const laxFetch = createFixtureFetch(path.join(FIXTURES, "lax-kognai"));
  const laxReport = await validateSite("https://lax.kognai.ai", { fetch: laxFetch });
  assert.equal(laxReport.ok, true);
  assert.ok(laxReport.score >= 90, `expected score >= 90, got ${laxReport.score}`);
  assert.equal(laxReport.errors.length, 0);
  assert.equal(laxReport.sections.length, 5);
  assert.ok(laxReport.sections.every((s) => s.ok));

  const laxCli = await runCli(
    ["https://lax.kognai.ai", "--fixtures", path.join(FIXTURES, "lax-kognai")],
    undefined
  );
  assert.equal(laxCli.exitCode, 0);

  const wwwFetch = createFixtureFetch(path.join(FIXTURES, "www-kognai"));
  const wwwReport = await validateSite("https://www.kognai.ai", { fetch: wwwFetch });
  assert.equal(wwwReport.ok, true);
  assert.ok(wwwReport.score >= 90, `expected score >= 90, got ${wwwReport.score}`);
  assert.equal(wwwReport.errors.length, 0);
  assert.equal(wwwReport.sections.length, 6);
  assert.ok(wwwReport.sections.every((s) => s.ok));

  // Also test fallback manifest lookup at /aiax/manifest.json when /.well-known/aiax.json is 404
  const fallbackFetch: typeof globalThis.fetch = async (input) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (u.pathname === "/.well-known/aiax.json") {
      return new Response("Not Found", { status: 404 });
    }
    if (u.pathname === "/aiax/manifest.json") {
      return laxFetch("https://lax.kognai.ai/.well-known/aiax.json");
    }
    return laxFetch(u.href);
  };
  const fallbackReport = await validateSite("https://lax.kognai.ai", { fetch: fallbackFetch });
  assert.equal(fallbackReport.ok, true);
  assert.equal(fallbackReport.manifest_url, "https://lax.kognai.ai/aiax/manifest.json");
  assert.ok(fallbackReport.score >= 90);
});

test("A2: Broken manifest (missing required field, wrong type, extra field, bad entry point id) fails with clear messages naming each field", async () => {
  const brokenFetch = createFixtureFetch(path.join(FIXTURES, "broken-manifest"));
  const report = await validateSite("https://broken.example.com", { fetch: brokenFetch });

  assert.equal(report.ok, false);
  assert.ok(report.score < 100);

  // 1. Missing required field: updated_at
  const missingUpdated = report.errors.find((e) => e.path === "/updated_at");
  assert.ok(missingUpdated, "expected error for missing updated_at");
  assert.match(missingUpdated.message, /updated_at/i);

  // 2. Wrong type: pricing_summary is a number instead of string or null
  const wrongPricingSummary = report.errors.find((e) => e.path === "/pricing_summary");
  assert.ok(wrongPricingSummary, "expected error for wrong type on pricing_summary");
  assert.match(wrongPricingSummary.message, /pricing_summary/i);

  // 3. Extra field: unexpected_extra
  const extraField = report.errors.find((e) => e.path === "/unexpected_extra");
  assert.ok(extraField, "expected error for extra field unexpected_extra");
  assert.match(extraField.message, /unexpected_extra/i);

  // 4. Bad entry point id: "BAD ID!"
  const badEntryId = report.errors.find((e) => e.path === "/entry_points/0/id");
  assert.ok(badEntryId, "expected error for bad entry_points[0].id");
  assert.match(badEntryId.message, /entry_points\[0\]\.id|id/i);
});

test("A3: Broken section (missing field, bad pricing, mismatched section_id, missing or non-JSON section) fails with clear messages", async () => {
  const brokenSecFetch = createFixtureFetch(path.join(FIXTURES, "broken-sections"));
  const report = await validateSite("https://sections.example.com", { fetch: brokenSecFetch });

  assert.equal(report.ok, false);
  assert.equal(report.sections.length, 5);

  // 1. Missing required field in section (purpose)
  const secMissingField = report.sections.find((s) => s.id === "missing_field");
  assert.ok(secMissingField && !secMissingField.ok);
  assert.ok(
    secMissingField.errors.some((e) => e.path === "/purpose" && /purpose/i.test(e.message)),
    "expected error naming missing field purpose"
  );

  // 2. Bad pricing in section
  const secBadPricing = report.sections.find((s) => s.id === "bad_pricing");
  assert.ok(secBadPricing && !secBadPricing.ok);
  assert.ok(
    secBadPricing.errors.some(
      (e) => e.path === "/pricing/model" && /pricing\.model/i.test(e.message)
    ),
    "expected error naming pricing.model"
  );
  assert.ok(
    secBadPricing.errors.some(
      (e) => e.path === "/pricing/amount" && /pricing\.amount/i.test(e.message)
    ),
    "expected error naming pricing.amount"
  );

  // 3. Mismatched section_id vs entry point id
  const secMismatch = report.sections.find((s) => s.id === "mismatched_id");
  assert.ok(secMismatch && !secMismatch.ok);
  assert.ok(
    secMismatch.errors.some(
      (e) => e.path === "/section_id" && /section_id/i.test(e.message)
    ),
    "expected error naming section_id mismatch"
  );

  // 4. Section is not JSON
  const secNotJson = report.sections.find((s) => s.id === "not_json");
  assert.ok(secNotJson && !secNotJson.ok);
  assert.ok(
    secNotJson.errors.some((e) => /not valid JSON/i.test(e.message)),
    "expected error for non-JSON section"
  );

  // 5. Missing section (404)
  const secMissing = report.sections.find((s) => s.id === "missing_section");
  assert.ok(secMissing && !secMissing.ok);
  assert.ok(
    secMissing.errors.some((e) => /could not be fetched|404/i.test(e.message)),
    "expected error for missing 404 section"
  );

  // Also verify missing manifest produces ok=false and score=0
  const missingManifestFetch = createFixtureFetch(path.join(FIXTURES, "missing-manifest"));
  const missingManifestReport = await validateSite("https://missing.example.com", {
    fetch: missingManifestFetch,
  });
  assert.equal(missingManifestReport.ok, false);
  assert.equal(missingManifestReport.score, 0);
  assert.ok(missingManifestReport.errors.length >= 1);
});

test("A4: CLI --json prints Report as JSON, without --json prints one plain line per error, and exit codes are 0, 1 and 2", async () => {
  // Exit code 0 with --json
  const out0 = execFileSync(
    process.execPath,
    [
      CLI_PATH,
      "https://lax.kognai.ai",
      "--json",
      "--fixtures",
      path.join(FIXTURES, "lax-kognai"),
    ],
    { encoding: "utf8" }
  );
  const parsed0 = JSON.parse(out0);
  assert.equal(parsed0.ok, true);
  assert.ok(parsed0.score >= 90);

  // Exit code 1 with --json on broken manifest
  let status1 = 0;
  let stdout1 = "";
  try {
    execFileSync(
      process.execPath,
      [
        CLI_PATH,
        "https://broken.example.com",
        "--json",
        "--fixtures",
        path.join(FIXTURES, "broken-manifest"),
      ],
      { encoding: "utf8" }
    );
  } catch (err: any) {
    status1 = err.status;
    stdout1 = err.stdout;
  }
  assert.equal(status1, 1);
  const parsed1 = JSON.parse(stdout1);
  assert.equal(parsed1.ok, false);
  assert.ok(parsed1.errors.length >= 4);

  // Exit code 1 without --json prints one plain line per error
  let plainStatus1 = 0;
  let plainStdout1 = "";
  try {
    execFileSync(
      process.execPath,
      [
        CLI_PATH,
        "https://broken.example.com",
        "--fixtures",
        path.join(FIXTURES, "broken-manifest"),
      ],
      { encoding: "utf8" }
    );
  } catch (err: any) {
    plainStatus1 = err.status;
    plainStdout1 = err.stdout;
  }
  assert.equal(plainStatus1, 1);
  const lines = plainStdout1.trim().split("\n");
  assert.equal(lines.length, parsed1.errors.length);

  // Exit code 2 on usage error (missing URL or unknown option)
  let status2Missing = 0;
  try {
    execFileSync(process.execPath, [CLI_PATH], { encoding: "utf8", stdio: "pipe" });
  } catch (err: any) {
    status2Missing = err.status;
  }
  assert.equal(status2Missing, 2);

  let status2Flag = 0;
  try {
    execFileSync(process.execPath, [CLI_PATH, "https://lax.kognai.ai", "--unknown-flag"], {
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (err: any) {
    status2Flag = err.status;
  }
  assert.equal(status2Flag, 2);
});

test("A5: Package metadata, bin entry and broken fixtures exist in repository", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.ok(pkg.bin && pkg.bin["aiax-validate"], "package.json must declare bin.aiax-validate");
  assert.ok(fs.existsSync(CLI_PATH), "compiled CLI binary must exist");
  assert.ok(
    fs.existsSync(path.join(FIXTURES, "broken-manifest", ".well-known", "aiax.json")),
    "broken-manifest fixture must exist"
  );
  assert.ok(
    fs.existsSync(path.join(FIXTURES, "broken-sections", ".well-known", "aiax.json")),
    "broken-sections fixture must exist"
  );
});
