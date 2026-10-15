/**
 * Bootstraps the plugin's connection to Identity Security Cloud (ISC).
 *
 * Two things have to happen before we can call any certification API:
 *
 *  1. The UI plugin SDK completes its iframe handshake with the ISC "App Shell"
 *     and resolves the signed-in user + tenant context (`sdk.getContext()`).
 *     As a side effect of the handshake the SDK also registers
 *     `window.sailpointConfig()`, a provider that hands back a fresh
 *     `{ baseurl, accessToken }` on demand.
 *
 *  2. `sailpoint-api-client`'s `Configuration.autoconfigure()` reads that
 *     provider, so the generated API classes authenticate using the tenant
 *     session automatically. We never handle tokens by hand.
 *
 * This module is intentionally injectable: `initPlugin` accepts a pre-built SDK
 * so tests can point it at the mock App Shell's `targetOrigin`.
 */
import { createSDK } from '@sailpoint/ui-plugin-sdk'
import type { PluginContext, SailPointPluginSDK } from '@sailpoint/ui-plugin-sdk'
import {
  CertificationsApi,
  CertificationSummariesApi,
  Configuration,
  SearchApi,
} from 'sailpoint-api-client'
import type { CurrentUser } from './types'

/** Everything the app needs after a successful connection. */
export interface PluginRuntime {
  sdk: SailPointPluginSDK
  context: PluginContext
  user: CurrentUser
  certificationsApi: CertificationsApi
  summariesApi: CertificationSummariesApi
  /** Used by the reassign flow to search identities by name/email. */
  searchApi: SearchApi
}

/** Options for {@link initPlugin}, mainly to support testing. */
export interface InitPluginOptions {
  /** Inject a pre-built SDK (e.g. pointed at the testing mock App Shell). */
  sdk?: SailPointPluginSDK
  /**
   * Inject the api-client configuration. Tests pass a ready Configuration so
   * they don't depend on `window.sailpointConfig()` being present; production
   * omits it and we call `Configuration.autoconfigure()`.
   */
  configuration?: Configuration
}

/**
 * The App Shell handshake must win a race: the shell sends its READY reply
 * shortly after the iframe loads, and the SDK's default request timeout is only
 * 2s (DEFAULT_REQUEST_TIMEOUT_MS). If we wait until React mounts to create the
 * SDK — after the heavy recharts + api-client chunks parse — we can send
 * SP_PLUGIN_READY_REQ too late or be too busy to process the reply in time, and
 * the handshake times out. So we create the SDK and start the handshake at
 * module load, before any UI work, and give it a generous timeout. This mirrors
 * the pattern the working org-graph plugin uses.
 */
const HANDSHAKE_TIMEOUT_MS = 15_000

/**
 * A module-load singleton SDK whose handshake is already in flight. Created
 * lazily (and only in a browser) so the test environment, which injects its own
 * SDK, never triggers this eager path.
 */
let eagerSdk: SailPointPluginSDK | null = null

function getEagerSdk(): SailPointPluginSDK {
  if (!eagerSdk) {
    eagerSdk = createSDK({ requestTimeoutMs: HANDSHAKE_TIMEOUT_MS })
  }
  return eagerSdk
}

// Kick the handshake off as early as possible when running inside a browser
// iframe. getContext() attaches the message listener and sends READY straight
// away; initPlugin() later awaits this same in-flight promise.
let eagerContext: Promise<PluginContext> | null = null
if (typeof window !== 'undefined' && window.parent !== window) {
  eagerContext = getEagerSdk().getContext()
  // Avoid an unhandled rejection if nothing has awaited it yet; initPlugin()
  // re-reads the same promise and surfaces the error there.
  void eagerContext.catch(() => undefined)
}

/** Maps the raw plugin context into the trimmed {@link CurrentUser}. */
function toCurrentUser(context: PluginContext): CurrentUser {
  const { user } = context
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    // Managers reviewing their own campaign are not cert admins; this flag only
    // unlocks admin-only niceties later, never gates a reviewer's own work.
    isCertAdmin: user.capabilities.isCertAdmin,
  }
}

/**
 * Connects to ISC and returns a ready-to-use runtime. Throws if the handshake
 * or configuration fails; callers render an error state in that case.
 */
export async function initPlugin(
  options: InitPluginOptions = {},
): Promise<PluginRuntime> {
  // In production, reuse the module-load SDK whose handshake is already in
  // flight (see HANDSHAKE_TIMEOUT_MS above). Tests inject their own SDK.
  const sdk = options.sdk ?? getEagerSdk()

  // Resolve the signed-in user + tenant. This also completes the handshake that
  // registers window.sailpointConfig(), which autoconfigure() depends on. When
  // the eager handshake is already running we await that same promise rather
  // than starting a second one; getContext() is idempotent regardless.
  const context =
    options.sdk === undefined && eagerContext !== null
      ? await eagerContext
      : await sdk.getContext()

  // Autoconfigure wires the api-client to window.sailpointConfig() and waits
  // for it to resolve, so base URLs are set before any API class is built.
  const configuration =
    options.configuration ?? (await Configuration.autoconfigure())

  const certificationsApi = new CertificationsApi(configuration)
  const summariesApi = new CertificationSummariesApi(configuration)
  const searchApi = new SearchApi(configuration)

  return {
    sdk,
    context,
    user: toCurrentUser(context),
    certificationsApi,
    summariesApi,
    searchApi,
  }
}
