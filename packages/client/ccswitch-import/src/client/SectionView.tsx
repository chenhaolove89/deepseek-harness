import { useState, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  CcswitchImportRequest,
  CcswitchImportResult,
  CcswitchListResult,
  CcswitchProviderItem,
} from '@deepseek-ai/dsh-ccswitch-import/types'
import css from './SectionView.module.css'

/** Registration-side Remote face used by the section. */
export interface SectionViewInjected {
  /** List CCSWITCH providers with importability summaries. */
  list: () => Promise<CcswitchListResult>
  /** Batch-import the selected provider ids. */
  import: (request: CcswitchImportRequest) => Promise<CcswitchImportResult>
}

/** Full component props assembled by the Settings slot renderer. */
export type SectionViewProps = PropsRuntime<'settings.section'> & InjectFace<SectionViewInjected>

type Phase = 'idle' | 'loading' | 'ready' | 'importing' | 'done' | 'error'

function Row(props: { p: CcswitchProviderItem; checked: boolean; onToggle: (id: string) => void }): ReactNode {
  const { p } = props
  const disabled = !p.usable
  return (
    <label className={css.row + (disabled ? ' ' + css.rowDisabled : '')}
      style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <input
        type="checkbox"
        checked={!!(props.checked && !disabled)}
        disabled={disabled}
        onChange={() => props.onToggle(p.id)}
      />
      <div style={{ flex: 1 }}>
        <div>
          <span className={css.rname}>{p.name}</span>
          <span className={css.badge}>{p.appType}</span>
          {p.imported ? <span className={css.badge + ' ' + css.tagImported}>已导入</span> : null}
          {!p.hasKey ? <span className={css.badge + ' ' + css.tagNokey}>无密钥</span> : null}
        </div>
        <div className={css.rsub}>
          {(p.baseURL || '(无地址)') + ' · ' + p.modelCount + ' 个模型' + (p.imported ? ' · 再次导入将更新已有配置' : '')}
        </div>
      </div>
    </label>
  )
}

/** The CCSwitch import settings page. */
export function SectionView(props: SectionViewProps): ReactNode {
  const { list, import: doImportRemote } = props
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [providers, setProviders] = useState<readonly CcswitchProviderItem[]>([])
  const [selected, setSelected] = useState<Readonly<Record<string, boolean>>>({})
  const [result, setResult] = useState<readonly { id: string; name: string; status: string; route?: string; message?: string }[]>([])
  const [error, setError] = useState('')
  const [dbPath, setDbPath] = useState('')

  const openModal = async () => {
    setOpen(true)
    setPhase('loading')
    setError('')
    setResult([])
    setSelected({})
    try {
      const res = await list()
      if (res.ok) {
        setProviders(res.providers)
        setDbPath(res.dbPath)
        setPhase('ready')
      } else {
        setError(res.error ?? '读取失败')
        setPhase('error')
      }
    } catch (err) {
      setError(String((err instanceof Error && err.message) || err))
      setPhase('error')
    }
  }

  const closeModal = () => setOpen(false)

  const toggle = (id: string) => {
    setSelected(prev => {
      const next: Record<string, boolean> = {}
      for (const k of Object.keys(prev)) {
        const v = prev[k]
        if (v !== undefined) next[k] = v
      }
      if (next[id]) delete next[id]
      else next[id] = true
      return next
    })
  }

  const usable = providers.filter(p => p.usable)
  const count = usable.filter(p => selected[p.id]).length
  const allOn = usable.length > 0 && usable.every(p => selected[p.id])

  const toggleAll = () => {
    setSelected(() => {
      const next: Record<string, boolean> = {}
      if (!allOn) for (const p of usable) next[p.id] = true
      return next
    })
  }

  const doImport = async () => {
    const ids = usable.filter(p => selected[p.id]).map(p => p.id)
    if (!ids.length) return
    setPhase('importing')
    setError('')
    try {
      const res = await doImportRemote({ ids })
      setResult(res.results)
      setPhase('done')
    } catch (err) {
      setError('导入失败: ' + String((err instanceof Error && err.message) || err))
      setPhase('ready')
    }
  }

  const backToReady = async () => {
    setResult([])
    setPhase('loading')
    try {
      const res = await list()
      if (res.ok) {
        setProviders(res.providers)
        setDbPath(res.dbPath)
        setSelected({})
        setPhase('ready')
      } else {
        setError(res.error ?? '读取失败')
        setPhase('error')
      }
    } catch {
      setPhase('ready')
    }
  }

  const okCount = result.filter(r => r.status === 'ok').length
  const failCount = result.length - okCount

  let body: ReactNode
  if (phase === 'loading') {
    body = <div className={css.empty}>正在读取 CCSWITCH 供应商…</div>
  } else if (phase === 'error') {
    body = <div className={css.err}>{error}</div>
  } else if (phase === 'done' && result.length > 0) {
    body = (
      <div>
        <div className={css.result}>
          {result.map(r => (
            <div className={css.resrow} key={r.id}>
              <span className={r.status === 'ok' ? css.ok : css.fail}>
                {r.status === 'ok' ? '已导入' : '失败'}
              </span>
              <span>{r.name + (r.route ? ' → ' + r.route : '')}</span>
              {r.message ? <span className={css.fail}>{r.message}</span> : null}
            </div>
          ))}
        </div>
        <p className={css.hint}>
          {'共 ' + result.length + ' 项：成功 ' + okCount + ' 项' + (failCount ? '，失败 ' + failCount + ' 项' : '')
            + '。供应商已写入设置（llm-pi-ai），可立即在模型选择器中使用。'}
        </p>
      </div>
    )
  } else {
    body = (
      <div>
        <div className={css.toolbar}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={allOn} onChange={toggleAll} />
            全选（仅可选条目）
          </label>
          <span>{'已选 ' + count + ' / ' + usable.length + ' 项'}</span>
        </div>
        {providers.length === 0 ? <div className={css.empty}>未从 CCSWITCH 读取到供应商</div> : null}
        {providers.map(p => <Row key={p.id} p={p} checked={!!selected[p.id]} onToggle={toggle} />)}
        <p className={css.hint}>
          {'数据来源: ' + (dbPath || '(未知)') + '。只有包含地址、密钥且至少一个模型的供应商可以导入。'}
        </p>
      </div>
    )
  }

  const modal = open ? (
    <div className={css.overlay} onClick={ev => { if (ev.target === ev.currentTarget) closeModal() }}>
      <div className={css.modal} onClick={ev => ev.stopPropagation()}>
        <div className={css.mhead}>
          <h3 className={css.mtitle}>从 CCSWITCH 导入供应商</h3>
          <button className={css.x} onClick={closeModal} aria-label="关闭">✕</button>
        </div>
        <div className={css.mbody}>{body}</div>
        {phase === 'ready' || phase === 'importing' ? (
          <div className={css.mfoot}>
            <button className={css.btn} onClick={closeModal} disabled={phase === 'importing'}>取消</button>
            <button className={css.btn + ' ' + css.primary} onClick={doImport} disabled={count === 0 || phase === 'importing'}>
              {phase === 'importing' ? '导入中…' : '一键导入 (' + count + ')'}
            </button>
          </div>
        ) : null}
        {phase === 'done' ? (
          <div className={css.mfoot}>
            <button className={css.btn} onClick={backToReady}>继续选择</button>
            <button className={css.btn + ' ' + css.primary} onClick={closeModal}>完成</button>
          </div>
        ) : null}
      </div>
    </div>
  ) : null

  return (
    <div className={css.section}>
      <h2 className={css.title}>CCSwitch 导入</h2>
      <p className={css.desc}>
        从 CCSWITCH（~/.cc-switch）读取已保存的模型供应商（地址、密钥、模型），批量导入为 DeepSeek Harness 的模型供应商。
        导入后可在「模型」设置页查看，并在模型选择器中直接使用。
      </p>
      <div>
        <button className={css.btn + ' ' + css.primary} onClick={openModal}>从 CCSWITCH 导入</button>
      </div>
      {modal}
    </div>
  )
}
