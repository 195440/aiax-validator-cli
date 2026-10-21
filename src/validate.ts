import fs from "node:fs";
import path from "node:path";
import type { Report, SectionReport, ValidateSiteOptions, ValidationIssue } from "./types.js";

const MANIFEST_REQUIRED = [
  "aiax_version",
  "product",
  "entry_points",
  "pricing_summary",
  "trust_signals",
  "mcp_endpoint",
  "updated_at",
] as const;

const MANIFEST_ALLOWED = new Set<string>([
  ...MANIFEST_REQUIRED,
  "llms_txt_url",
  "openapi_url",
  "extensions",
]);

const PRODUCT_REQUIRED = ["name", "one_line_purpose", "domain"] as const;
const PRODUCT_ALLOWED = new Set<string>(PRODUCT_REQUIRED);

const ENTRY_POINT_REQUIRED = ["id", "url", "purpose", "est_tokens"] as const;
const ENTRY_POINT_ALLOWED = new Set<string>(ENTRY_POINT_REQUIRED);

const TRUST_SIGNALS_ALLOWED = new Set<string>([
  "score",
  "pact_endpoint",
  "drs_receipt_count",
  "partnerships",
]);

const SECTION_REQUIRED = [
  "aiax_version",
  "section_id",
  "purpose",
  "inputs",
  "outputs",
  "pricing",
  "examples",
  "pact_mandate_template",
] as const;

const SECTION_ALLOWED = new Set<string>([
  ...SECTION_REQUIRED,
  "mcp_tool_name",
  "openapi_operation_id",
  "latency_p50_ms",
  "latency_p99_ms",
  "extensions",
]);

const PRICING_REQUIRED = ["model", "amount", "currency", "rail"] as const;
const PRICING_ALLOWED = new Set<string>(PRICING_REQUIRED);
const PRICING_MODELS = new Set<string>([
  "per_call",
  "per_minute",
  "per_token",
  "flat",
  "free",
  "subscription",
]);

const EXAMPLE_REQUIRED = ["description", "request", "response"] as const;
const EXAMPLE_ALLOWED = new Set<string>(EXAMPLE_REQUIRED);

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,60}$/;
const AMOUNT_PATTERN = /^[0-9]+(\.[0-9]+)?$/;
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function ptr(...segments: Array<string | number>): string {
  if (segments.length === 0) return "";
  return (
    "/" +
    segments
      .map((s) => String(s).replace(/~/g, "~0").replace(/\//g, "~1"))
      .join("/")
  );
}

function isValidUri(v: unknown): boolean {
  if (typeof v !== "string" || v.trim().length === 0 || /\s/.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidUriReference(v: unknown): boolean {
  if (typeof v !== "string" || v.trim().length === 0 || /\s/.test(v)) return false;
  try {
    new URL(v, "https://example.com/.well-known/aiax.json");
    return true;
  } catch {
    return false;
  }
}

function isValidIsoDateTime(v: unknown): boolean {
  if (typeof v !== "string" || !ISO_DATETIME_PATTERN.test(v)) return false;
  const ms = Date.parse(v);
  return Number.isFinite(ms);
}

export function normalizeSiteUrl(rawUrl: string): string {
  if (typeof rawUrl !== "string") {
    throw new Error("URL argument must be a string");
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("URL argument is required");
  }
  let candidate = trimmed;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
    if (
      /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(:\d+)?(\/.*)?$/.test(candidate) ||
      /^localhost(:\d+)?(\/.*)?$/.test(candidate)
    ) {
      candidate = `https://${candidate}`;
    } else {
      throw new Error(`Invalid site URL: ${rawUrl}`);
    }
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Invalid site URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol in ${rawUrl}: expected http or https`);
  }
  if (!parsed.hostname) {
    throw new Error(`Invalid site URL hostname: ${rawUrl}`);
  }
  if (parsed.pathname === "/" && !trimmed.endsWith("/")) {
    return parsed.origin;
  }
  return parsed.href.replace(/\/+$/, "") || parsed.origin;
}

export function createFixtureFetch(fixturesDir: string): typeof globalThis.fetch {
  const root = path.resolve(fixturesDir);
  return async (input: string | URL | Request): Promise<Response> => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url;
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
    const relPath = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    const targetPath = path.resolve(root, relPath);
    if (targetPath !== root && !targetPath.startsWith(root + path.sep)) {
      return new Response("Not Found", { status: 404 });
    }
    try {
      const stat = fs.statSync(targetPath);
      if (!stat.isFile()) {
        return new Response("Not Found", { status: 404 });
      }
      const body = fs.readFileSync(targetPath, "utf8");
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  };
}

export function validateManifestDocument(
  doc: unknown,
  manifestUrl: string
): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const err = (jsonPath: string, message: string) => {
    errors.push({ url: manifestUrl, path: jsonPath, message });
  };

  if (!isPlainObject(doc)) {
    err("", "manifest document must be a JSON object");
    return { errors, warnings };
  }

  for (const reqField of MANIFEST_REQUIRED) {
    if (!(reqField in doc) || doc[reqField] === undefined) {
      err(ptr(reqField), `missing required field '${reqField}' in manifest`);
    }
  }

  for (const key of Object.keys(doc)) {
    if (!MANIFEST_ALLOWED.has(key)) {
      err(ptr(key), `unexpected extra field '${key}' is not allowed in manifest`);
    }
  }

  if ("aiax_version" in doc && doc.aiax_version !== undefined) {
    if (typeof doc.aiax_version !== "string") {
      err(ptr("aiax_version"), "field 'aiax_version' must be a string with value '0.1'");
    } else if (doc.aiax_version !== "0.1") {
      err(ptr("aiax_version"), `field 'aiax_version' must be '0.1', got '${doc.aiax_version}'`);
    }
  }

  if ("product" in doc && doc.product !== undefined) {
    if (!isPlainObject(doc.product)) {
      err(ptr("product"), "field 'product' must be a JSON object");
    } else {
      const prod = doc.product;
      for (const pf of PRODUCT_REQUIRED) {
        if (!(pf in prod) || prod[pf] === undefined) {
          err(ptr("product", pf), `missing required field 'product.${pf}'`);
        }
      }
      for (const pk of Object.keys(prod)) {
        if (!PRODUCT_ALLOWED.has(pk)) {
          err(ptr("product", pk), `unexpected extra field 'product.${pk}' is not allowed`);
        }
      }
      if ("name" in prod && prod.name !== undefined) {
        if (typeof prod.name !== "string" || prod.name.trim().length === 0) {
          err(ptr("product", "name"), "field 'product.name' must be a non-empty string");
        } else if (prod.name.length > 60) {
          err(ptr("product", "name"), "field 'product.name' must be at most 60 characters");
        }
      }
      if ("one_line_purpose" in prod && prod.one_line_purpose !== undefined) {
        if (
          typeof prod.one_line_purpose !== "string" ||
          prod.one_line_purpose.trim().length === 0
        ) {
          err(
            ptr("product", "one_line_purpose"),
            "field 'product.one_line_purpose' must be a non-empty string"
          );
        } else if (prod.one_line_purpose.length > 160) {
          err(
            ptr("product", "one_line_purpose"),
            "field 'product.one_line_purpose' must be at most 160 characters"
          );
        }
      }
      if ("domain" in prod && prod.domain !== undefined) {
        if (typeof prod.domain !== "string" || prod.domain.trim().length === 0) {
          err(ptr("product", "domain"), "field 'product.domain' must be a non-empty string");
        } else if (prod.domain.length > 60) {
          err(ptr("product", "domain"), "field 'product.domain' must be at most 60 characters");
        }
      }
    }
  }

  if ("entry_points" in doc && doc.entry_points !== undefined) {
    if (!Array.isArray(doc.entry_points)) {
      err(ptr("entry_points"), "field 'entry_points' must be an array");
    } else if (doc.entry_points.length < 1) {
      err(ptr("entry_points"), "field 'entry_points' must have at least 1 item");
    } else {
      doc.entry_points.forEach((ep: unknown, i: number) => {
        if (!isPlainObject(ep)) {
          err(ptr("entry_points", i), `field 'entry_points[${i}]' must be an object`);
          return;
        }
        for (const ef of ENTRY_POINT_REQUIRED) {
          if (!(ef in ep) || ep[ef] === undefined) {
            err(
              ptr("entry_points", i, ef),
              `missing required field 'entry_points[${i}].${ef}'`
            );
          }
        }
        for (const ek of Object.keys(ep)) {
          if (!ENTRY_POINT_ALLOWED.has(ek)) {
            err(
              ptr("entry_points", i, ek),
              `unexpected extra field 'entry_points[${i}].${ek}' is not allowed`
            );
          }
        }
        if ("id" in ep && ep.id !== undefined) {
          if (typeof ep.id !== "string" || !ID_PATTERN.test(ep.id)) {
            err(
              ptr("entry_points", i, "id"),
              `field 'entry_points[${i}].id' must match pattern ^[a-z0-9][a-z0-9_-]{0,60}$`
            );
          }
        }
        if ("url" in ep && ep.url !== undefined) {
          if (!isValidUriReference(ep.url)) {
            err(
              ptr("entry_points", i, "url"),
              `field 'entry_points[${i}].url' must be a valid URI reference string`
            );
          }
        }
        if ("purpose" in ep && ep.purpose !== undefined) {
          if (typeof ep.purpose !== "string" || ep.purpose.trim().length === 0) {
            err(
              ptr("entry_points", i, "purpose"),
              `field 'entry_points[${i}].purpose' must be a non-empty string`
            );
          } else if (ep.purpose.length > 200) {
            err(
              ptr("entry_points", i, "purpose"),
              `field 'entry_points[${i}].purpose' must be at most 200 characters`
            );
          }
        }
        if ("est_tokens" in ep && ep.est_tokens !== undefined) {
          if (
            typeof ep.est_tokens !== "number" ||
            !Number.isInteger(ep.est_tokens) ||
            ep.est_tokens < 1 ||
            ep.est_tokens > 5000
          ) {
            err(
              ptr("entry_points", i, "est_tokens"),
              `field 'entry_points[${i}].est_tokens' must be an integer between 1 and 5000`
            );
          }
        }
      });
    }
  }

  if ("pricing_summary" in doc && doc.pricing_summary !== undefined) {
    if (doc.pricing_summary !== null) {
      if (typeof doc.pricing_summary !== "string") {
        err(ptr("pricing_summary"), "field 'pricing_summary' must be a string or null");
      } else if (doc.pricing_summary.length > 200) {
        err(
          ptr("pricing_summary"),
          "field 'pricing_summary' must be at most 200 characters"
        );
      }
    }
  }

  if ("trust_signals" in doc && doc.trust_signals !== undefined) {
    if (!isPlainObject(doc.trust_signals)) {
      err(ptr("trust_signals"), "field 'trust_signals' must be a JSON object");
    } else {
      const ts = doc.trust_signals;
      for (const tk of Object.keys(ts)) {
        if (!TRUST_SIGNALS_ALLOWED.has(tk)) {
          err(
            ptr("trust_signals", tk),
            `unexpected extra field 'trust_signals.${tk}' is not allowed`
          );
        }
      }
      if ("score" in ts && ts.score !== undefined && ts.score !== null) {
        if (
          typeof ts.score !== "number" ||
          !Number.isFinite(ts.score) ||
          ts.score < 0 ||
          ts.score > 100
        ) {
          err(
            ptr("trust_signals", "score"),
            "field 'trust_signals.score' must be a number between 0 and 100 or null"
          );
        }
      }
      if (
        "pact_endpoint" in ts &&
        ts.pact_endpoint !== undefined &&
        ts.pact_endpoint !== null
      ) {
        if (!isValidUri(ts.pact_endpoint)) {
          err(
            ptr("trust_signals", "pact_endpoint"),
            "field 'trust_signals.pact_endpoint' must be a valid URI string or null"
          );
        }
      }
      if (
        "drs_receipt_count" in ts &&
        ts.drs_receipt_count !== undefined &&
        ts.drs_receipt_count !== null
      ) {
        if (
          typeof ts.drs_receipt_count !== "number" ||
          !Number.isInteger(ts.drs_receipt_count) ||
          ts.drs_receipt_count < 0
        ) {
          err(
            ptr("trust_signals", "drs_receipt_count"),
            "field 'trust_signals.drs_receipt_count' must be a non-negative integer or null"
          );
        }
      }
      if ("partnerships" in ts && ts.partnerships !== undefined) {
        if (
          !Array.isArray(ts.partnerships) ||
          ts.partnerships.length > 5 ||
          ts.partnerships.some((p) => typeof p !== "string" || p.length > 60)
        ) {
          err(
            ptr("trust_signals", "partnerships"),
            "field 'trust_signals.partnerships' must be an array of at most 5 strings (max 60 characters each)"
          );
        }
      }
    }
  }

  if ("mcp_endpoint" in doc && doc.mcp_endpoint !== undefined && doc.mcp_endpoint !== null) {
    if (!isValidUri(doc.mcp_endpoint)) {
      err(ptr("mcp_endpoint"), "field 'mcp_endpoint' must be a valid URI string or null");
    }
  }

  if ("updated_at" in doc && doc.updated_at !== undefined) {
    if (!isValidIsoDateTime(doc.updated_at)) {
      err(
        ptr("updated_at"),
        "field 'updated_at' must be a valid ISO-8601 date-time string"
      );
    }
  }

  if ("llms_txt_url" in doc && doc.llms_txt_url !== undefined) {
    if (!isValidUri(doc.llms_txt_url)) {
      err(ptr("llms_txt_url"), "field 'llms_txt_url' must be a valid URI string");
    }
  }

  if ("openapi_url" in doc && doc.openapi_url !== undefined) {
    if (!isValidUri(doc.openapi_url)) {
      err(ptr("openapi_url"), "field 'openapi_url' must be a valid URI string");
    }
  }

  if ("extensions" in doc && doc.extensions !== undefined) {
    if (!isPlainObject(doc.extensions)) {
      err(ptr("extensions"), "field 'extensions' must be a JSON object");
    }
  }

  return { errors, warnings };
}

export function validateSectionDocument(
  doc: unknown,
  sectionUrl: string,
  expectedId: string
): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const err = (jsonPath: string, message: string) => {
    errors.push({ url: sectionUrl, path: jsonPath, message });
  };

  if (!isPlainObject(doc)) {
    err("", "section document must be a JSON object");
    return errors;
  }

  for (const reqField of SECTION_REQUIRED) {
    if (!(reqField in doc) || doc[reqField] === undefined) {
      err(ptr(reqField), `missing required field '${reqField}' in section`);
    }
  }

  for (const key of Object.keys(doc)) {
    if (!SECTION_ALLOWED.has(key)) {
      err(ptr(key), `unexpected extra field '${key}' is not allowed in section`);
    }
  }

  if ("aiax_version" in doc && doc.aiax_version !== undefined) {
    if (typeof doc.aiax_version !== "string" || doc.aiax_version !== "0.1") {
      err(ptr("aiax_version"), "field 'aiax_version' in section must be '0.1'");
    }
  }

  if ("section_id" in doc && doc.section_id !== undefined) {
    if (typeof doc.section_id !== "string" || !ID_PATTERN.test(doc.section_id)) {
      err(
        ptr("section_id"),
        "field 'section_id' must match pattern ^[a-z0-9][a-z0-9_-]{0,60}$"
      );
    } else if (expectedId && doc.section_id !== expectedId) {
      err(
        ptr("section_id"),
        `field 'section_id' ('${doc.section_id}') differs from entry point id '${expectedId}'`
      );
    }
  }

  if ("purpose" in doc && doc.purpose !== undefined) {
    if (typeof doc.purpose !== "string" || doc.purpose.trim().length === 0) {
      err(ptr("purpose"), "field 'purpose' must be a non-empty string");
    } else if (doc.purpose.length > 600) {
      err(ptr("purpose"), "field 'purpose' must be at most 600 characters");
    }
  }

  if ("inputs" in doc && doc.inputs !== undefined) {
    const inp = doc.inputs;
    if (typeof inp === "string") {
      if (inp.length > 400) {
        err(ptr("inputs"), "field 'inputs' string must be at most 400 characters");
      }
    } else if (!isPlainObject(inp)) {
      err(ptr("inputs"), "field 'inputs' must be a JSON Schema object or a string");
    }
  }

  if ("outputs" in doc && doc.outputs !== undefined) {
    const out = doc.outputs;
    if (typeof out === "string") {
      if (out.length > 400) {
        err(ptr("outputs"), "field 'outputs' string must be at most 400 characters");
      }
    } else if (!isPlainObject(out)) {
      err(ptr("outputs"), "field 'outputs' must be a JSON Schema object or a string");
    }
  }

  if ("pricing" in doc && doc.pricing !== undefined && doc.pricing !== null) {
    if (!isPlainObject(doc.pricing)) {
      err(ptr("pricing"), "field 'pricing' must be a JSON object or null");
    } else {
      const pr = doc.pricing;
      for (const pf of PRICING_REQUIRED) {
        if (!(pf in pr) || pr[pf] === undefined) {
          err(ptr("pricing", pf), `missing required field 'pricing.${pf}'`);
        }
      }
      for (const pk of Object.keys(pr)) {
        if (!PRICING_ALLOWED.has(pk)) {
          err(ptr("pricing", pk), `unexpected extra field 'pricing.${pk}' is not allowed`);
        }
      }
      if ("model" in pr && pr.model !== undefined) {
        if (typeof pr.model !== "string" || !PRICING_MODELS.has(pr.model)) {
          err(
            ptr("pricing", "model"),
            "field 'pricing.model' must be one of per_call, per_minute, per_token, flat, free, subscription"
          );
        }
      }
      if ("amount" in pr && pr.amount !== undefined) {
        if (typeof pr.amount !== "string" || !AMOUNT_PATTERN.test(pr.amount)) {
          err(
            ptr("pricing", "amount"),
            "field 'pricing.amount' must be a decimal string matching ^[0-9]+(\\.[0-9]+)?$"
          );
        }
      }
      if ("currency" in pr && pr.currency !== undefined) {
        if (
          typeof pr.currency !== "string" ||
          pr.currency.trim().length === 0 ||
          pr.currency.length > 10
        ) {
          err(
            ptr("pricing", "currency"),
            "field 'pricing.currency' must be a non-empty string of at most 10 characters"
          );
        }
      }
      if ("rail" in pr && pr.rail !== undefined) {
        if (
          typeof pr.rail !== "string" ||
          pr.rail.trim().length === 0 ||
          pr.rail.length > 30
        ) {
          err(
            ptr("pricing", "rail"),
            "field 'pricing.rail' must be a non-empty string of at most 30 characters"
          );
        }
      }
    }
  }

  if ("examples" in doc && doc.examples !== undefined) {
    if (!Array.isArray(doc.examples) || doc.examples.length < 1 || doc.examples.length > 3) {
      err(ptr("examples"), "field 'examples' must be an array with 1 to 3 items");
    } else {
      doc.examples.forEach((ex: unknown, j: number) => {
        if (!isPlainObject(ex)) {
          err(ptr("examples", j), `field 'examples[${j}]' must be a JSON object`);
          return;
        }
        for (const ef of EXAMPLE_REQUIRED) {
          if (!(ef in ex) || ex[ef] === undefined) {
            err(ptr("examples", j, ef), `missing required field 'examples[${j}].${ef}'`);
          }
        }
        for (const ek of Object.keys(ex)) {
          if (!EXAMPLE_ALLOWED.has(ek)) {
            err(
              ptr("examples", j, ek),
              `unexpected extra field 'examples[${j}].${ek}' is not allowed`
            );
          }
        }
        if ("description" in ex && ex.description !== undefined) {
          if (typeof ex.description !== "string" || ex.description.trim().length === 0) {
            err(
              ptr("examples", j, "description"),
              `field 'examples[${j}].description' must be a non-empty string`
            );
          } else if (ex.description.length > 200) {
            err(
              ptr("examples", j, "description"),
              `field 'examples[${j}].description' must be at most 200 characters`
            );
          }
        }
      });
    }
  }

  if (
    "pact_mandate_template" in doc &&
    doc.pact_mandate_template !== undefined &&
    doc.pact_mandate_template !== null
  ) {
    if (!isValidUri(doc.pact_mandate_template)) {
      err(
        ptr("pact_mandate_template"),
        "field 'pact_mandate_template' must be a valid URI string or null"
      );
    }
  }

  if ("mcp_tool_name" in doc && doc.mcp_tool_name !== undefined) {
    if (
      typeof doc.mcp_tool_name !== "string" ||
      doc.mcp_tool_name.trim().length === 0 ||
      doc.mcp_tool_name.length > 80
    ) {
      err(
        ptr("mcp_tool_name"),
        "field 'mcp_tool_name' must be a string of at most 80 characters"
      );
    }
  }

  if ("openapi_operation_id" in doc && doc.openapi_operation_id !== undefined) {
    if (
      typeof doc.openapi_operation_id !== "string" ||
      doc.openapi_operation_id.trim().length === 0 ||
      doc.openapi_operation_id.length > 120
    ) {
      err(
        ptr("openapi_operation_id"),
        "field 'openapi_operation_id' must be a string of at most 120 characters"
      );
    }
  }

  if ("latency_p50_ms" in doc && doc.latency_p50_ms !== undefined) {
    if (
      typeof doc.latency_p50_ms !== "number" ||
      !Number.isInteger(doc.latency_p50_ms) ||
      doc.latency_p50_ms < 0
    ) {
      err(
        ptr("latency_p50_ms"),
        "field 'latency_p50_ms' must be a non-negative integer"
      );
    }
  }

  if ("latency_p99_ms" in doc && doc.latency_p99_ms !== undefined) {
    if (
      typeof doc.latency_p99_ms !== "number" ||
      !Number.isInteger(doc.latency_p99_ms) ||
      doc.latency_p99_ms < 0
    ) {
      err(
        ptr("latency_p99_ms"),
        "field 'latency_p99_ms' must be a non-negative integer"
      );
    }
  }

  if ("extensions" in doc && doc.extensions !== undefined) {
    if (!isPlainObject(doc.extensions)) {
      err(ptr("extensions"), "field 'extensions' must be a JSON object");
    }
  }

  return errors;
}

function computeScore(errorsCount: number, warningsCount: number, manifestMissing: boolean): number {
  if (manifestMissing) return 0;
  if (errorsCount === 0 && warningsCount === 0) return 100;
  const penalty = errorsCount * 15 + warningsCount * 5;
  const raw = 100 - penalty;
  if (errorsCount > 0) {
    return Math.max(0, Math.min(85, raw));
  }
  return Math.max(0, raw);
}

export async function validateSite(
  url: string,
  options: ValidateSiteOptions = {}
): Promise<Report> {
  const siteUrl = normalizeSiteUrl(url);
  const fetchFn =
    options.fetch ??
    (options.fixtures ? createFixtureFetch(options.fixtures) : globalThis.fetch);

  if (typeof fetchFn !== "function") {
    throw new Error("fetch implementation is required");
  }

  const baseOrigin = new URL(siteUrl).origin;
  const wellKnownUrl = new URL("/.well-known/aiax.json", baseOrigin).href;
  const fallbackManifestUrl = new URL("/aiax/manifest.json", baseOrigin).href;

  let manifestUrl = wellKnownUrl;
  let manifestText: string | null = null;
  let manifestStatus = 0;

  try {
    const res1 = await fetchFn(wellKnownUrl, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    manifestStatus = res1.status;
    if (res1.ok) {
      manifestUrl = wellKnownUrl;
      manifestText = await res1.text();
    } else {
      const res2 = await fetchFn(fallbackManifestUrl, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      if (res2.ok) {
        manifestUrl = fallbackManifestUrl;
        manifestStatus = res2.status;
        manifestText = await res2.text();
      }
    }
  } catch {
    try {
      const res2 = await fetchFn(fallbackManifestUrl, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      if (res2.ok) {
        manifestUrl = fallbackManifestUrl;
        manifestStatus = res2.status;
        manifestText = await res2.text();
      }
    } catch {
      // handled below
    }
  }

  if (manifestText === null) {
    const missingIssue: ValidationIssue = {
      url: wellKnownUrl,
      path: "",
      message: `manifest could not be fetched from /.well-known/aiax.json or /aiax/manifest.json (HTTP ${manifestStatus || 404})`,
    };
    return {
      url: siteUrl,
      manifest_url: wellKnownUrl,
      ok: false,
      score: 0,
      errors: [missingIssue],
      warnings: [],
      sections: [],
    };
  }

  let manifestDoc: unknown;
  try {
    manifestDoc = JSON.parse(manifestText);
  } catch {
    const parseIssue: ValidationIssue = {
      url: manifestUrl,
      path: "",
      message: "manifest is not valid JSON",
    };
    return {
      url: siteUrl,
      manifest_url: manifestUrl,
      ok: false,
      score: 0,
      errors: [parseIssue],
      warnings: [],
      sections: [],
    };
  }

  const { errors: manifestErrors, warnings } = validateManifestDocument(
    manifestDoc,
    manifestUrl
  );
  const allErrors: ValidationIssue[] = [...manifestErrors];
  const sections: SectionReport[] = [];

  if (isPlainObject(manifestDoc) && Array.isArray(manifestDoc.entry_points)) {
    for (let i = 0; i < manifestDoc.entry_points.length; i++) {
      const ep = manifestDoc.entry_points[i];
      if (!isPlainObject(ep)) continue;
      const entryId = typeof ep.id === "string" ? ep.id : String(ep.id ?? `entry_${i}`);
      const rawEpUrl = typeof ep.url === "string" ? ep.url : "";
      if (!rawEpUrl || !isValidUriReference(rawEpUrl)) {
        continue;
      }

      const sectionUrl = new URL(rawEpUrl, manifestUrl).href;
      const sectionErrors: ValidationIssue[] = [];

      let sectionText: string | null = null;
      let sectionStatus = 0;
      try {
        const secRes = await fetchFn(sectionUrl, {
          method: "GET",
          headers: { accept: "application/json" },
        });
        sectionStatus = secRes.status;
        if (secRes.ok) {
          sectionText = await secRes.text();
        }
      } catch {
        sectionStatus = 0;
      }

      if (sectionText === null) {
        sectionErrors.push({
          url: sectionUrl,
          path: "",
          message: `section '${entryId}' could not be fetched from ${sectionUrl} (HTTP ${sectionStatus || 404})`,
        });
      } else {
        let sectionDoc: unknown;
        let parsedOk = false;
        try {
          sectionDoc = JSON.parse(sectionText);
          parsedOk = true;
        } catch {
          sectionErrors.push({
            url: sectionUrl,
            path: "",
            message: `section '${entryId}' at ${sectionUrl} is not valid JSON`,
          });
        }
        if (parsedOk) {
          const docErrors = validateSectionDocument(sectionDoc, sectionUrl, entryId);
          sectionErrors.push(...docErrors);
        }
      }

      sections.push({
        id: entryId,
        url: sectionUrl,
        ok: sectionErrors.length === 0,
        errors: sectionErrors,
      });
      allErrors.push(...sectionErrors);
    }
  }

  const ok = allErrors.length === 0;
  const score = computeScore(allErrors.length, warnings.length, false);

  return {
    url: siteUrl,
    manifest_url: manifestUrl,
    ok,
    score,
    errors: allErrors,
    warnings,
    sections,
  };
}
