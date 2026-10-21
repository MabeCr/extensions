// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
//
// Extension API 12, as `@ham2k/extension-sdk`'s source holds it and the published SDK does not
// yet: copies of its types and of `host.suggestQso`. Delete each the day the SDK publishes it.
import type { BoardSpot, PanelScene, PanelSceneControl, PanelSceneLayer, SpotRef } from '@ham2k/extension-sdk'

/** Copy of the SDK's `SuggestedQso` (src/types.ts). */
export interface SuggestedQso {
  their: { call: string }
  /** kHz, as QSON keeps it. */
  freq?: number
  band?: string
  mode?: string
  refs?: SpotRef[]
}

/** `BoardSpot` with its API 12 `display` (src/types.ts). */
export type DisplayedSpot = BoardSpot & { display?: { icon: string; iconColor?: string; emoji?: string } }

/** `PanelSceneLayer` with its API 12 `icon`, `fixed` and `stretch` (src/panelScene.ts). */
export type SceneLayer = PanelSceneLayer & { icon?: { name: string; color?: string }; fixed?: boolean; stretch?: boolean }

/** `PanelSceneControl` with the API 12 `zoom` kind, `hoverSet` and `fixed` (src/panelScene.ts). */
export type SceneControl = Omit<PanelSceneControl, 'kind'> & { kind: PanelSceneControl['kind'] | 'zoom'; hoverSet?: { value: string; to: number }; fixed?: boolean }

/** `PanelScene` with its API 12 `scroll` (src/panelScene.ts). */
export type Scene = Omit<PanelScene, 'layers' | 'controls'> & {
  layers: SceneLayer[]
  controls?: SceneControl[]
  scroll?: { axis?: 'x' | 'y'; value: string; event?: string }
}

/** Copy of `host.suggestQso` (src/index.ts), through the activation's own `hostCall`. */
export const suggestQsoThrough =
  (hostCall: (method: string, params: Record<string, unknown>) => Promise<unknown>) =>
  async (args: { qso: SuggestedQso; operationUuid?: string }): Promise<{ accepted: boolean }> =>
    (await hostCall('suggestQso', { ...args })) as { accepted: boolean }
