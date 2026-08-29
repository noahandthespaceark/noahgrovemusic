# SetBliss to NoahGrove Firebot Commerce Bridge

SetBliss request-page tips and merch purchases publish completed commerce events to the main noahgrove.com `/api/record-commerce-event` endpoint using `COMMERCE_TRACKING_SECRET`.

The main site records those events in stats and queues them into the same Firebot queues already used by the noahgrove.com support page:

- tips -> `TIP_EVENTS` / `/api/tip-events`
- merch -> `TIP_EVENTS` merch queue / `/api/merch-events`

The existing Mac Firebot listeners can keep polling the main noahgrove.com endpoints.
