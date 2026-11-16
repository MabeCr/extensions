// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// spotterbot.ham2k.net as this extension speaks to it: the login it is the
// issuer for, the spot it takes, and the per-server answer it gives. Its
// README is the contract.

import type { JSONValue, PostSelfSpotRequest } from "@ham2k/extension-sdk"

export const SPOTTERBOT = 'https://spotterbot.ham2k.net'

/// Spotterbot's one client, and the redirects it serves: each edition's custom
/// scheme, and LoFi's relay for Web, Linux and Windows. Spotterbot refuses any
/// other redirect, so a change here is a change there too.
export const CLIENT_ID = 'halo'
export const WEBHOOK_REDIRECT_URL = 'https://lofi.ham2k.net/v1/webhooks/client/oauth'

export function oauth2Config(edition: string | undefined) {
  const scheme = edition === 'prod' || edition === 'next' ? edition : 'dev'
  return {
    issuer: SPOTTERBOT,
    clientId: CLIENT_ID,
    redirectUrl: `com.ham2k.logger.${scheme}.auth://spotterbot`,
    webhookRedirectUrl: WEBHOOK_REDIRECT_URL,
    scopes: ['spots'],
  }
}

export interface SpotBody {
  call: string
  freq: number
  mode?: string
  comment?: string
  refs: string[]
  app?: string
}

/// A ref's label as the SDK's `refLabels` filter picks it: `shortLabel`, else
/// `label`, else the bare `ref`. An unknown park still appears, as its ref.
function refLabel(ref: unknown): string | undefined {
  const r = (ref ?? {}) as Record<string, unknown>
  return [r.shortLabel, r.label, r.ref]
    .map((text) => (typeof text === 'string' || typeof text === 'number' ? String(text).trim() : ''))
    .find((text) => text !== '')
}

/// The call a self-spot names: the operation's first call, less the `/OP<n>`
/// the app appends for this device's seat in a multi-station operation, which
/// nobody can work. As `ham2k-cluster-spots`' `selfSpotCall` has it.
export function selfSpotCall(operation: Record<string, JSONValue>): string {
  const call = String(operation.stationCall ?? '').split(',')[0].trim().toUpperCase()
  const local = (operation.local ?? {}) as Record<string, JSONValue>
  const seat = `/OP${Number.parseInt(String(local.multiIdentifier ?? ''), 10)}`
  return call.endsWith(seat) ? call.slice(0, -seat.length) : call
}

/// The spot as Spotterbot takes it.
export function spotBody(request: PostSelfSpotRequest, appName?: string): SpotBody {
  const operation = request.operation
  const refs = Array.isArray(operation.refs) ? (operation.refs as JSONValue[]) : []
  return {
    call: selfSpotCall(operation),
    freq: request.freq,
    ...(request.mode ? { mode: request.mode } : {}),
    ...(request.comment ? { comment: request.comment } : {}),
    refs: refs.flatMap((ref) => refLabel(ref) ?? []),
    ...(appName ? { app: appName } : {}),
  }
}

export type ServerResult =
  | { id: string; name: string; status: 'sent' | 'skipped' }
  | { id: string; name: string; status: 'failed'; error: string }

export interface Server {
  id: string
  name: string
  /// The operator's switch for this server, which Spotterbot stores so the
  /// website and every install of the app share it.
  on: boolean
}

export interface SpotsAnswer {
  results: ServerResult[]
  /// Servers whose roles Discord didn't return: unknown, so not named.
  unchecked: number
  /// Servers left out because the operator switched them off.
  switchedOff: number
}
