#!/usr/bin/env node
export interface CliResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
export declare function runCli(argv: string[], customFetch?: typeof globalThis.fetch): Promise<CliResult>;
//# sourceMappingURL=cli.d.ts.map