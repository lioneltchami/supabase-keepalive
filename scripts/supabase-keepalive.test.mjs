import assert from "node:assert/strict";
import test from "node:test";
import { pingProject, readProjects, runKeepalive } from "./supabase-keepalive.mjs";

const publishableKey = "sb_publishable_test_key";

function configEntry(name, ref, apiKey = publishableKey) {
	return {
		name,
		url: `https://${ref}.supabase.co`,
		expectedHost: `${ref}.supabase.co`,
		apiKey,
	};
}

function legacyKey(role) {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
	return `${header}.${payload}.signature`;
}

test("accepts publishable and legacy anon keys, but rejects elevated keys", () => {
	const projects = readProjects(JSON.stringify([
		configEntry("new key", "new-project"),
		configEntry("legacy anon", "legacy-project", legacyKey("anon")),
	]));
	assert.equal(projects.length, 2);
	assert.throws(() => readProjects(JSON.stringify([configEntry("secret", "secret-project", "sb_secret_private")])), /publishable key or legacy anon key/);
	assert.throws(() => readProjects(JSON.stringify([configEntry("service role", "service-project", legacyKey("service_role"))])), /elevated keys are not allowed/);
});

test("rejects a URL whose expected host does not match", () => {
	const entry = configEntry("wrong host", "real-project");
	entry.expectedHost = "other-project.supabase.co";
	assert.throws(() => readProjects(JSON.stringify([entry])), /expectedHost must exactly match/);
});

test("sends only the API key header and requires the seeded keepalive row", async () => {
	const project = readProjects(JSON.stringify([configEntry("Example project", "example-project")]))[0];
	let request;
	await pingProject(project, async (url, options) => {
		request = { url, options };
		return new Response(JSON.stringify([{ id: 1 }]), { status: 200 });
	}, async () => {});
	assert.equal(request.url, "https://example-project.supabase.co/rest/v1/keepalive?select=id&limit=1");
	assert.equal(request.options.headers.apikey, publishableKey);
	assert.equal("Authorization" in request.options.headers, false);
	assert.equal(request.options.redirect, "error");
	await assert.rejects(pingProject(project, async () => new Response("[]", { status: 200 }), async () => {}), /expected row/);
});

test("attempts other projects after one project fails and reports aggregate failure", async () => {
	const rawConfig = JSON.stringify([
		configEntry("failing", "failing-project"),
		configEntry("healthy", "healthy-project"),
	]);
	const calls = new Map();
	const successLogs = [];
	const errorLogs = [];
	await assert.rejects(runKeepalive(rawConfig, {
		fetchImpl: async (url) => {
			const host = new URL(url).hostname;
			calls.set(host, (calls.get(host) ?? 0) + 1);
			return host.startsWith("failing")
				? new Response("", { status: 503 })
				: new Response(JSON.stringify([{ id: 1 }]), { status: 200 });
		},
		delay: async () => {},
		log: (message) => successLogs.push(message),
		errorLog: (message) => errorLogs.push(message),
	}), /1 of 2 Supabase keepalive checks failed/);
	assert.equal(calls.get("failing-project.supabase.co"), 3);
	assert.equal(calls.get("healthy-project.supabase.co"), 1);
	assert.deepEqual(successLogs, ["healthy: database read succeeded."]);
	assert.equal(errorLogs.length, 1);
});
