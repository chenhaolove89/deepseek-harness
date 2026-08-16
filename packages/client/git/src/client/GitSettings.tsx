/**
 * Git 管理 settings page: edit the dsh-git configuration (commitModel route
 * and the reserved auto-refresh interval) through the Host Remote gateway.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GitActionResult, GitConfigPatch, GitConfigResult } from '@deepseek-ai/dsh-git/types'
import css from './GitSettings.module.css'

/** Registration-side Remote face used by the settings section. */
export interface GitSettingsInjected {
  /** Read the active plugin config. */
  getConfig: () => Promise<GitConfigResult>
  /** Persist the plugin config. */
  setConfig: (config: GitConfigPatch) => Promise<GitActionResult>
}

/** Full component props assembled by the Settings slot renderer. */
export type GitSettingsProps = PropsRuntime<'settings.section'> & InjectFace<GitSettingsInjected>

/** The dsh-git configuration page. */
export function GitSettings(props: GitSettingsProps): ReactNode {
  const { getConfig, setConfig } = props
  const [provider, setProvider] = useState('tokenrhythm')
  const [model, setModel] = useState('qwen3.8-max')
  const [autoRefreshMs, setAutoRefreshMs] = useState(5000)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async (): Promise<void> => {
    setError('')
    try {
      const res = await getConfig()
      if (res.ok) {
        setProvider(res.config.commitModel.provider)
        setModel(res.config.commitModel.model)
        setAutoRefreshMs(res.config.autoRefreshMs)
      } else {
        setError(res.error)
      }
    } catch (err) {
      setError(String((err instanceof Error && err.message) || err))
    }
  }

  useEffect(() => {
    void load()
    // 仅挂载时读取一次；「重新读取」按钮手动刷新。
  }, [])

  const save = async (): Promise<void> => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await setConfig({
        commitModel: { provider: provider.trim(), model: model.trim() },
        autoRefreshMs,
      })
      if (res.ok) setMessage(res.message)
      else setError(res.error)
    } catch (err) {
      setError(String((err instanceof Error && err.message) || err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={css.section}>
      <h2 className={css.title}>Git 管理</h2>
      <p className={css.desc}>
        配置 dsh-git 插件的默认行为。保存后立即对新的 git 工具调用与面板生效（进程内常驻，无需重启）。
      </p>

      <div className={css.field}>
        <label className={css.label} htmlFor="git-commit-provider">提交信息模型（provider）</label>
        <input
          id="git-commit-provider"
          className={css.input}
          value={provider}
          onChange={(ev) => { setProvider(ev.target.value) }}
          placeholder="如 tokenrhythm"
        />
      </div>

      <div className={css.field}>
        <label className={css.label} htmlFor="git-commit-model">提交信息模型（model）</label>
        <input
          id="git-commit-model"
          className={css.input}
          value={model}
          onChange={(ev) => { setModel(ev.target.value) }}
          placeholder="如 qwen3.8-max"
        />
      </div>

      <div className={css.field}>
        <label className={css.label} htmlFor="git-auto-refresh">面板自动刷新间隔（ms，保留字段）</label>
        <input
          id="git-auto-refresh"
          className={css.input}
          type="number"
          min={1000}
          step={1000}
          value={autoRefreshMs}
          onChange={(ev) => { setAutoRefreshMs(Number(ev.target.value) || 5000) }}
        />
      </div>

      <div className={css.row}>
        <button type="button" className={css.btn + ' ' + css.primary} disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : '保存配置'}
        </button>
        <button type="button" className={css.btn} disabled={saving} onClick={() => void load()}>重新读取</button>
      </div>

      {message ? <p className={css.ok}>{message}</p> : null}
      {error ? <p className={css.err}>{error}</p> : null}
    </div>
  )
}
