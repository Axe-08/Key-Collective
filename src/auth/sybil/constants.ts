/**
 * Key Collective v3 — Anti-Sybil Defense Constants & Denylists
 *
 * Conforms to:
 * - docs/research/v3_landscape.md (Section 2: Anti-Sybil Defense)
 * - docs/architecture/lld_pod-auth-sybil.md (Section 4.2: Sybil Defense)
 */

export const BUILDER_MIN_ACCOUNT_AGE_DAYS = 30;
export const BUILDER_MIN_PUBLIC_REPOS = 1;
export const BUILDER_MIN_CONTRIBUTIONS = 5;

export const SYBIL_SCORE_BUILDER_THRESHOLD = 65;
export const SYBIL_SCORE_PROBATIONARY_THRESHOLD = 40;

export const SUBNET_VELOCITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const MAX_REGISTRATIONS_PER_SUBNET = 1;

export const SYBIL_MIN_ACCOUNT_AGE_DAYS = 30;
export const SYBIL_MIN_ACTIVITY_REPOS = 5;
export const SYBIL_MIN_ACTIVITY_CONTRIBUTIONS = 20;

/**
 * Standard Cloudflare Turnstile test tokens.
 */
export const TURNSTILE_TEST_TOKENS = {
  ALWAYS_PASS: "1x0000000000000000000000000000000AA",
  ALWAYS_FAIL: "2x0000000000000000000000000000000AB",
  TOKEN_ALREADY_SPENT: "3x0000000000000000000000000000000AC",
  VALID_FIXTURE: "valid_turnstile_response",
  INVALID_FIXTURE: "invalid_turnstile_response",
} as const;

/**
 * High-velocity disposable / burner email provider domain denylist.
 * Rejects temp-mail, guerrilla-mail, fake inboxes, and disposable forwarders.
 */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "temp-mail.org",
  "tempmail.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "mailinator.com",
  "10minutemail.com",
  "10minutemail.net",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.net",
  "trashmail.org",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "sharklasers.com",
  "getairmail.com",
  "dispostable.com",
  "burnermail.io",
  "fakeinbox.com",
  "maildrop.cc",
  "mohmal.com",
  "fakemailgenerator.com",
  "crazymailing.com",
  "mytemp.email",
  "emailondeck.com",
  "tempail.com",
  "inboxkitten.com",
  "generator.email",
  "discard.email",
]);

/**
 * Datacenter and Cloud Hosting ASNs known for bot farms, residential proxies, and scraper egress.
 */
export const DATACENTER_ASNS: ReadonlySet<number> = new Set([
  16509, // Amazon Web Services (AWS)
  14618, // Amazon.com
  24940, // Hetzner Online GmbH
  14061, // DigitalOcean
  16276, // OVH SAS
  63949, // Linode / Akamai
  15169, // Google Cloud
  8075,  // Microsoft Azure
  31898, // Oracle Cloud
  20473, // Choopa / Vultr
  45102, // Alibaba Cloud
  200130, // Clouvider
]);
