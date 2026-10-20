// Letting the database sleep while nobody uses FarePay. A database that is billed (or limited, e.g. Neon's free
// plan) by the hours it is awake should not be woken every few seconds by background timers with nothing to do.
// Background jobs run while FarePay is being used (any request except /health, for QUIET_AFTER_MINUTES after it),
// and otherwise only when one of them has something due at a known time (e.g. a seat reminder at 06:30).
import { config } from '../config.js';

let lastActivity = Date.now(); // a fresh start counts as activity (finishes anything left from before)

/** A real request (a person, M-Pesa, Africa's Talking) reached FarePay. */
export const noteActivity = () => {
  lastActivity = Date.now();
};

/** FarePay was used in the last QUIET_AFTER_MINUTES. */
export const recentlyActive = (now = Date.now()) => now - lastActivity < config.quietAfterMs;

/**
 * Whether a background job should run now: always while FarePay is in use; when quiet, only once its next known
 * time (`dueAt`, ms; null = nothing waiting) has come.
 */
export const shouldRun = (dueAt, now = Date.now()) => recentlyActive(now) || (dueAt !== null && dueAt !== undefined && now >= dueAt);
