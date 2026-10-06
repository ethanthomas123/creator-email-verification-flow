import { z } from "zod";
import { infrai } from "./infrai.js";

export const Signup = z.object({ email: z.string().email(), creatorName: z.string().min(1), assetTitle: z.string().min(1), assetBody: z.string().min(1) });
export type SignupInput = z.infer<typeof Signup>;
export type SignupResult = { messageId: string; verificationUrl: string; processedAsset: { title: string; body: string } };

function processAsset(input: SignupInput) { return { title: input.assetTitle.trim(), body: input.assetBody.trim().replace(/\s+/g, " ") }; }

export async function startCreatorSignup(raw: unknown): Promise<SignupResult> {
  const input = Signup.parse(raw);
  const processedAsset = processAsset(input);
  const verificationUrl = `https://store.example/verify?email=${encodeURIComponent(input.email)}`;
  const sent = await infrai.email.send({ to: input.email, subject: `Verify your ${input.creatorName} storefront`, html: `<h1>Welcome, ${input.creatorName}</h1><p>Confirm your email to publish “${processedAsset.title}”.</p><p><a href="${verificationUrl}">Verify email</a></p>` }, `creator-signup:${input.email}`);
  await infrai.email.get(sent.message_id);
  return { messageId: sent.message_id, verificationUrl, processedAsset };
}
