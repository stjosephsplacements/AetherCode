# messaging

Versioned event envelopes, JetStream publishing, and transactional inbox/outbox
helpers. Producers persist an event in their local transaction before broker
publication; consumers dedupe it in their own inbox transaction. Publisher
leases are crash-safe and broker retries use `Nats-Msg-Id` event de-duplication.
