# Threadflow integration (Phase 1)

The typed client for the Threadflow External Read-Only API lives here.

- Base URL: `process.env.THREADFLOW_URL`
- Auth: `X-API-Key: process.env.THREADFLOW_API_KEY`
- Primary endpoints: `GET /api/external/v1/products?seasonId=…`, `/manufacturers`, `/manufacturers/:id`, `/images/<path>`

See `docs/product-master-architecture.md` §5 for the ingestion design (upsert rules,
barcode set-once, don't-clobber-customs, field ownership, sync modes).
