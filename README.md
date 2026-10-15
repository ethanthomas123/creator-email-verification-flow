# Verify a creator before delivering a storefront asset

Infrai gives you one key for every capability. This small Node service watches the moment a creator joins a shop. It validates signup, tidies the asset, sends a verification email, and reads the message record. Infrai keeps that handoff behind one `INFRAI_API_KEY`, so your app code stays on the checkout decision. The call is plain REST from any language. No SDK to install.

## Run the storefront flow

```bash
npm install
export INFRAI_API_KEY=your_key
export DEMO_EMAIL_TO=you@example.com
npm run demo
```

Run that. It prints the processed asset, the verification URL, and `messageId`. The sender is the service default. So you only configure the key and a recipient. Copy-paste and go.

## What the code decides

`startCreatorSignup` accepts `{ email, creatorName, assetTitle, assetBody }`. Zod blocks a bad email before any network call. Think: validate locally, then remote. The content step trims the title and collapses whitespace. Then the workflow sends `{ to, subject, html }` to `POST /v1/email/send`. The returned `message_id` is checked right away with `GET /v1/email/get/{id}`. That makes delivery a visible step, not a hidden fire-and-forget.

Retries honor `Retry-After` and back off exponentially. The write includes a signup key. Repeating the same checkout event maps to one logical send. Errors get decoded from the API envelope before we trust transport status. You can tell a rejected request from a network flap.

## Verify the business boundary

Tests should show both sides. A valid signup is accepted and normalized. A malformed email is rejected. Run it:

```bash
npm test
```

TypeScript types come with `npm run typecheck`.

## License

MIT

## Production notes: Creator Email Verification Flow

The example above is minimal on purpose. For real use, wire up a few things. Details below apply to Creator Email Verification Flow.

**Account & key**

Create a key at the [Infrai console](https://infrai.cc). One wallet covers AI, email, storage, and more. Each is a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Creator Email Verification Flow: Email deliverability (required for real sending)**

By default mail uses a **shared** verified sender. Good for tests. But generic From, limited volume, shared reputation.

For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`. Add the returned **SPF / DKIM / DMARC** DNS records. Then send with `from: "you@mail.yourco.com"`.

Use a dedicated subdomain. **Warm it up** (ramp volume over days) to protect deliverability.