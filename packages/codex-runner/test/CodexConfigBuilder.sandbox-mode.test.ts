import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexConfigBuilder } from "../src/config/CodexConfigBuilder.js";
import type { CodexRunnerConfig } from "../src/types.js";

/**
 * The Feishu full-access chat front door sets `unrestrictedFilesystemAccess`
 * to grant the session real host (root) access. The Codex runner must translate
 * that intent into `danger-full-access` so the coarse workspace-write sandbox is
 * dropped — otherwise Codex sessions cannot deploy / operate on the real host.
 */
describe("CodexConfigBuilder sandbox mode", () => {
	let home: string;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "codex-home-"));
	});

	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
	});

	function baseConfig(
		overrides: Partial<CodexRunnerConfig>,
	): CodexRunnerConfig {
		return {
			model: "gpt-5.5",
			workingDirectory: "/ws/root",
			codexHome: home,
			logger: {
				debug: () => {},
				info: () => {},
				warn: () => {},
				error: () => {},
			} as unknown as CodexRunnerConfig["logger"],
			onMessage: () => {},
			onError: () => {},
			...overrides,
		} as CodexRunnerConfig;
	}

	it("uses danger-full-access when unrestrictedFilesystemAccess is set", async () => {
		const resolved = await new CodexConfigBuilder(
			baseConfig({ unrestrictedFilesystemAccess: true }),
		).build();
		expect(resolved.sandbox).toEqual({
			kind: "workspace-mode",
			mode: "danger-full-access",
			writableRoots: ["/ws/root"],
			networkAccess: true,
		});
	});

	it("defaults to workspace-write without the flag", async () => {
		const resolved = await new CodexConfigBuilder(baseConfig({})).build();
		expect(resolved.sandbox.kind).toBe("workspace-mode");
		if (resolved.sandbox.kind === "workspace-mode") {
			expect(resolved.sandbox.mode).toBe("workspace-write");
		}
	});

	it("uses danger-full-access when CYRUS_CODEX_FULL_ACCESS=true (instance opt-in)", async () => {
		const prev = process.env.CYRUS_CODEX_FULL_ACCESS;
		process.env.CYRUS_CODEX_FULL_ACCESS = "true";
		try {
			// No per-session flag — mirrors a Linear issue session, which never
			// carries unrestrictedFilesystemAccess. The env opt-in still lifts it
			// out of the workspace-write sandbox.
			const resolved = await new CodexConfigBuilder(baseConfig({})).build();
			expect(resolved.sandbox.kind).toBe("workspace-mode");
			if (resolved.sandbox.kind === "workspace-mode") {
				expect(resolved.sandbox.mode).toBe("danger-full-access");
			}
		} finally {
			if (prev === undefined) delete process.env.CYRUS_CODEX_FULL_ACCESS;
			else process.env.CYRUS_CODEX_FULL_ACCESS = prev;
		}
	});
});
