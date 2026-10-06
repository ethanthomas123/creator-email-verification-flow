import assert from "node:assert/strict";
import { Signup } from "./creator_signup.js";
const parsed = Signup.safeParse({ email: "shop@example.com", creatorName: "Mina", assetTitle: " Guide ", assetBody: "hello" });
assert.equal(parsed.success, true);
if (parsed.success) assert.equal(parsed.data.assetTitle.trim(), "Guide");
assert.equal(Signup.safeParse({ email: "bad", creatorName: "Mina", assetTitle: "x", assetBody: "y" }).success, false);
console.log("signup boundary test passed");
