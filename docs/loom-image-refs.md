# What Origio sends Loom in `image` — 2026-09-16

Raised when SS27 Barnes Fade Bone synced correctly but its image did not show up
in Loom. Below is what is **established** and what is still **unverified**. The
cause is not yet proven; one question to Loom/Kristoffer decides it (bottom).

## Established: the sync does fetch images

`syncSeason` collects one MAIN image per colorway per season (`buildColorway` →
`ctx.imageRows` → `syncImages`) into `SeasonImage`, unique on
`(seasonId, colorwayId, slot)`. Mode `full` includes them, `no-images` skips.

Fade Bone's SS27 image row exists and is correct — it is Threadflow's own SS27
Fade Bone asset. So nothing was missed on our side of the sync.

Current state: **504 `SeasonImage` rows, all SS27, all MAIN.** No other season has
images at all.

## Established: what the payload actually carries

`src/lib/loom/payload.ts:210` emits the stored value verbatim:

```ts
image: cw.seasonImages[0]?.url ?? null,
```

and all 504 stored values are **relative Threadflow API refs**:

```
/api/external/v1/images/api/files/linesheet-derivatives/colorway/<uuid>.webp
```

Confirmed by `POST /api/catalog/push/loom` with `dryRun: true` (builds the
payload, transmits nothing):

- `mode: "full"` → `"image": "/api/external/v1/images/…/33513dbb-….webp"`
- `mode: "data"` → **no `image` key at all**; the registry colorway drops it.

Nothing in the push path absolutises or re-hosts the ref. `/api/catalog/tf-image`
exists to render these, but it is a proxy for our own browser and `middleware.ts`
gates the whole app behind `APP_PASSWORD`.

## Established: the push happened

Fade Bone's LOOM `ChannelPublication`: `lastPushedAt` 2026-09-16 18:57:35,
`lastPushStatus` `ok`, one minute after the SS27 sync (18:56:12). `PushBatch` is
empty, so **the mode of that push is not recorded anywhere** — we cannot tell
from the database whether it was `full` or `data`.

## Unverified — do NOT treat as fact

Whether Loom can resolve a relative Threadflow ref. It is not a URL anyone
outside Threadflow can fetch, and it needs an `X-API-Key`. But
`docs/barnes-porcelain-clash.md` records evidence that **Loom reads Threadflow
directly** (it named a TF colorway id for a SKU we never sent it). A TF-aware
consumer with its own key resolves that ref trivially. So the ref may be exactly
what Loom wants.

## Three candidate causes

1. ~~**The push was `data` mode.**~~ **Eliminated 2026-09-16.** The publishing UI
   has no mode control — the string `mode` does not appear in
   `publishing-table.tsx` or `publishing/page.tsx`, and `pushLoomSelected` sends
   only `colorwayIds`, `seasonCode` and an optional retry `eventId`. The route
   defaults `body.mode ?? "full"`, so **every UI push is already `full`** (and the
   `-main` checkout's route ignores `mode` entirely, also landing on full). The
   18:57 push therefore did carry the image, as the relative ref.
2. **Loom does not apply updates to a product it already holds.** Fade Bone has
   been in Loom since 2026-09-13 (`data` mode, so with no image). On 09-15 a
   re-push carrying a changed name returned `created 0, updated 0`. If that is
   how their upsert behaves, today's push added the SS27 entry but left the
   product-level image as it was: empty. This fits every fact we have.
3. **Loom cannot resolve the relative ref.** Systemic — but then *no* product
   would have an image, which nobody has reported.

## Re-pushing from the UI does not retry

`event_id` is **derived from the delivery's contents** when not supplied, so the
same selection re-pushed produces the same id and Loom dedupes it into the
original job — returning that job's result rather than doing the work. The UI
only sends a fresh id when a previous preview recorded a `failedEventId`, so a
plain "push again" on a successful-looking push is a no-op. Forcing a real retry
needs an explicit `eventId`, which the UI cannot supply — use the API directly.

## The one question that decides it

**Do other SS27 products show images in Loom?**

- **Yes** → candidate 3 is dead; it is 1 or 2, and both are about this product,
  not about the ref format. Check which mode was pushed, then re-push `full`.
- **No** → the ref format (or `data` mode) is the systemic cause, and the fix is
  to send an absolute, publicly fetchable URL.

Only if it turns out to be 3: `@vercel/blob` is already a dependency and
`src/lib/master/media.ts` already does server-side `put`/`del`, so the clean path
is to fetch the ref via `fetchImage` (which holds the API key), `put` it to Blob,
and store the public URL in `SeasonImage.url` — `payload.ts` then needs no
change. **Ask Loom what they expect in `image` before building that**; if they
resolve TF refs themselves it is wasted work.

## Incidental — confirms the Fade Bone residue

504 rows hold **503 distinct URLs**. The single duplicate is `33513dbb-…webp`,
held by both `LIV-BAR-FAD-BON` (correctly) and `LIV-BRNS-FDD-PRCLN`. Faded
Porcelain's SS27 image is Fade Bone's image — the same crossed-binding residue as
its SS27 prices, and one more thing to clear when that decision is made.
