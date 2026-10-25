/**
 * `?id=<uuid>` rather than a dynamic segment, matching
 * `GET /api/mobile/exercise?id=` — the `route()` helper never receives Next's
 * `params`, so the whole stack stays on one convention.
 */
export { default } from "@/features/exercise";
