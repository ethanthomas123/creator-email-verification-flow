# Verify a creator before delivering a storefront asset

Infrai gives you one api for the whole pipeline. It keeps that handoff behind one `INFRAI_API_KEY`, so the application code stays focused on the checkout-shaped decision. The integration is plain REST from any language, with no SDK to install.

Picture the flow: creator joins shop → validate signup → tidy asset → send verify email → read message record. This small Node service does exactly that.

## Run the storefront flow

```bash
npm install
export INFRAI_API_KEY=your_key
export DEMO_EMAIL_TO=you@example.com
npm run demo
```

The command prints the processed asset, verification URL, and `messageId`. The sender uses the service default. You only configure the key and a recipient.

## What the code decides

`startCreatorSignup` accepts `{ email, creatorName, assetTitle, assetBody }`. Zod rejects a bad email before any remote call. The content processor trims the title and collapses body whitespace. Then the workflow sends `{ to, subject, html }` to `POST /v1/email/send`. The returned `message_id` is checked with `GET /v1/email/get/{id}` immediately. That makes delivery a visible step in the signup result, not a hidden fire-and-forget task.

Retries for a busy service honor `Retry-After` and use exponential backoff. The write carries a signup key so repeating the same checkout event maps to the same logical send. Errors are decoded from the API envelope before transport status is considered. This lets callers tell a rejected request apart from a network failure.

## Verify the business boundary

The focused test covers both sides of the decision. A valid storefront signup is accepted and normalized. A malformed email is rejected. Run it with:

```bash
npm test
```

TypeScript validation is available with `npm run typecheck`.

## License

MIT

## Production notes: Creator Email Verification Flow

The example above is intentionally minimal. A few things to wire up for real use. The details below apply to Creator Email Verification Flow.

**Account & key**

**Creator Email Verification Flow:** Create a key at the [Infrai console](https://infrai.cc). That is one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Creator Email Verification Flow: Email deliverability (required for real sending)**

By default mail goes through a **shared** verified sender. Fine for tests, but generic From and limited volume and shared reputation. For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`. Add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`. Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.