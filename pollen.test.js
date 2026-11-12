import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthorizeUrl, readReturn } from "./pollen.js";

test("the sign-in link asks for a small budget and one day, and names no app until there is an App Key", () => {
    const url = new URL(
        buildAuthorizeUrl({ redirectUri: "https://owner.github.io/plot-a-law/", state: "s1", appKey: "" }),
    );
    assert.equal(url.origin + url.pathname, "https://enter.pollinations.ai/authorize");
    assert.equal(url.searchParams.get("redirect_uri"), "https://owner.github.io/plot-a-law/");
    assert.equal(url.searchParams.get("budget"), "0.3");
    assert.equal(url.searchParams.get("expiry"), "1");
    assert.equal(url.searchParams.has("client_id"), false);
    assert.equal(url.searchParams.has("permissions"), false);
});

test("with an App Key the sign-in sends it as client_id and asks for no extra permission", () => {
    const url = new URL(buildAuthorizeUrl({ redirectUri: "https://x/", state: "s", appKey: "pk_example1234" }));
    assert.equal(url.searchParams.get("client_id"), "pk_example1234");
    assert.equal(url.searchParams.has("permissions"), false);
    assert.equal(url.searchParams.has("scope"), false);
});

test("reads the key from the fragment only when the state matches", () => {
    const key = "sk_abcdefgh12345678";
    assert.deepEqual(readReturn(`#api_key=${key}&state=s1`, "s1"), { status: "ok", key });
    assert.equal(readReturn(`#api_key=${key}&state=other`, "s1").status, "bad-state");
    assert.equal(readReturn(`#api_key=${key}`, null).status, "bad-state");
    assert.equal(readReturn("#api_key=nope&state=s1", "s1").status, "bad-key");
    assert.equal(readReturn("#error=access_denied&state=s1", "s1").status, "denied");
    assert.equal(readReturn("", "s1").status, "none");
});
