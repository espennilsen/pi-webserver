/**
 * Shared HTTP server with prefix-based routing.
 *
 * Extensions mount handlers at a prefix (e.g. "/crm"). The server strips
 * the prefix before calling the handler, so handlers see paths relative
 * to their mount point.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ───────────────────────────────────────────────────────

export type RouteHandler = (
	req: http.IncomingMessage,
	res: http.ServerResponse,
	path: string,
) => void | Promise<void>;

export interface MountConfig {
	/** Unique identifier for this mount (e.g. "crm", "notes") */
	name: string;
	/** Display name for the dashboard (defaults to name) */
	label?: string;
	/** Short description shown on the dashboard */
	description?: string;
	/** URL prefix — requests matching this prefix are routed here */
	prefix: string;
	/** Request handler — receives (req, res, subPath) with prefix stripped */
	handler: RouteHandler;
}

export interface MountInfo {
	name: string;
	label: string;
	description?: string;
	prefix: string;
}

// ── State ───────────────────────────────────────────────────────

let server: http.Server | null = null;
let serverPort: number | null = null;
const mounts = new Map<string, MountConfig>();
let authCredentials: { username: string; password: string } | null = null;

// ── Mount Management ────────────────────────────────────────────

/**
 * Mount a handler at a prefix. If a mount with the same name exists,
 * it is replaced silently.
 */
export function mount(config: MountConfig): void {
	let prefix = config.prefix.replace(/\/+$/, "");
	if (!prefix.startsWith("/")) prefix = "/" + prefix;
	mounts.set(config.name, {
		...config,
		prefix,
		label: config.label ?? config.name,
	});
}

/** Remove a mount by name. Returns true if it existed. */
export function unmount(name: string): boolean {
	return mounts.delete(name);
}

/** List all current mounts (without handlers). */
export function getMounts(): MountInfo[] {
	return Array.from(mounts.values()).map((m) => ({
		name: m.name,
		label: m.label ?? m.name,
		description: m.description,
		prefix: m.prefix,
	}));
}

// ── Auth ────────────────────────────────────────────────────────

/**
 * Enable Basic auth. Pass null to disable.
 * Password only: username defaults to "pi".
 * Or pass { username, password }.
 */
export function setAuth(config: { username?: string; password: string } | null): void {
	authCredentials = config
		? { username: config.username ?? "pi", password: config.password }
		: null;
}

/** Returns auth status (never exposes the password). */
export function getAuth(): { username: string; enabled: true } | { enabled: false } {
	if (!authCredentials) return { enabled: false };
	return { username: authCredentials.username, enabled: true };
}

/** Check Basic auth. Returns true if OK (or auth is disabled). */
function checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
	if (!authCredentials) return true;

	const header = req.headers.authorization;
	if (header?.startsWith("Basic ")) {
		const decoded = Buffer.from(header.slice(6), "base64").toString();
		const colon = decoded.indexOf(":");
		if (colon !== -1) {
			const user = decoded.slice(0, colon);
			const pass = decoded.slice(colon + 1);
			if (user === authCredentials.username && pass === authCredentials.password) {
				return true;
			}
		}
	}

	res.writeHead(401, {
		"WWW-Authenticate": 'Basic realm="pi web server"',
		"Content-Type": "application/json",
	});
	res.end(JSON.stringify({ error: "Unauthorized" }));
	return false;
}

// ── Server Lifecycle ────────────────────────────────────────────

export function isRunning(): boolean {
	return server !== null;
}

export function getUrl(): string | null {
	return serverPort ? `http://localhost:${serverPort}` : null;
}

export function getPort(): number | null {
	return serverPort;
}

/**
 * Start the web server. Returns the URL.
 * If already running, stops and restarts.
 */
export function start(port: number = 4100): string {
	if (server) stop();

	const dashboardHtml = fs.readFileSync(
		path.resolve(import.meta.dirname, "../dashboard.html"),
		"utf-8",
	);

	server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", `http://localhost:${port}`);
		const pathname = url.pathname;

		// CORS for local development
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		// Auth gate (after CORS preflight so OPTIONS still works)
		if (!checkAuth(req, res)) return;

		try {
			// Dashboard
			if (pathname === "/" || pathname === "") {
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(dashboardHtml);
				return;
			}

			// Meta API: list mounts
			if (pathname === "/_api/mounts") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(getMounts()));
				return;
			}

			// Route to best matching mount (longest prefix wins)
			let bestMatch: MountConfig | null = null;

			for (const config of mounts.values()) {
				if (pathname === config.prefix || pathname.startsWith(config.prefix + "/")) {
					if (!bestMatch || config.prefix.length > bestMatch.prefix.length) {
						bestMatch = config;
					}
				}
			}

			if (bestMatch) {
				const subPath = pathname.slice(bestMatch.prefix.length) || "/";
				await bestMatch.handler(req, res, subPath);
				return;
			}

			// Nothing matched
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not found" }));
		} catch (err: any) {
			if (!res.headersSent) {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: err.message }));
			}
		}
	});

	server.listen(port);
	serverPort = port;
	return `http://localhost:${port}`;
}

/** Stop the server. Returns true if it was running. */
export function stop(): boolean {
	if (!server) return false;
	server.closeAllConnections();
	server.close();
	server = null;
	serverPort = null;
	return true;
}
