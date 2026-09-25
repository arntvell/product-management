import { apiCreator } from "./api-creator";
import { worklistCreator } from "./worklist-creator";
import type { SitooCreator } from "./types";

export * from "./types";
export { sitooWorklistCsv } from "./worklist-creator";
export { SitooCreateError } from "./api-creator";

/**
 * Which creator to use.
 *
 * Worklist by default, deliberately. The API path is real and tested against the
 * published spec, but Sitoo is the till — a wrong write there is a garment that
 * cannot be sold — and thirteen products vanished from it unexplained on
 * 12 September. Turning on the API path should be a decision somebody makes,
 * not the default they inherit.
 */
export function getSitooCreator(): SitooCreator {
  return process.env.SITOO_CREATE_MODE === "api" ? apiCreator : worklistCreator;
}
