import type { DesktopAuthProvider, DesktopConnectionConfig } from '@/global'

// Pure helpers for the boot-failure overlay's remote-reauth branch. Kept out
// of the .tsx so they can be unit-tested without a React/jsdom render (the
// jsx-dev-runtime resolution in this repo's vitest setup is flaky for
// component renders, but these are plain functions).

export interface RemoteReauth {
  url: string
  isPassword: false
  providerLabel: string
}

interface SignInCopy {
  identityProvider: string
  withProvider: (provider: string) => string
}

const DEFAULT_SIGN_IN_COPY: SignInCopy = {
  identityProvider: 'your identity provider',
  withProvider: provider => `Sign in with ${provider}`
}

// A remote, gated (oauth-bucket), not-currently-connected gateway is a
// remote-reauth boot failure: the access cookie lapsed (e.g. the remote
// dashboard restarted) and the local-recovery buttons (Retry/Repair) can't
// fix it. Only re-establishing the remote session can. A connected oauth
// session, or a token/local gateway, boots for some other reason the
// local-recovery buttons address, so those return false here.
export function isRemoteReauthFailure(config: DesktopConnectionConfig | null | undefined): boolean {
  if (!config) {
    return false
  }

  return (
    config.mode === 'remote' &&
    config.remoteAuthMode === 'oauth' &&
    !config.remoteOauthConnected &&
    Boolean(config.remoteUrl)
  )
}

// Derive the display label from the probed providers. Legacy password-provider
// flags are ignored because Herbound uses the FastAPI/JWT login flow.
export function deriveProviderShape(providers: DesktopAuthProvider[] | null | undefined): {
  isPassword: false
  providerLabel: string
} {
  const list = providers ?? []

  if (list.length === 0) {
    return { isPassword: false, providerLabel: 'your identity provider' }
  }

  const providerLabel =
    list.length === 1
      ? list[0].displayName || list[0].name
      : list.map(p => p.displayName || p.name).join(' / ')

  return { isPassword: false, providerLabel }
}

// Button copy for the remote sign-in action.
export function signInLabel(reauth: RemoteReauth | null, copy: SignInCopy = DEFAULT_SIGN_IN_COPY): string {
  const provider = reauth?.providerLabel === DEFAULT_SIGN_IN_COPY.identityProvider ? copy.identityProvider : reauth?.providerLabel

  return copy.withProvider(provider ?? copy.identityProvider)
}
