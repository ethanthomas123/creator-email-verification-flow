# Signup Authentication Observability: Polling SMS Receipts Before Backup Email Handoffs

| Path | Pick this when | Evidence to preserve |
| --- | --- | --- |
| Continue SMS polling | The delivery result is pending and the challenge remains usable | Last normalized receipt, observation time, next check |
| Offer backup email | Signup policy permits email verification and the SMS path has reached its fallback threshold | Policy decision, fallback reason, durable send intent |
| Use a separate recovery flow | The operation requires a stronger authentication method than email can provide | Required assurance, recovery eligibility, challenge outcome |

Delivery recovery trades another chance to reach the user against another credential path to defend. TL;DR: poll SMS delivery as transport evidence, authorize backup email separately, and record the handoff once in durable state. For a customer support service delivering a verification link during account signup, email can be an explicitly permitted verification path. For two-factor authentication at login, an email code must not silently replace the required second factor.

The reader-facing symptom is small: a code never arrives. The operational question is larger. Did the transport report a failure, did polling lose visibility, or did the user finish verification while a worker was preparing another message? Give support those distinctions without exposing the code or verification link.

## When should SMS polling keep going?

Pick continued polling when the adapter reports a pending receipt and the challenge still has time left. Keep the polling budget separate from credential expiry. A receipt describes delivery progress; it does not prove that the person completed authentication. NIST's authentication guidance makes the relevant distinction: authentication requires establishing control of an authenticator, and its out-of-band requirements restrict use of the public telephone network.

Observe before retrying.

For this design, normalize adapter results into four local values: pending, delivered, failed, and unknown. These are application categories, not a claim that every messaging API exposes the same states. Document each mapping at the adapter boundary. An unsuccessful status lookup becomes unknown; it must not manufacture a failed delivery. Otherwise an outage in observation can trigger a second communication channel for every waiting signup. That is a concrete failure mode to test, not evidence that SMS itself failed.

A delivered result can stop transport polling while the verification challenge remains open. Let a user request an allowed alternative through a separate, rate-limited action. Automatically treating every unredeemed but delivered SMS as a transport failure would make the receipt almost meaningless.

## Can backup email replace SMS in two-factor authentication?

Pick backup email for signup contact verification only when the application explicitly allows it. Keep the signup pending until the intended verification step completes. If verifying a phone number is mandatory, verifying an email address does not satisfy that requirement. Spell out what the verification link proves.

For a login that requires two factors, select the recovery path according to the required assurance. NIST SP 800-63B-4 says email must not be used for out-of-band authentication. Its treatment of email address confirmation is different. That boundary matters here: an email confirmation link during account creation and an email code substituted for a login authenticator are different operations, even if the delivery code looks similar.

The email branch also needs its own evidence. DKIM supplies a domain-level signature mechanism for email; RFC 6376 does not make that signature proof of inbox placement, link redemption, or the recipient's identity. Keep transport acceptance, delivery observations, and successful redemption as separate events. For links and codes, follow the OWASP recovery guidance on random generation, secure storage, expiration, and single use. Apply those controls to this design's verification credentials as well.

## What should the polling worker actually commit?

Here is the diagram in words: signup challenge → SMS send intent → receipt adapter → policy decision → atomic state update and email outbox entry → email worker → credential redemption. The observation path branches off each transition into logs and metrics. It never carries the credential.

The useful implementation boundary is the commit. A timer can schedule a lookup. Only durable state can decide whether a handoff is still allowed when another worker or the user has acted in the meantime. The following Node.js TypeScript example makes the policy function copyable and leaves storage and transport behind explicit interfaces. It is a worker decision component, not a complete authentication server.

```ts
type Receipt = "pending" | "delivered" | "failed" | "unknown";
type Challenge = {
  id: string;
  version: number;
  state: "sms_waiting" | "email_queued" | "verified" | "expired";
  expiresAt: number;
  fallbackAt: number;
  emailAllowed: boolean;
};
type Decision =
  | { kind: "stop" }
  | { kind: "wait"; reason: "pending" | "unknown" }
  | { kind: "expire" }
  | { kind: "hold"; reason: "delivered" | "policy_blocked" }
  | { kind: "queue_email"; reason: "sms_failed" | "poll_budget_elapsed" };

function decide(c: Challenge, receipt: Receipt, now: number): Decision {
  if (c.state !== "sms_waiting") return { kind: "stop" };
  if (now >= c.expiresAt) return { kind: "expire" };
  if (receipt === "delivered") {
    return { kind: "hold", reason: "delivered" };
  }
  if (receipt !== "failed" && now < c.fallbackAt) {
    return { kind: "wait", reason: receipt };
  }
  if (!c.emailAllowed) return { kind: "hold", reason: "policy_blocked" };
  return {
    kind: "queue_email",
    reason: receipt === "failed" ? "sms_failed" : "poll_budget_elapsed",
  };
}

interface ReceiptAdapter {
  lookup(challengeId: string): Promise<Receipt>;
}
interface Store {
  load(id: string): Promise<Challenge | null>;
  // Transactionally recheck version, state, expiry, and email policy.
  // Queueing email also inserts a unique outbox intent for this challenge.
  commit(input: {
    id: string;
    expectedVersion: number;
    observedAt: number;
    receipt: Receipt;
    decision: Decision;
  }): Promise<"applied" | "stale">;
}

async function pollOnce(
  id: string,
  store: Store,
  adapter: ReceiptAdapter,
): Promise<void> {
  const c = await store.load(id);
  if (!c || c.state !== "sms_waiting") return;
  let receipt: Receipt;
  try {
    receipt = await adapter.lookup(id);
  } catch {
    receipt = "unknown";
  }
  const observedAt = Date.now();
  await store.commit({
    id,
    expectedVersion: c.version,
    observedAt,
    receipt,
    decision: decide(c, receipt, observedAt),
  });
}
```

Implement the store contract before connecting a real sender. Its transaction must compare the version and current state, recheck expiration against the database clock, and recheck current email eligibility. Every successful state change increments the version. Redemption must participate in the same concurrency discipline. A stale result causes a fresh read on the next eligible job; it must not trigger an email directly. Store hold and wait observations without turning a delivered challenge into an expired one prematurely. A separate expiry job closes challenges that remain unredeemed.

The outbox requirement is deliberate. Updating the challenge and inserting the email intent in one transaction avoids a gap where the application records a handoff but forgets the work. Give the intent a unique key scoped to the challenge and handoff type. The downstream sender still needs a retry policy: a network timeout after submission can leave acceptance uncertain, so a unique outbox record alone does not guarantee exactly one external message. Where the transport supports deduplicated submission, pass a stable key; otherwise retain that uncertainty and bound retries.

Do not mint the email credential from the log identifier. Generate and store it through the credential service, bind it to the intended pending signup, and avoid logging the resulting URL. Redemption should atomically consume the verification attempt and invalidate any sibling credential that could complete the same step. A delivery callback may update transport history after that point, but it must never reopen verification.

For an illustrative test policy, schedule checks after 2, 5, and 10 seconds, with a 30-second fallback threshold and a separately configured credential expiry. These numbers are fixture inputs, not delivery benchmarks or security recommendations. Persist the next eligible check and use a durable scheduler. Node.js documents that timers do not guarantee exact callback timing; correctness must survive a late worker. Give adapter calls deadlines, and retry observations with bounded backoff rather than allowing a lookup to occupy a worker indefinitely.

## Make the handoff explainable to support

Before instrumentation, support sees a single label: verification failed. After instrumentation, it should be possible to distinguish a reported SMS failure from a lookup timeout and an expired credential. The improvement is the evidence model. No measured performance gain is implied.

Record a correlation identifier, challenge version, normalized receipt, observation time, decision reason, and transition outcome. Record stale commits too. Keep user identifiers and challenge IDs out of metric labels; use protected logs for individual investigations. Never record codes, full verification URLs, or full destination addresses. Access and retention should reflect that authentication logs can still reveal sensitive account activity.

Use counters for handoffs by reason, unknown observations, expired attempts, and rejected stale transitions. Measure redemption separately from delivery. Define the denominator before publishing a success rate: accepted signup attempts in a fixed cohort can answer a different question from messages accepted by a transport. Delayed redemption also makes an unfinished cohort look worse than a settled one.

Page on an actionable pattern. A rising unknown-observation rate points toward lost visibility; a rise in expired signup challenges points toward users failing to complete the flow. Set thresholds from the service's own baseline and support response capacity. Do not turn the example's 30-second threshold into a universal alert rule.

For deployment, test a pending receipt followed by failure, an unknown receipt crossing the fallback threshold, a delivered receipt with no redemption, and a policy that forbids email. Then exercise two workers racing to queue email and redemption racing with that transaction. Start a rollout with decision logging and sending disabled, inspect the reasons against expected fixtures, and enable the outbox consumer only after checking that the policy and destination selection agree. Duplicate sends cost more than transport usage: they can make a signup harder to understand and create extra support work.

## Limits to keep explicit

This design observes delivery and governs a permitted handoff. It cannot prove that a message was read, make email satisfy an authentication assurance requirement, or remove uncertainty after an ambiguous transport submission. Those limits belong in the service contract and the support runbook.

The trade-off is extra state and operational work in exchange for an explainable handoff. This approach is not suitable for a login policy that requires a stronger second factor: use a separately authorized recovery method there. Its main limitation is that polling doesn't establish possession; only credential redemption can do that.

Keep recovery policy separate from transport health. The final gate is successful, authorized credential redemption.

## References

Source URLs are collected below.

## Sources

- RFC 6376, DomainKeys Identified Mail: https://datatracker.ietf.org/doc/html/rfc6376
- NIST SP 800-63B-4, Authentication and Authenticator Management: https://pages.nist.gov/800-63-4/sp800-63b.html
- OWASP Forgot Password Cheat Sheet, token handling and recovery controls: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- Node.js timers documentation, callback scheduling limits: https://nodejs.org/api/timers.html
