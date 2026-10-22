# Xiaokui × McDonald's China MCP

[简体中文](README.md) | **English**

**Choose a meal in ChatGPT. Review the real price. Personally approve each order.**

A single-owner, self-hosted bridge to McDonald's China's official MCP service, with OAuth and server-enforced approval for every order. ChatGPT can find stores, inspect meals and combo options, calculate official pricing, and submit an approved order. You complete payment yourself using the official payment link.

This is an independent community project, not a McDonald's or OpenAI product. It is server software for your own deployment, not a public ordering service or a repository you can install directly as a hosted ChatGPT connection. No official account or Token is included.

> **New to backend deployment?** The built-in standalone mode provides a real owner login and session system: you do not need KuiNest, an existing Fastify application, or a custom authentication adapter. Start with the [beginner guide (Chinese)](docs/beginners-guide.md) or the [English deployment prompt](#let-chatgpt-guide-your-deployment).

## Current status and evidence

**As of October 21, 2026:** the approval-recovery fix is deployed in the original KuiNest host. The maintainer reported completing the normal ChatGPT flow that day: per-order approval, real order creation, personal payment, and collection of the meal.

Keep the following evidence separate:

| Area | What has been verified |
|---|---|
| OAuth and MCP discovery | Real ChatGPT connection in the original host; eight bridge tools |
| Stores, menus, and meal details | Official read-only calls and actual ChatGPT use |
| Existing coupon lookup | Official lookup worked; no usable coupon was available in that check, so redemption was not validated |
| Customizations, combo selections, and actual prices | Official non-transactional price calculations |
| Normal approval → creation → payment → pickup | Maintainer's firsthand report from the original host on October 21 |
| Chinese order status and official pickup codes | Read-only checks of two existing orders on October 19 |
| Standalone authentication, approval protection, and uncertain-result handling | Offline synthetic tests; current suite contains 28 tests |
| Standalone real transaction under a separate deployment | **Not separately accepted end to end** |
| Independent payment verification | **No reliable independent field available in the inspected official contract/responses** |

The original host's success does not certify every deployment, coupon, or failure-recovery branch. Network loss, missing responses, and other exceptional paths have synthetic coverage; do not describe them all as real transaction tests. See [order status and evidence (Chinese)](docs/order-status.md) and [approval recovery (Chinese)](docs/approval-recovery.md). The [October 18 postmortem (Chinese)](docs/POSTMORTEM-2026-10-18.md) records the historical state before the first completed transaction.

This bridge targets **McDonald's China**. Eligibility, available stores, and service terms come from the official platform; this README does not imply support for other countries. Official menu data, owner webpages, and some responses remain in Chinese. Amounts are in CNY.

## Ordering flow

```text
ChatGPT finds a store and reads meals, combo choices, and customizations
  → Official price calculation
  → Select a pickup/dining option returned by the official service
  → You log in to the protected page, review the order, and approve it
  → ChatGPT submits that approved intentId
  → You pay through the official payment link
  → ChatGPT queries official order status and available pickup information
```

OAuth consent permits the connection. It does not approve a purchase. A chat message saying “yes” or “I confirm” cannot replace the protected webpage approval.

## Tools and supported scope

| Bridge tool | Purpose |
|---|---|
| `query-nearby-stores` | Query favorite stores, or search by city and keyword |
| `query-store-coupons` | List already-held coupons available at the selected store |
| `query-meals` | Read the store menu; listed menu prices are only a reference |
| `query-meal-detail` | Read combo rounds, component choices, replacements, and customizations |
| `calculate-price` | Validate explicit selections, obtain official pricing, and create a `quoteId` |
| `prepare-order` | Select a quoted `takeWayCode` and prepare the protected approval page |
| `create-order` | Submit only a server-stored, owner-approved `intentId` |
| `query-order` | Read local intent progress or query its known official order |

The bridge currently permits **immediate orders for collection at the restaurant**: `orderType=1`, `beType=1`. Dine-in and takeaway choices must come from the current official `takeWayList`; do not invent or reuse a code from another quote.

Delivery, scheduled or group orders, password-free payment, cancellation, points, coupon claiming, and marketing tools are outside this bridge's scope. That does not assert that the official platform lacks those features.

## Prerequisites

- **Runtime:** Node.js **24.20.0 or later within 24.x**, plus npm. The documented environment is Ubuntu 24.04 x64 with Node 24.20.0.
- **Hosting:** your own server and HTTPS domain. The repository supplies systemd/nginx templates, not one-click hosting. Server/domain fees depend on your provider.
- **Official credentials:** your own legitimately obtained Token from the [McDonald's China platform](https://open.mcd.cn/mcp), subject to its eligibility and terms. The upstream uses Streamable HTTP and Bearer authentication; see the [official MCP repository](https://github.com/M-China/mcd-mcp-server).
- **ChatGPT access:** an account/workspace that allows custom remote MCP connections. Availability and interface names depend on your account and workspace policy. No OpenAI API key is required by this backend.

`better-sqlite3` is a native dependency. The pinned **13.0.3** package includes platform N-API binaries and has no installation lifecycle script; install dependencies on the target Linux platform and verify them there. Do not copy Windows `node_modules` to Linux. Different architectures or future dependency versions may require their own build preparation.

One instance is for one owner and one official account. There is no public registration, shared credential service, remote password recovery, or automatic UNKNOWN unlock.

## Install and initialize standalone mode

In your own Linux terminal:

```sh
git clone https://github.com/AriaEternity/xiaokui-mcd-mcp.git
cd xiaokui-mcd-mcp
npm ci
npm test
umask 077
npm run owner:init
npm run token:init
```

`npm test` builds the project and runs offline tests with synthetic accounts and upstream responses. It does not read your official Token or contact the official service. A passing test run is not a successful real order.

The two initialization commands require an interactive terminal and hide input:

- `owner:init` creates private `data/owner.json` with a random owner ID, salt, and scrypt password hash. The default username is `owner`; choose a password of at least 16 characters.
- `token:init` stores your official Token, without the `Bearer` prefix, in private `credentials/mcd-token`.

Both refuse to overwrite existing files. For a deliberate installation outside the checkout, the scripts accept `OWNER_FILE` and `MCD_TOKEN_FILE` as destination paths. These variables contain paths, never Token contents. Do not reinitialize an existing owner to reset a password or unlock an order.

These commands alone do **not** configure public HTTPS, start a production service, or connect ChatGPT.

## Configure and start your deployment

The [beginner guide (Chinese)](docs/beginners-guide.md) gives the full first-install sequence, including DNS, Node, service users, certificates, credentials, and nginx. The [deployment guide (Chinese)](docs/DEPLOYMENT.md) also covers advanced integration and rollback.

For the standalone installation:

1. Create dedicated program, credential, and state directories. The templates use `/opt/xiaokui-mcd/current`, `/etc/xiaokui-mcd`, and `/var/lib/xiaokui-mcd`.
2. Install the owner record and official Token as separate protected files. The systemd template uses `LoadCredential` for both `owner.json` and `mcd-token`; the process verifies its private credential files.
3. Adapt the [service template](deploy/xiaokui-mcd.service.example), [nginx site](deploy/nginx-site.conf.example), and [proxy snippet](deploy/nginx.conf.example) to your server. Prepare the HTTPS certificate before enabling the final TLS site.
4. Set the non-secret configuration below through the service manager. Validate the configurations and start only your new gateway.
5. Check local `/health/ready`, public OAuth discovery, and anonymous MCP rejection. Then authorize from ChatGPT and perform a real read-only query and price calculation while creation remains disabled.

```ini
PUBLIC_ORIGIN=https://mcd.example.com
DATA_ROOT=/var/lib/xiaokui-mcd
PORT=4318
MCP_OAUTH_ENABLED=true
MCD_MCP_ENABLED=true
MCD_ORDER_CREATE_ENABLED=false
```

Replace the example domain with your own exact HTTPS origin, without a trailing slash. `DATA_ROOT` must be an absolute private path. If another service already uses port 4318, change this instance's port and its nginx upstream together.

**`.env.example` is a reference; `npm start` does not load it automatically.** The systemd template uses an `EnvironmentFile` for non-secret settings. Outside systemd, experienced operators can set `OWNER_FILE` to the owner file and `MCD_CREDENTIAL_ROOT` to the private directory containing `mcd-token`. Do not put Token contents in environment variables, command arguments, logs, or chat.

After configuration, `npm start` runs the built-in standalone server. A successful start prints `MCD_GATEWAY_READY`; local readiness returns HTTP 200. A successful start proves neither official authentication nor real ordering; verify those in separate stages.

The built-in identity system verifies the real owner password. It uses Secure/HttpOnly/SameSite cookies, same-origin and CSRF checks, login rate limiting, and eight-hour server-side sessions. Session digests, OAuth state, and orders are separately persistent. Browser access must use HTTPS; do not weaken Cookie settings to use HTTP.

## ChatGPT OAuth connection

Use these values for **this public package**, replacing the example domain throughout:

| Parameter | Value |
|---|---|
| MCP URL / OAuth Resource | `https://mcd.example.com/api/mcd/orders/mcp` |
| Client ID | `xiaokui-chatgpt-mcd` |
| Client Secret | Leave blank; public client |
| Scope | `mcd:orders:create` |
| Authorization URL | `https://mcd.example.com/api/mcd/oauth/authorize` |
| Token URL | `https://mcd.example.com/api/mcd/oauth/token` |
| Revocation URL | `https://mcd.example.com/api/mcd/oauth/revoke` |
| Issuer | `https://mcd.example.com` |
| Authorization server discovery | `https://mcd.example.com/.well-known/oauth-authorization-server` |
| Protected resource metadata | `https://mcd.example.com/.well-known/oauth-protected-resource/api/mcd/orders/mcp` |
| Redirect URI | `https://chatgpt.com/connector_platform_oauth_redirect` |
| PKCE | `S256` required |

Use the custom remote MCP connection flow available in your ChatGPT account and select OAuth. Sign in on your own gateway's HTTPS site and review the requested scope. Successful discovery should expose **eight tools**. Client IDs and scopes are public identifiers, not secrets; the official McDonald's Token belongs only on the server and must not be entered as a Client Secret.

Despite the scope name, `MCD_ORDER_CREATE_ENABLED=false` still blocks real creation, and enabling it never bypasses per-order owner approval. Use the disabled stage for real stores, menus, combo details, and `calculate-price`.

## Your first supervised order

Only after verifying your login, OAuth, read-only queries, pricing, and protected confirmation page should you explicitly enable `MCD_ORDER_CREATE_ENABLED=true` for your instance. This is an operator decision, not a setup test to automate.

1. Ask ChatGPT to find a store by city and keyword, then read the current menu and required meal details. Select all combo components and customizations from the actual response.
2. Call `calculate-price`, review quantities, fees, discounts, and the actual CNY amount, and select an official `takeWayCode`. Call `prepare-order` for the confirmation page.
3. Open that page yourself, log in, check the restaurant and complete order, and approve it. Wait until the page explicitly reports that the server saved the approval and displays its actual deadline.
4. Return to ChatGPT. Check `query-order` for `approvalStatus` and `approvalExpiresAt`, then submit the **same** approved `intentId` while valid. The server recalculates the price; a changed snapshot requires another review and approval.
5. After confirmed order creation, open the official returned payment link and pay yourself. Query that same order for official status and available pickup information.

A quote lasts five minutes. Approval lasts at most two minutes and cannot outlive the quote. Clicking the button alone is not proof that approval was saved. If a response is lost, use the page's status recheck; it does not automatically repeat approval or create an order. Expired quotes/approvals need fresh pricing and personal approval. See [approval recovery (Chinese)](docs/approval-recovery.md).

## Read payment and pickup information correctly

Order fulfillment, independent payment verification, and the owner's firsthand experience are different facts:

- `officialOrderStatus` preserves the official status; `normalizedOrderStatus` and `orderStatusName` provide the recognized fulfillment state. Known numeric and Chinese status formats are handled; unknown formats remain unknown.
- `paymentVerification.status` remains `unverified` when the official response provides no independent payment evidence. **This does not mean the user has not paid.** Preparing/completed states, a payment ID, amounts, or a chat statement are not converted into independent verification.
- Valid official pickup fields can be returned for a matching known order in an appropriate fulfillment state even when independent payment verification is unavailable. They are never generated by the bridge.
- `pickupInformationStatus` explains whether information is `available`, `not_provided`, `withheld`, or `invalid`. Pending, cancelled, unknown, malformed, or mismatched results do not release pickup information. Missing fields are explained rather than guessed.

Only validated official `pickupCode`, `lockerCode`, or `lockerQrCode` fields are eligible for display. A completed order's code is historical information, not a promise that food remains waiting. See the [field reference and evidence (Chinese)](docs/order-status.md).

## Uncertain creation results and recovery

Before contacting the official create tool, the server persists `SUBMITTING`. Local locks, stored result reuse, and duplicate-basket checks reduce repeat submissions. If the response cannot establish the outcome, the intent becomes `UNKNOWN` and blocks further quotation/submission for that owner.

**Never automatically retry creation, create another intent to replace it, delete records, or remove locks to unlock an uncertain order.** Check the official account yourself. The bridge cannot promise exactly-once behavior in an external service.

The server also enforces OAuth/PKCE and authorization binding, real owner sessions, Origin/CSRF/private nonce checks, short-lived approval, repricing, and fixed upstream/tool restrictions. There is no MCP approval tool or `confirmed:true` bypass. `not_sent` describes the current call; it is not blanket permission to retry a purchase.

For rollback, preserve the current owner file, sessions, OAuth database, intents, SUBMITTING/UNKNOWN records, and locks. Switch program versions with creation disabled; do not restore an old business-state snapshot over newer records. Code rollback cannot cancel an order. Read [SECURITY.md (Chinese)](SECURITY.md) before enabling creation.

## Advanced: integrate an existing Fastify host

Standalone is the beginner path. Existing hosts can keep using the exported integration function:

```ts
import {registerMcdGateway} from './dist/index.js';

registerMcdGateway(app, {
  dataRoot: '/var/lib/xiaokui-mcd',
  publicOrigin: 'https://mcd.example.com',
  ownerId: configuredOwnerId,
  token: tokenReadFromProtectedCredentialFile,
  inspectSession: inspectYourExistingOwnerSession,
  createEnabled: false,
});
```

Here `app`, `configuredOwnerId`, the credential, and `inspectYourExistingOwnerSession` must come from your real host. This snippet is integration code, not a substitute login implementation. `inspectSession(cookie)` must verify a real server-side session and return `{ownerId, csrfToken}` or `undefined`. The host supplies compatible same-origin `/api/v1/auth/session` and `/api/v1/auth/login` endpoints.

The adapter-based launcher remains available as `npm run start:host`, using `OWNER_AUTH_ADAPTER` and `MCD_OWNER_ID`. Beginners do not need either setting. If your existing host owns OAuth discovery, integrate with that provider instead of registering conflicting well-known endpoints or overwriting an existing authorization database. Details are in [deployment documentation (Chinese)](docs/DEPLOYMENT.md).

## Let ChatGPT guide your deployment

```text
Help me deploy https://github.com/AriaEternity/xiaokui-mcd-mcp. I have no backend experience.
Read the latest README.en.md, docs/beginners-guide.md, docs/DEPLOYMENT.md, docs/faq.md, docs/order-status.md, docs/approval-recovery.md, SECURITY.md, package.json, src/main.ts, and deployment templates first. Explain Chinese documents in my language. If a file is inaccessible, say so instead of guessing.
Ask about my computer, ChatGPT custom MCP access, eligibility for my own official McDonald's China MCP Token, server/domain, server OS/architecture, and budget before recommending purchases.
Use this repository's built-in standalone mode; do not ask me to write OWNER_AUTH_ADAPTER. Follow the documented Ubuntu 24.04 x64, Node 24.20.0 and systemd/nginx route. Install better-sqlite3 on the target Linux platform. Give one step at a time with where to act, exact input, expected output, and troubleshooting; wait for my result.
Keep server, gateway owner, official McDonald's, and ChatGPT accounts separate. Never ask me to paste passwords, Tokens, Cookies, codes, private keys, owner files, or databases. I must enter secrets privately with hidden input. Check separate ports and directories if Luckin runs on the same host. Use this repository's /api/mcd/oauth/* paths.
First complete offline tests, HTTPS, owner:init, token:init, OAuth, real store/menu/combo queries, calculate-price, and official pickup-option checks. Keep MCD_ORDER_CREATE_ENABLED=false. Do not automatically approve, create, cancel, or pay. Preserve owner approval, repricing, persistence, and UNKNOWN protection.
Explain that original-host real use, official read-only evidence, and standalone synthetic tests are separate. Preparing/completed states do not independently verify payment, and unverified does not mean unpaid. Start with prerequisite questions and only the first step.
```

## Troubleshooting

| Symptom | What to check |
|---|---|
| `MCD_START_FAILED` | Node 24.x version, exact HTTPS origin, owner file, credential directory, permissions, and target-platform dependency install; do not print secrets |
| Browser login fails | HTTPS/Secure Cookie handling, real owner password, same origin, and login rate limit |
| OAuth fails | This package's exact resource/client/scope and `/api/mcd/oauth/*` URLs; do not copy Luckin's parameters |
| Favorite-store lookup fails | Use city and keyword lookup |
| `MCD_BUSY` during details queries | Reduce read-only concurrency; the adapter permits at most two in-flight upstream calls. Never apply automatic create retries |
| Clicked approval but ChatGPT cannot submit | Recheck server-saved approval and actual expiry; refresh an old confirmation page after updating |
| Completed order still says `unverified` | Independent payment evidence is unavailable; read `notice`, not “unpaid” |
| Pickup information is missing | Read `pickupInformationStatus` and `notice`; check the official account/store, without making a replacement order |
| UNKNOWN or a retained lock | Stop creation and reconcile with the official account; preserve state |

See the [FAQ (Chinese)](docs/faq.md) and [initial standalone validation record (Chinese)](docs/standalone-validation.md). Report problems with synthetic examples only; remove Tokens, Cookies, payment links, order/pickup identifiers, personal addresses, and identifiable store history.

## Sources and license

The project's own implementation is available under the [MIT License](LICENSE); see [NOTICE.md](NOTICE.md) for dependency and source boundaries. Official services, accounts, and trademarks remain subject to their own terms. MIT grants no additional rights to those services or brands.

Business behavior follows the [official platform](https://open.mcd.cn/mcp) and [official MCP repository](https://github.com/M-China/mcd-mcp-server). The [community ChatGPT proxy recipe](https://github.com/yoruuuchan/chatgpt-mcp-connect/tree/main/recipes/mcdonalds) informed connection design; its Worker architecture and code were not copied. The public bridge extracts the McDonald's modules and OAuth pattern from KuiNest without including the private host, production settings, accounts, or conversations.
