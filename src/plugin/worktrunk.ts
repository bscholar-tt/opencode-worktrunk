import { type Plugin, tool } from "@opencode-ai/plugin"
import { z } from "zod"

const branchSchema = z
	.string()
	.min(1, "Branch name cannot be empty")
	.max(255, "Branch name too long")
	.refine((n) => !n.startsWith("-"), "Cannot start with '-'")
	.refine((n) => !n.startsWith("/") && !n.endsWith("/"), "Cannot start or end with '/'")
	.refine((n) => !n.includes("//"), "Cannot contain '//'")
	.refine((n) => !n.includes("@{"), "Cannot contain '@{'")
	.refine((n) => !n.includes(".."), "Cannot contain '..'")
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional security check
	.refine((n) => !/[\x00-\x1f\x7f ~^:?*[\]\\;&|`$()]/.test(n), "Contains invalid characters")
	.refine((n) => !n.startsWith(".") && !n.endsWith("."), "Cannot start or end with '.'")
	.refine((n) => !n.endsWith(".lock"), "Cannot end with '.lock'")

async function exec(
	cmd: string[],
	cwd: string,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
	try {
		const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		])
		return { ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() }
	} catch (e) {
		return { ok: false, stdout: "", stderr: e instanceof Error ? e.message : String(e) }
	}
}

async function wtGetPath(repoRoot: string, branch: string): Promise<string | null> {
	const result = await exec(["wt", "list", "--format", "json"], repoRoot)
	if (result.ok) {
		try {
			const entries = JSON.parse(result.stdout) as Array<{ branch?: string; path?: string }>
			const entry = entries.find((e) => e.branch === branch || e.branch === `refs/heads/${branch}`)
			if (entry?.path) return entry.path
		} catch {
			// fall through to git fallback
		}
	}
	// Fall back to git worktree list --porcelain
	const git = await exec(["git", "worktree", "list", "--porcelain"], repoRoot)
	if (!git.ok) return null
	for (const entry of git.stdout.split("\n\n")) {
		const lines = entry.trim().split("\n")
		const wtLine = lines.find((l) => l.startsWith("worktree "))
		const branchLine = lines.find((l) => l.startsWith("branch "))
		if (!wtLine || !branchLine) continue
		const ref = branchLine.slice("branch ".length)
		if (ref === `refs/heads/${branch}` || ref === branch) {
			return wtLine.slice("worktree ".length)
		}
	}
	return null
}

const WorktrunkPlugin: Plugin = async (ctx) => {
	const { directory, client } = ctx

	const logWarn = (msg: string) =>
		client.app.log({ body: { service: "worktrunk", level: "warn", message: msg } }).catch(() => {})

	ctx.experimental_workspace.register("worktrunk", {
		name: "Worktrunk Worktree",
		description: "Git worktree managed by worktrunk (wt)",
		configure(config) {
			return config
		},
		async create(config) {
			const branch = config.branch ?? config.name
			if (!branch) throw new Error("Branch name required")
			const result = await exec(["wt", "switch", "-c", branch, "--no-cd", "--yes"], directory)
			if (!result.ok) throw new Error(`wt switch failed: ${result.stderr || result.stdout}`)
		},
		async remove(config) {
			const branch = config.branch ?? config.name
			if (!branch) return
			await exec(["wt", "remove", branch, "--yes", "--force"], directory)
		},
		async target(config) {
			const branch = config.branch ?? config.name
			if (!branch) throw new Error("Branch name required")
			const wtPath = await wtGetPath(directory, branch)
			if (!wtPath) throw new Error(`Could not find worktree path for branch "${branch}"`)
			return { type: "local" as const, directory: wtPath }
		},
	})

	return {
		tool: {
			worktree_create: tool({
				description:
					"Create a new git worktree for isolated development using worktrunk. A new session will open in OpenCode pointing at the worktree.",
				args: {
					branch: tool.schema
						.string()
						.describe("Branch name for the worktree (e.g. feature/my-feature)"),
					baseBranch: tool.schema
						.string()
						.optional()
						.describe("Base branch to create from (defaults to HEAD)"),
				},
				async execute(args, toolCtx) {
					const branchResult = branchSchema.safeParse(args.branch)
					if (!branchResult.success) {
						return `❌ Invalid branch name: ${branchResult.error.issues[0]?.message}`
					}
					if (args.baseBranch) {
						const baseResult = branchSchema.safeParse(args.baseBranch)
						if (!baseResult.success) {
							return `❌ Invalid base branch name: ${baseResult.error.issues[0]?.message}`
						}
					}

					const switchArgs = ["wt", "switch", "-c", args.branch, "--no-cd", "--yes"]
					if (args.baseBranch) switchArgs.push("--base", args.baseBranch)

					const switchResult = await exec(switchArgs, directory)
					if (!switchResult.ok) {
						return `❌ Failed to create worktree: ${switchResult.stderr || switchResult.stdout}`
					}

					const wtPath = await wtGetPath(directory, args.branch)
					if (!wtPath) {
						return `❌ Worktree created but could not locate path for branch "${args.branch}"`
					}

					try {
						await client.session.fork({
							path: { id: toolCtx.sessionID },
							body: {},
							query: { directory: wtPath },
						})
					} catch (e) {
						logWarn(`Session fork failed: ${e}`)
					}

					await client.tui.openSessions({ query: { directory: wtPath } }).catch(() => {})

					return `Worktree created at ${wtPath}\n\nA new session has been opened in OpenCode for branch "${args.branch}".`
				},
			}),

			worktree_delete: tool({
				description: "Delete a worktree and its branch using worktrunk.",
				args: {
					branch: tool.schema.string().describe("Branch name of the worktree to delete"),
				},
				async execute(args) {
					const branchResult = branchSchema.safeParse(args.branch)
					if (!branchResult.success) {
						return `❌ Invalid branch name: ${branchResult.error.issues[0]?.message}`
					}

					const result = await exec(
						["wt", "remove", args.branch, "--yes", "--force"],
						directory,
					)
					if (!result.ok) {
						return `❌ Failed to remove worktree: ${result.stderr || result.stdout}`
					}

					return `Worktree for branch "${args.branch}" has been removed.`
				},
			}),
		},

	}
}

export default WorktrunkPlugin
