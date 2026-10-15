import { createSDK } from '@sailpoint/ui-plugin-sdk'
import type { UserCapabilities } from '@sailpoint/ui-plugin-sdk'
import { mockSdkContext } from '@sailpoint/ui-plugin-sdk/testing'
import { Configuration } from 'sailpoint-api-client'
import { afterEach, describe, expect, it } from 'vitest'
import { initPlugin } from './sdkClient'

// App Shell always sends every capability flag; start all-false and flip what a
// test needs (mirrors the SDK README guidance).
const allCapabilitiesFalse: UserCapabilities = {
  isOrgAdmin: false,
  isHelpdesk: false,
  isDashboard: false,
  isCertAdmin: false,
  isReportAdmin: false,
  isSourceAdmin: false,
  isSourceSubadmin: false,
  isRoleAdmin: false,
  isRoleSubadmin: false,
  isCloudGovAdmin: false,
  isCloudGovUser: false,
  isSaasManagementAdmin: false,
  isSaasManagementReader: false,
}

const handles: Array<{ restore: () => void }> = []

afterEach(() => {
  while (handles.length) handles.pop()?.restore()
})

describe('initPlugin', () => {
  it('resolves the signed-in user from the App Shell handshake', async () => {
    const appShell = mockSdkContext({
      context: {
        tenant: {
          id: 'tenant-1',
          scriptName: 'acme',
          org: 'acme',
          name: 'Acme',
          pod: 'useast1',
          region: 'us-east-1',
          apiUrl: { idn: 'https://acme.api.identitynow.com' },
          products: [],
        },
        user: {
          id: 'user-1',
          displayName: 'Dana Reviewer',
          email: 'dana@example.com',
          capabilities: { ...allCapabilitiesFalse, isCertAdmin: true },
        },
        page: {
          route: 'https://acme.identitynow.com/ui/plugin/visual-certs/',
        },
        slot: {},
        pluginConfiguration: { pluginId: 'plugin-1' },
      },
    })
    handles.push(appShell)

    const sdk = createSDK({ targetOrigin: appShell.targetOrigin })
    // Inject a configuration so the test does not depend on
    // window.sailpointConfig(); we only assert the context/user mapping here.
    const configuration = new Configuration({
      baseurl: 'https://acme.api.identitynow.com',
      accessToken: 'test-token',
    })

    const runtime = await initPlugin({ sdk, configuration })

    expect(runtime.user).toEqual({
      id: 'user-1',
      displayName: 'Dana Reviewer',
      email: 'dana@example.com',
      isCertAdmin: true,
    })
    expect(runtime.certificationsApi).toBeDefined()
    expect(runtime.summariesApi).toBeDefined()
    expect(runtime.searchApi).toBeDefined()
  })

  it('rejects when the handshake origin cannot be trusted', async () => {
    // No mock App Shell installed and an unreachable origin: getContext() never
    // completes the handshake, so initPlugin rejects and the UI shows an error.
    const sdk = createSDK({
      targetOrigin: 'https://not-the-host.example.com',
      requestTimeoutMs: 50,
    })
    const configuration = new Configuration({
      baseurl: 'https://acme.api.identitynow.com',
      accessToken: 'test-token',
    })

    await expect(initPlugin({ sdk, configuration })).rejects.toBeTruthy()
  })
})
