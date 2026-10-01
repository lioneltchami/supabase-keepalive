import { pathToFileURL } from "node:url";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function readProjects(rawConfig) {
	if (!rawConfig) {
		throw new Error("Set the SUPABASE_KEEPALIVE_PROJECTS_JSON Actions secret.");
	}

	let projects;
	try {
		projects = JSON.parse(rawConfig);
	} catch {
		throw new Error("SUPABASE_KEEPALIVE_PROJECTS_JSON must contain valid JSON.");
	}

	if (!Array.isArray(projects) || projects.length === 0) {
		throw new Error("SUPABASE_KEEPALIVE_PROJECTS_JSON must be a non-empty array.");
	}

	const names = new Set();
	return projects.map((project, index) => {
		const label = `Project entry ${index + 1}`;
		if (!project || typeof project !== "object" || Array.isArray(project)) {
			throw new Error(`${label} must be an object.`);
		}

		const name = typeof project.name === "string" ? project.name.trim() : "";
		const expectedHost = typeof project.expectedHost === "string" ? project.expectedHost.trim().toLowerCase() : "";
		const apiKey = typeof project.apiKey === "string" ? project.apiKey.trim() : "";
		if (!name || names.has(name)) {
			throw new Error(`${label} needs a unique, non-empty name.`);
		}
		names.add(name);

		let url;
		try {
			url = new URL(project.url);
		} catch {
			throw new Error(`${name}: url must be a valid project URL.`);
		}
		if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
			throw new Error(`${name}: url must be an HTTPS Supabase project URL without credentials, path, query, or fragment.`);
		}
		if (!expectedHost || url.hostname.toLowerCase() !== expectedHost) {
			throw new Error(`${name}: expectedHost must exactly match the hostname in url (${url.hostname}).`);
		}

		if (apiKey.startsWith("sb_publishable_")) {
			// Publishable keys map to the anon database role and are safe for this read-only check.
		} else if (apiKey.startsWith("eyJ")) {
			// Legacy anon keys are JWTs; reject service-role keys before making any request.
			let role;
			try {
				role = JSON.parse(Buffer.from(apiKey.split(".")[1], "base64url").toString("utf8")).role;
			} catch {
				throw new Error(`${name}: apiKey must be a Supabase publishable key or legacy anon key.`);
			}
			if (role !== "anon") {
				throw new Error(`${name}: apiKey must be publishable/anon; elevated keys are not allowed.`);
			}
		} else {
			throw new Error(`${name}: apiKey must be a Supabase publishable key or legacy anon key.`);
		}

		return { name, url: url.origin, apiKey };
	});
}

export async function pingProject(project, fetchImpl = fetch, delay = sleep) {
	const endpoint = `${project.url}/rest/v1/keepalive?select=id&limit=1`;
	let lastFailure = "unknown request failure";

	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			const response = await fetchImpl(endpoint, {
				headers: {
					apikey: project.apiKey,
					Accept: "application/json",
				},
				redirect: "error",
				signal: AbortSignal.timeout(15_000),
			});

			if (response.ok) {
				let rows;
				try {
					rows = await response.json();
				} catch {
					throw new Error("response was not valid JSON");
				}
				if (!Array.isArray(rows) || !rows.some((row) => row?.id === 1)) {
					throw new Error("keepalive table did not return its expected row");
				}
				return;
			}

			lastFailure = `HTTP ${response.status}`;
			if (response.status < 500 && response.status !== 429) break;
		} catch (error) {
			lastFailure = error instanceof Error ? error.message : "unknown request failure";
		}

		if (attempt < 3) await delay(attempt * 2_000);
	}

	throw new Error(lastFailure);
}

export async function runKeepalive(rawConfig, { fetchImpl = fetch, delay = sleep, log = console.log, errorLog = console.error } = {}) {
	const projects = readProjects(rawConfig);
	let failures = 0;
	const queue = [...projects];
	const workerCount = Math.min(5, queue.length);

	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (queue.length > 0) {
				const project = queue.shift();
				try {
					await pingProject(project, fetchImpl, delay);
					log(`${project.name}: database read succeeded.`);
				} catch (error) {
					failures += 1;
					const reason = error instanceof Error ? error.message : "unknown request failure";
					errorLog(`${project.name}: database read failed (${reason}).`);
				}
			}
		}),
	);

	if (failures > 0) {
		throw new Error(`${failures} of ${projects.length} Supabase keepalive checks failed.`);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	runKeepalive(process.env.SUPABASE_KEEPALIVE_PROJECTS_JSON).catch((error) => {
		console.error(error instanceof Error ? error.message : "Supabase keepalive failed.");
		process.exitCode = 1;
	});
}
