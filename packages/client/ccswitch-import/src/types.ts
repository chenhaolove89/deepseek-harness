/** Wire vocabulary for the CCSwitch import Remote and its settings UI. */

/** One CCSWITCH provider row summarized for the import picker. */
export interface CcswitchProviderItem {
  readonly id: string
  readonly appType: string
  readonly name: string
  readonly baseURL: string
  readonly modelCount: number
  readonly hasKey: boolean
  readonly usable: boolean
  readonly imported: boolean
}

/** Result of listing CCSWITCH providers. */
export interface CcswitchListResult {
  readonly ok: boolean
  readonly dbPath: string
  readonly providers: readonly CcswitchProviderItem[]
  readonly error?: string
}

/** One provider's import outcome. */
export interface CcswitchImportRow {
  readonly id: string
  readonly name: string
  readonly status: 'ok' | 'error'
  readonly route?: string
  readonly updated?: boolean
  readonly message?: string
}

/** Result of a batch import request. */
export interface CcswitchImportResult {
  readonly ok: boolean
  readonly results: readonly CcswitchImportRow[]
  readonly error?: string
}

/** Batch import request: CCSWITCH provider ids to import. */
export interface CcswitchImportRequest {
  readonly ids: readonly string[]
}
