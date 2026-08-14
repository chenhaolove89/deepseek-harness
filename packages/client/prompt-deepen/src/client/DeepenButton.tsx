import { useState, type ReactNode } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { PromptDeepenRequest, PromptDeepenResult } from '@deepseek-ai/dsh-prompt-deepen/types'
import css from './DeepenButton.module.css'

/** Registration-side Remote face used by the button. */
export interface DeepenButtonInjected {
  /** Deepen the given draft prompt with the currently selected model. */
  deepen: (request: PromptDeepenRequest) => Promise<PromptDeepenResult>
}

/**
 * Full component props assembled by the composer slot renderer. The owner
 * share is the InputZone snapshot (session/input) and the session standard
 * kit carries the draft mirror actions; both are declared by ui-conversation's
 * slot contract.
 */
export type DeepenButtonProps = InjectFace<DeepenButtonInjected> & {
  /** Input-zone owner share: point-in-time snapshots, re-rendered by the dispatcher. */
  readonly owner?: { readonly input: { readonly draft: string } }
  /** Draft mirror actions from the session standard kit (absent pre-session). */
  readonly inputActions?: { readonly setDraft: (text: string) => void }
}

type Notice = { kind: 'ok'; text: string } | { kind: 'error'; text: string }

const ICON_PATHS = ['M12 3 L14.4 9.6 L21 12 L14.4 14.4 L12 21 L9.6 14.4 L3 12 L9.6 9.6 Z']
const SPARK_PATHS = ['M18.5 3.5 L19.2 5.8 L21.5 6.5 L19.2 7.2 L18.5 9.5 L17.8 7.2 L15.5 6.5 L17.8 5.8 Z']
const CHECK_PATHS = ['M5 13 L10 18 L19 6']

function Svg(props: { size: number; strokeWidth: number; paths: readonly string[] }): ReactNode {
  return (
    <svg
      width={props.size}
      height={props.size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={props.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {props.paths.map(d => <path key={d} d={d} />)}
    </svg>
  )
}

/** The Deepen button at the right end of the composer tool row. */
export function DeepenButton(props: DeepenButtonProps): ReactNode {
  const { deepen } = props
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const draft = props.owner?.input?.draft ?? ''
  const inputActions = props.inputActions

  const onClick = async () => {
    const text = String(draft).trim()
    if (!text) {
      setNotice({ kind: 'error', text: '请先输入提示词' })
      return
    }
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await deepen({ text })
      if (res.ok && typeof res.text === 'string' && res.text) {
        inputActions?.setDraft(res.text)
        setNotice({ kind: 'ok', text: '提示词已深化，请检查后发送' })
      } else {
        setNotice({ kind: 'error', text: res.error ?? '深化失败，请重试' })
      }
    } catch (error) {
      setNotice({ kind: 'error', text: (error instanceof Error && error.message) ? error.message : '调用模型失败' })
    } finally {
      setBusy(false)
    }
  }

  let content: ReactNode = <Svg size={14} strokeWidth={1.8} paths={[...ICON_PATHS, ...SPARK_PATHS]} />
  let color: string | undefined
  if (notice?.kind === 'ok') {
    content = <Svg size={14} strokeWidth={2.4} paths={CHECK_PATHS} />
    color = 'var(--dsw-alias-state-success-primary)'
  } else if (notice?.kind === 'error') {
    color = 'var(--dsw-alias-state-error-primary)'
  }

  return (
    <button
      type="button"
      className={css.button + (busy ? ' ' + css.spin : '')}
      title={busy ? '正在深化提示词…' : (notice?.kind === 'error' ? notice.text : '深化并优化提示词')}
      aria-label="深化并优化提示词"
      disabled={busy}
      onClick={onClick}
      style={color ? { color } : undefined}
    >
      {content}
    </button>
  )
}
