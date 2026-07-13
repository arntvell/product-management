# Loom integration (Phase 4)

The Loom B2B feed builder + push (outbox) lives here.

Builds the payload per `handoff.md`: stable ids, `brand` per product, `channels`,
per-season `cancelled`/`approved_for_production`, `prices` as `(currency × {msrp, ws})`,
customs block, `manufacturer_id`, variants with `barcode` + 2-D SKU suffix.

Transport (webhook push vs. pull) is an open question — see plan §11.1. Also
receives the one write-back: per-variant weighted-average cost (plan §9).
