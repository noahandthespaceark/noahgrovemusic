# Standalone Integration Contract v1

Phase 0 covers GigDashboard, Unified, TimeBrain, SpaceARK, SetBliss, LiveWall, SocialWorker, DinoQR, eOpenMic, CharlestonOpenMics and NoahGroveMusic. MarketMusic is excluded.

Authority boundaries: GigDashboard=booking/business; Unified=conversations; TimeBrain=tasks/reminders/waiting work; SpaceARK=live-show orchestration; SetBliss=repertoire/requests/played state; LiveWall=audience media; SocialWorker=social composition/scheduling/publishing; DinoQR=QR routing/scans; eOpenMic=open-mic production; CharlestonOpenMics=public local listings; NoahGroveMusic=public website/conversion experiences/site analytics.

Cross-app identity uses stable opaque `gig_id`, `contact_id`, and `venue_id`. Existing local IDs remain unchanged. Preferred new IDs are `gig_<uuid-or-ulid>`, `contact_<uuid-or-ulid>`, and `venue_<uuid-or-ulid>` and must not depend on mutable data.

Future events use `schema_version`, `event_id`, `event_type`, `source_app`, optional `source_record_id`, `occurred_at`, `idempotency_key`, optional subject IDs, `data`, and optional trace IDs. Event names are lowercase dotted past-tense facts. Delivery is at-least-once; consumers are idempotent; existing direct integrations remain until explicitly replaced; apps do not share a D1 database; secrets remain server-side.

Phase 1 is additive only. `integration_links` maps local records to canonical identity and `integration_event_receipts` provides a future-safe idempotency journal.

## NoahGroveMusic role
NoahGroveMusic owns the public website, public conversion experiences, music/commerce entry points and site analytics. It should emit public conversion/commerce facts and link them to known `gig_id`/`contact_id` values when available, while GigDashboard owns booking state and SocialWorker owns publishing.
