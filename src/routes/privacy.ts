import type { RouteContext } from "./context.js";
import { APP_ROUTE_PREFIX, VIEWER_PATH } from "./constants.js";
import { stateRetentionSeconds } from "../services/privacy-policy.js";

export const PRIVACY_PATH = `${APP_ROUTE_PREFIX}/privacy`;
const CONTACT_FIELDS = {
  operator: "RUBY_HIGH_PRIVACY_OPERATOR",
  email: "RUBY_HIGH_PRIVACY_EMAIL",
  address: "RUBY_HIGH_PRIVACY_ADDRESS",
  phone: "RUBY_HIGH_PRIVACY_PHONE",
} as const;
export type PrivacyContact = Record<keyof typeof CONTACT_FIELDS, string>;

export function privacyContactFromEnv(): PrivacyContact | null {
  const entries = Object.entries(CONTACT_FIELDS).map(([key, setting]) => [key, process.env[setting]?.trim() ?? ""]);
  const contact = Object.fromEntries(entries) as PrivacyContact;
  if (Object.values(contact).some(value => !value || value.length > 1000)) return null;
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contact.email)) return null;
  return contact;
}

export function privacyConfigurationErrors(): string[] {
  const errors: string[] = [];
  if (!privacyContactFromEnv()) errors.push("Set RUBY_HIGH_PRIVACY_OPERATOR, RUBY_HIGH_PRIVACY_EMAIL, RUBY_HIGH_PRIVACY_ADDRESS and RUBY_HIGH_PRIVACY_PHONE to approved public contact details.");
  if (stateRetentionSeconds() <= 0) errors.push("Set RUBY_HIGH_STATE_TTL_SECONDS to a positive retention period.");
  return errors;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderPrivacyNotice(contact: PrivacyContact): string {
  const days = Math.ceil(stateRetentionSeconds() / 86400);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ruby High — Privacy</title>
<style>body{margin:0;background:#1a1c25;color:#f6efe3;font:18px/1.6 system-ui,sans-serif}main{max-width:46rem;margin:3vh auto;padding:1.5rem}h1,h2{line-height:1.2}h2{margin-top:2rem;font-size:1.35rem}a{color:#f6cf7c}address{font-style:normal;white-space:pre-line}li{margin:.5rem 0}nav{display:flex;gap:1.5rem;flex-wrap:wrap}p,li,address{overflow-wrap:anywhere}</style></head><body><main>
<nav aria-label="Privacy navigation"><a href="/">Ruby High home</a><a href="${VIEWER_PATH}">Play Ruby High</a></nav>
<h1>Privacy at Ruby High</h1><p>Updated October 7, 2026.</p>
<h2>Who runs Ruby High</h2><address>${escapeHtml(contact.operator)}<br>${escapeHtml(contact.address)}<br>${escapeHtml(contact.phone)}</address><p>Privacy questions: <a href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a>.</p>
<h2>Our players</h2><p>Ruby High is a school story game for teens 13+ and adults. The entry confirmation opens your game session. Its answer is used during that request.</p><p>Choose a fictional student name. In classroom dialogue, you choose actions and cards. The game supplies your student's words.</p>
<h2>Information used by the game</h2><ul>
<li>Session cookies and account IDs keep you signed in and connect your saved students and progress.</li>
<li>A browser visitor ID, stored on your device, helps us count visits and returns. The server saves a hash of this ID.</li>
<li>Student names, character choices, results, generated dialogue and game events support your school story.</li>
<li>Fixed game events and performance measurements help us understand game use, fix errors and improve loading.</li>
<li>Request network information helps the host deliver pages and helps us limit abuse.</li>
</ul><p>We limit these identifiers to login, game progress, game preferences, service measurement and security. The viewer uses fixed event fields. Access to saved records uses account checks or a private admin credential.</p>
<h2>Optional features</h2><p>Passkeys add a public credential and recovery-code hash to your account. Wallet features add your wallet address and network. Payment and purchase records track your game purchases. Creator tools save the material you upload or write.</p>
<h2>Other services</h2><p>Fly.io hosts the app. AI features send game context and generated dialogue to OpenRouter and the selected model provider. Our OpenRouter requests require provider routing with zero prompt retention and restricted data collection. OpenRouter keeps request metadata under its own privacy rules.</p><p>Optional features use Privy for wallet login, Stripe for card payments, Solana network services for wallet transactions, and model providers for generated artwork. Amazon S3 or an S3-compatible service stores generated artwork. Some artwork or NFT material can be published through Arweave. Each service receives the information needed for that feature. Public blockchain and Arweave records can remain available after account deletion.</p><p>Community links open services such as Discord, X and Telegram. Their privacy rules apply when you use them.</p>
<p>Bug reports can be sent to a GitHub repository. Reports in a public repository are visible to the public. Keep reports about game faults and use the privacy email for private information.</p><h2>Public game activity</h2><p>Shared rooms contain game dialogue. New students start with public school activity and teacher social posts switched off. Showing your student enables school activity. Teacher social posting has a separate choice. Shared yearbooks and published courses can show fictional student names, artwork and results. Review a feature's sharing choices before publishing material.</p>
<h2>How long records stay</h2><p>Login cookies expire after 30 days. The default game retention period is ${days} days. Game saves expire within that period after their last save. Account records expire after their last recorded activity. Metrics and school events expire within that period after their last save. Shared dialogue and summaries have a 90-day limit. Teacher observations have a 90-day limit.</p><p>Hosting backups and records held by payment, wallet and other services follow their own retention rules. A privacy request lets us review any related copies with you.</p>
<h2>Your choices and deletion</h2><p>Account settings includes a Copy privacy request ID button. Include this ID in a privacy email so we can find your records.</p><p>Open Account, then Account settings, then Delete Account to remove your guest or saved account and its game records. A saved passkey account asks you to confirm your passkey. Deletion also removes linked classroom history and teacher observations.</p><p>You or your parent can contact the privacy email above to ask what records we hold, request correction or deletion, or ask us to stop further collection. We use the minimum information needed to confirm the request relates to your account. Please keep account passwords, recovery codes and wallet secrets private.</p>
<h2>Children under 13</h2><p>A parent who believes a child under 13 has used Ruby High can contact us for help. We review the account, stop its access and remove its game records. Any future feature for children under 13 requires a separate privacy review and a suitable consent or limited-data design.</p>
</main></body></html>`;
}

export function handlePrivacyRoute(ctx: RouteContext): boolean {
  if (![PRIVACY_PATH, "/privacy", "/privacy/"].includes(ctx.pathname)) return false;
  if (ctx.method !== "GET" && ctx.method !== "HEAD") { ctx.error(ctx.res, "Use GET to read the privacy notice.", 405); return true; }
  const res = ctx.res as { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void };
  const contact = privacyContactFromEnv();
  res.statusCode = contact ? 200 : 503;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'");
  res.end(ctx.method === "HEAD" ? undefined : contact ? renderPrivacyNotice(contact) : "<h1>Ruby High privacy</h1><p>The privacy notice is being prepared. Please check back soon.</p>");
  return true;
}
