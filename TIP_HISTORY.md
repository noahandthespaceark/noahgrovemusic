# Square tip receipt service

The website owns the Square connection and durable D1 tip receipts. `/api/ai/tips` accepts only TIP_HISTORY_READ_TOKEN, a separate credential restricted to reading this route. The same credential is held by SetBliss, whose private owner interface and Integration Hub adapter expose the history. No Square access token is copied to SetBliss.

`_tip-history.js` stores provider payment IDs, paid timestamps, amount/currency, refund amounts, available customer names/emails and optional guest messages. No card details are retained. The signed Square webhook writes receipts before alert processing. Historical reads reconcile up to 10 location-scoped Square payments per page, return the next cursor, and never replay alerts or send mail. Explicit SB/NG tip references and known `Tip the Music` / `Support the Music` items distinguish tips from other purchases.

The public tip checkout can receive source=setbliss and optional guest_name/message. Its redirect is fixed to the owned SetBliss request page; arbitrary return URLs are not accepted. SetBliss verifies and stores its own song-request context against the returned reference. Square payer identity and self-reported guest identity remain distinct. Receipt feedback is separate and unavailable through the Payments API.

The service uses the existing production DB binding and creates its receipt/context tables idempotently. It neither changes merchant permissions nor makes test charges. Tests cover private authorization, legacy $5/$10 import, idempotency and absence of outbound alert calls.
