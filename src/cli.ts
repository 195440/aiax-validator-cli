#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createFixtureFetch, normalizeSiteUrl, validateSite } from "./validate.js";

const USAGE = "Usage: aiax-validate <url> [--json] [--fixtures <dir>]";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCli(
  argv: string[],
  customFetch?: typeof globalThis.fetch
): Promise<CliResult> {
  let targetUrl: string | null = null;
  let jsonOutput = false;
  let fixturesDir: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--fixtures") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        return {
          exitCode: 2,
          stdout: "",
          stderr: `Error: --fixtures requires a directory path.\n${USAGE}\n`,
        };
      }
      fixturesDir = next;
      i++;
    } else if (arg.startsWith("-")) {
      return {
        exitCode: 2,
        stdout: "",
        stderr: `Error: unknown option '${arg}'.\n${USAGE}\n`,
      };
    } else {
      if (targetUrl !== null) {
        return {
          exitCode: 2,
          stdout: "",
          stderr: `Error: unexpected positional argument '${arg}'.\n${USAGE}\n`,
        };
      }
      targetUrl = arg;
    }
  }

  if (!targetUrl) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `Error: missing required <url> argument.\n${USAGE}\n`,
    };
  }

  try {
    normalizeSiteUrl(targetUrl);
  } catch (err) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `Error: ${(err as Error).message}.\n${USAGE}\n`,
    };
  }

  const fetchImpl =
    customFetch ?? (fixturesDir ? createFixtureFetch(fixturesDir) : globalThis.fetch);

  const report = await validateSite(targetUrl, { fetch: fetchImpl });
  const exitCode = report.ok ? 0 : 1;

  if (jsonOutput) {
    return {
      exitCode,
      stdout: JSON.stringify(report, null, 2) + "\n",
      stderr: "",
    };
  }

  if (report.ok) {
    return {
      exitCode: 0,
      stdout: `OK ${report.url} score=${report.score} sections=${report.sections.length}\n`,
      stderr: "",
    };
  }

  const lines = report.errors.map(
    (e) => `${e.url} ${e.path || "/"}: ${e.message}`
  );
  return {
    exitCode: 1,
    stdout: lines.join("\n") + "\n",
    stderr: "",
  };
}

function checkIsMain(): boolean {
  if (typeof process === "undefined" || !process.argv[1]) return false;
  const arg1 = process.argv[1];
  if (
    arg1.endsWith("cli.js") ||
    arg1.endsWith("cli.ts") ||
    arg1.endsWith("aiax-validate")
  ) {
    return true;
  }
  try {
    return fs.realpathSync(arg1) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (checkIsMain()) {
  runCli(process.argv.slice(2))
    .then((res) => {
      if (res.stdout) process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);
      process.exit(res.exitCode);
    })
    .catch((err) => {
      process.stderr.write(`Error: ${(err as Error)?.message || String(err)}\n`);
      process.exit(2);
    });
}
