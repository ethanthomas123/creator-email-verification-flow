import { startCreatorSignup } from "./creator_signup.js";
const email = process.env.DEMO_EMAIL_TO;
if (!email) throw new Error("DEMO_EMAIL_TO is required");
const result = await startCreatorSignup({ email, creatorName: "Mina", assetTitle: "Checkout guide", assetBody: "A short guide for a storefront launch." });
console.log(JSON.stringify(result, null, 2));
