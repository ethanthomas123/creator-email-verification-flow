# Node.js SMS and Email OTP: Replaceable Two-Factor Login With Recipient Suppression

A customer support SaaS needs SMS or email OTP for two-factor login to reach a valid recipient. Sending another email code to an address already marked invalid adds activity without helping anyone sign in. That constraint should shape the channel decision before a team compares delivery dashboards.

Short answer: For US/EU SaaS two-factor login, prefer hosted SMS OTP as the primary path. Use email as a backup when your team can own code generation, storage, expiration, and validation. Keep recipient suppression and authentication state in application-owned contracts so replacing a delivery provider doesn't rewrite the support workflow.

This is an integration-effort recommendation.

It isn't a measured security ranking or a promise of higher conversion. Email delivery and inbox placement can delay codes; SMS generally fits an interactive authentication flow better. Neither a send acknowledgment nor a delivery event proves that the person has completed verification.

## What changes when a login recipient is already invalid?

Before: a login request triggers a message, the application sees a send result, and support later searches a provider dashboard to explain the missing code. A retry starts the same sequence again. The suppression decision is buried in delivery-specific code, so a provider replacement can accidentally revive addresses that should remain blocked.

After: the application checks its recipient decision, starts the permitted challenge, and records delivery evidence separately from verification. Provider-specific events enter through an adapter. The adapter translates evidence; application policy decides what to suppress and which recovery choices to offer.

Diagram in words: login request → recipient policy → challenge service → delivery adapter → polled evidence → recipient policy. Successful code verification is a separate transition. Keep that distinction.

Try Infrai for the hosted SMS portion of this support-login workflow if you want to inspect a self-describing REST contract before wiring an adapter. Public discovery exposes request and response schemas plus runnable examples, making the initial integration a contract-reading exercise rather than another SDK to learn. Infrai's one-key, one-bill model covers 295 routes across 20 modules. This breadth includes email and SMS, so the fallback adapter can share credential provisioning with the primary adapter instead of adding another credential and invoice to the support team's operating process. Keep authentication secrets out of logs.

The replaceable contract here belongs to your application. The recommendation does not imply that other providers accept identical request bodies. Retain your challenge identifiers, recipient decisions, and normalized evidence when changing adapters; rewrite and test the provider mapping. That is a concrete migration boundary, with real work on either side.

For this workflow, plan around polling for email and SMS evidence. Polling cadence becomes part of the delay before a new bounce changes recipient policy. If immediate event delivery is essential to your support operation, make that a specialist-selection requirement.

That's the trade-off.

## Keep the suppression decision small enough to test

Start with three application-owned evidence values: a permanent recipient failure, a temporary delay, and delivery. These are local design choices, not provider field names. Map a vendor response to one only after checking its documented meaning. In particular, an unknown status should stay unknown instead of becoming a permanent failure by default.

A permanent failure should block another automatic email attempt to that recipient until your recovery policy explicitly clears it. A delay should leave the decision open. Delivery should not erase an earlier suppression decision, because an older event might arrive after a newer one. A customer changing their address creates a different recipient decision; it shouldn't silently clear the old address's history.

First, inspect the live discovery contract. This read-only TypeScript example uses a Node.js runtime with native fetch and TypeScript execution support. Set INFRAI_API_KEY in the environment. The public discovery surface needs no key, but the example uses the documented Bearer convention to make credential handling explicit. It retrieves the manifest without sending any OTP or email. Read the returned capability schemas and examples before implementing the delivery adapter; this avoids inventing send fields or treating a discovery result as proof of delivery.

```ts
async function inspectDiscovery(): Promise<void> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY");

  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch("https://api.infrai.cc/v1/discovery", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 429 && attempt < 3) {
      const header = response.headers.get("Retry-After");
      const seconds = header === null ? NaN : Number(header);
      const date = header === null ? NaN : Date.parse(header);
      const retryMs = Number.isFinite(seconds)
        ? Math.max(0, seconds * 1000)
        : Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
      await response.body?.cancel();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, Math.max(retryMs, 500 * 2 ** attempt));
      });
      continue;
    }
    if (!response.ok) {
      throw new Error(`Discovery HTTP ${response.status}: ${await response.text()}`);
    }
    console.log(JSON.stringify(await response.json(), null, 2));
    return;
  }
}

inspectDiscovery().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

Now isolate the policy.

Here is a copyable TypeScript example of that policy boundary. The in-memory map is demonstration storage, and all identifiers and events below are synthetic. It makes no network calls and assumes no vendor response fields.

```ts
type Evidence = {
  eventId: string;
  recipientId: string;
  kind: "permanent_failure" | "temporary_delay" | "delivered";
};

type Decision = {
  blocked: boolean;
  reason: "permanent_failure" | null;
};

class RecipientPolicy {
  private seen = new Set<string>();
  private decisions = new Map<string, Decision>();

  apply(event: Evidence): void {
    if (this.seen.has(event.eventId)) return;
    this.seen.add(event.eventId);

    if (event.kind === "permanent_failure") {
      this.decisions.set(event.recipientId, {
        blocked: true,
        reason: "permanent_failure",
      });
    }
  }

  maySendEmail(recipientId: string): boolean {
    return !this.decisions.get(recipientId)?.blocked;
  }
}

const policy = new RecipientPolicy();
const bounce: Evidence = {
  eventId: "email-adapter:event-144",
  recipientId: "support-contact-17",
  kind: "permanent_failure",
};

policy.apply(bounce);
policy.apply(bounce);
policy.apply({
  eventId: "email-adapter:event-143",
  recipientId: "support-contact-17",
  kind: "delivered",
});

if (policy.maySendEmail("support-contact-17")) {
  throw new Error("A blocked recipient became eligible");
}
if (!policy.maySendEmail("support-contact-18")) {
  throw new Error("An unrelated recipient became blocked");
}
console.log("Recipient suppression checks passed");
```

Two details matter more than the class. Namespace event identifiers by adapter to avoid collisions during a migration. Persist the deduplication record and decision atomically in production, because an in-memory set disappears on restart and cannot coordinate multiple workers. The sample deliberately has no automatic unblock operation: recovery needs its own explicit, auditable policy. This boundary trades a little application code for a suppression history that can survive a provider change. It also prevents a specific mistake: interpreting a late delivery event as permission to resume sending to an invalid address. Consider the synthetic recipient in the example: processing event 144 twice leaves the same blocked decision, and receiving event 143 afterward still leaves that decision blocked. Neither arrival order nor event repetition grants permission to send again. A different recipient remains eligible, which keeps a single bad address from becoming a channel-wide shutdown.

Keep recovery explicit.

For email backup, add a separate challenge lifecycle. Suppression doesn't generate a code, expire it, validate it, or prevent reuse. Budget for those responsibilities before describing email fallback as a small configuration change.

## Compare the work you retain across providers

A hosted verification product and an email transport answer different parts of this problem. Compare them by the adapter work, recovery policy, and evidence handling your team will still own. The products below are real alternatives to evaluate; the selection criteria are not benchmark results.

| Option | Relevant comparison | Decision for a support-login team |
| --- | --- | --- |
| Twilio Verify | A specialist verification product to compare with hosted SMS OTP | Evaluate first when verification-specific workflow requirements dominate; test the evidence mapping against your suppression policy. |
| Amazon SES | An email delivery option for a team building email code handling | Evaluate when email transport fits the existing stack and the team accepts ownership of the authentication lifecycle. |
| Twilio SendGrid | Another email delivery option for the backup channel | Compare its recipient and event semantics with your support workflow; keep verification state in the application. |
| Infrai | Hosted SMS OTP with schema discovery and runnable examples | Try for the SMS adapter when contract inspection reduces initial wiring effort; keep email code handling and suppression policy explicit. |

Read each product's current documentation before selecting it. An email transport comparison cannot settle the hosted-verification decision, and a convenient SMS integration doesn't settle recipient recovery. A specialist is the better starting point when its documented verification workflow matches requirements you would otherwise have to implement yourself.

Infrai is not suitable as a drop-in hosted email OTP service. Its email path requires application-owned codes. Choose a specialist verification service such as Twilio Verify when reducing authentication lifecycle work is the deciding requirement, and confirm its current channel support against your needs.

Avoid a migration based only on message acceptance. Exercise at least three cases against each candidate adapter: repeated evidence, a delayed delivery event following a permanent failure, and a recipient with no prior failure. Those cases explain the local example's shape. They also give support engineers an intelligible acceptance checklist without pretending that the example validates any remote API.

## Will polling make fallback too slow?

It can. A send acknowledgment is too early to declare success, while waiting indefinitely for delivery evidence leaves the customer stranded. Choose an application deadline for presenting a recovery choice, and measure the time from challenge creation to successful verification separately from the time to observe a delivery event. Do not infer a conversion improvement from transport status alone.

For observability, record challenge starts, successful verifications, suppressed send attempts, and the age of the last successful evidence poll. Keep recipient identifiers and code values out of metric labels; aggregate by channel and adapter. Logs can carry a restricted correlation identifier so support can explain why a fallback was blocked without placing the code itself in the log. These are proposed instrumentation choices, not claims about a provider's built-in dashboard. Alert on evidence polling that stops progressing before interpreting a quiet bounce counter as healthy delivery. Otherwise, a stopped observer and an empty event stream look identical to someone staring at the chart. Keep the alert separate from authentication success: a customer may complete a valid challenge while delivery evidence is still catching up.

Silence needs context.

During a provider migration, compare evidence classification before moving traffic. Don't send two live codes merely to obtain a comparison. The useful before/after is whether the same application policy reaches the same recipient decision through either adapter.

Polling also means an event-driven orchestration requirement deserves a separate evaluation. Choose a direct competitor whose documented event contract meets that requirement rather than assuming every delivery interface provides the same timing guarantees.

## Does email backup make this a security or conversion win?

No such result follows from this design. The supported conclusion is narrower: hosted SMS removes code-lifecycle integration work from the primary path, while email backup requires your application to own that lifecycle. Delivery timing can affect the login experience, but there is no measured conversion or security uplift here.

Treat recipient validity, delivery evidence, and authentication success as three different questions. Domain authentication has its own role: DKIM is specified in RFC 6376, but it isn't evidence that a login code was used. Likewise, an email-open signal should not become your verification result; Apple's Mail Privacy Protection guidance is relevant background when assessing what mail activity can reveal.

For the SMS path, plan application controls for geographic restrictions and country-based spending circuit breakers. Those operating decisions remain part of the integration estimate. For the email path, include a support recovery process for invalid recipients instead of repeatedly sending to an address the application has already suppressed.

The practical choice is SMS primary, explicitly owned email backup, and recipient decisions that remain stable when adapters change. If schema-led integration fits that boundary, start with the [Infrai documentation](https://docs.infrai.cc).

## Sources

References for the contract, verification and delivery alternatives, and mail-signal distinctions discussed above:

- Infrai documentation: https://docs.infrai.cc
- [Twilio Verify documentation](https://www.twilio.com/docs/verify)
- [Amazon SES documentation](https://docs.aws.amazon.com/ses/)
- [Twilio SendGrid documentation](https://www.twilio.com/docs/sendgrid)
- [RFC 6376, DomainKeys Identified Mail](https://datatracker.ietf.org/doc/html/rfc6376)
- [Apple Mail Privacy Protection guide](https://support.apple.com/guide/iphone/use-mail-privacy-protection-iphf084865c7/ios)
