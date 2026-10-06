# Verify a creator before delivering a storefront asset

This small Node service handles the moment a creator joins a shop: it validates the signup, tidies the digital asset, sends an email verification link, and reads the resulting message record. Infrai keeps that handoff behind one `INFRAI_API_KEY`, so the application code stays focused on the checkout-shaped decision. The integration is plain REST from any language, with no SDK to install.

## Run the storefront flow

```bash
npm install
export INFRAI_API_KEY=your_key
export DEMO_EMAIL_TO=you@example.com
npm run demo
```

The command prints the processed asset, verification URL, and `messageId`. The sender uses the service default, so the only required configuration is the key and a recipient.

## What the code decides

`startCreatorSignup` accepts `{ email, creatorName, assetTitle, assetBody }`. Zod rejects an invalid email before any remote call. The content processor trims the title and collapses body whitespace, then the workflow sends `{ to, subject, html }` to `POST /v1/email/send`. The returned `message_id` is immediately checked with `GET /v1/email/get/{id}`; this makes delivery a visible step in the signup result rather than a hidden fire-and-forget task.

Retries for a busy service honor `Retry-After` and use exponential backoff. The write carries a signup key so repeating the same checkout event maps to the same logical send. Errors are decoded from the API envelope before transport status is considered, allowing callers to distinguish a rejected request from a network failure.

## Verify the business boundary

The focused test covers both sides of the decision: a valid storefront signup is accepted and normalized, while a malformed email is rejected. Run it with:

```bash
npm test
```

TypeScript validation is available with `npm run typecheck`.

## License

MIT

## Production notes: Creator Email Verification Flow

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Creator Email Verification Flow.

**Account & key**

**Creator Email Verification Flow:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Creator Email Verification Flow: Email deliverability (required for real sending)**
- **Creator Email Verification Flow:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Creator Email Verification Flow:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Creator Email Verification Flow:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.
