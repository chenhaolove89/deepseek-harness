return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    styles.insert(`.ccs-section{display:flex;flex-direction:column;gap:14px;padding:6px 2px;max-width:760px}
.ccs-title{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2329);margin:0}
.ccs-desc{font-size:13px;color:var(--dsw-alias-label-secondary,#646a73);line-height:1.7;margin:0}
.ccs-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2,#d0d3d9);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);border-radius:8px;padding:8px 16px;font-size:13px;cursor:pointer}
.ccs-btn:hover{border-color:var(--dsw-alias-brand-primary,#3370ff);color:var(--dsw-alias-brand-primary,#3370ff)}
.ccs-btn.primary{background:var(--dsw-alias-button-primary-fill,#3370ff);border-color:var(--dsw-alias-button-primary-fill,#3370ff);color:var(--dsw-alias-label-primary-foreground,#fff)}
.ccs-btn.primary:hover{background:var(--dsw-alias-button-primary-hover,#2b5fd9);border-color:var(--dsw-alias-button-primary-hover,#2b5fd9);color:var(--dsw-alias-label-primary-foreground,#fff)}
.ccs-btn:disabled{opacity:.5;cursor:not-allowed}
.ccs-overlay{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
.ccs-modal{width:680px;max-width:calc(100vw - 48px);max-height:min(680px,calc(100vh - 96px));background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,#d0d3d9);border-radius:10px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.18)}
.ccs-mhead{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e6eb)}
.ccs-mtitle{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2329);margin:0}
.ccs-x{border:none;background:none;font-size:18px;cursor:pointer;color:var(--dsw-alias-label-secondary,#646a73);line-height:1}
.ccs-x:hover{color:var(--dsw-alias-label-primary,#1f2329)}
.ccs-mbody{flex:1;overflow:auto;padding:12px 18px}
.ccs-row{display:flex;align-items:flex-start;gap:10px;padding:10px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e6eb)}
.ccs-row.disabled{opacity:.55}
.ccs-row input{flex:none;margin-top:3px}
.ccs-rname{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2329)}
.ccs-rsub{font-size:12px;color:var(--dsw-alias-label-secondary,#646a73);margin-top:2px;word-break:break-all}
.ccs-badge{display:inline-block;font-size:11px;padding:1px 7px;border-radius:9px;margin-left:8px;border:1px solid var(--dsw-alias-border-l2,#d0d3d9);color:var(--dsw-alias-label-secondary,#646a73);vertical-align:middle}
.ccs-tag-imported{color:var(--dsw-alias-state-success-primary,#00b42a)}
.ccs-tag-nokey{color:var(--dsw-alias-state-warn-primary,#ff7d00)}
.ccs-toolbar{display:flex;align-items:center;gap:12px;padding:10px 8px;font-size:13px;color:var(--dsw-alias-label-secondary,#646a73)}
.ccs-empty{padding:24px 0;text-align:center;color:var(--dsw-alias-label-secondary,#646a73);font-size:13px}
.ccs-err{color:var(--dsw-alias-state-error-primary,#f53f3f);font-size:13px;line-height:1.6;padding:10px 8px}
.ccs-result{display:flex;flex-direction:column;gap:8px;padding:6px 0}
.ccs-resrow{display:flex;gap:8px;align-items:baseline;font-size:13px;color:var(--dsw-alias-label-primary,#1f2329)}
.ccs-ok{color:var(--dsw-alias-state-success-primary,#00b42a)}
.ccs-fail{color:var(--dsw-alias-state-error-primary,#f53f3f)}
.ccs-mfoot{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:12px 18px;border-top:1px solid var(--dsw-alias-border-l1,#e5e6eb)}
.ccs-hint{font-size:12px;color:var(--dsw-alias-label-secondary,#646a73);margin:0 0 4px}
`)

    const e = React.createElement

    function Row(props) {
      const p = props.p
      const checked = !!props.checked
      const disabled = props.disabled || !p.usable
      return e('label', { className: 'ccs-row' + (disabled ? ' disabled' : ''), style: { cursor: disabled ? 'not-allowed' : 'pointer' } },
        e('input', { type: 'checkbox', checked: checked && !disabled, disabled: disabled, onChange: function () { props.onToggle(p.id) } }),
        e('div', { style: { flex: 1 } },
          e('div', null,
            e('span', { className: 'ccs-rname' }, p.name),
            e('span', { className: 'ccs-badge' }, p.appType),
            p.imported ? e('span', { className: 'ccs-badge ccs-tag-imported' }, '已导入') : null,
            !p.hasKey ? e('span', { className: 'ccs-badge ccs-tag-nokey' }, '无密钥') : null,
          ),
          e('div', { className: 'ccs-rsub' }, (p.baseURL || '(无地址)') + ' · ' + p.modelCount + ' 个模型' + (p.imported ? ' · 再次导入将更新已有配置' : '')),
        ),
      )
    }

    function SectionView(props) {
      const [open, setOpen] = React.useState(false)
      const [phase, setPhase] = React.useState('idle')
      const [providers, setProviders] = React.useState([])
      const [selected, setSelected] = React.useState({})
      const [result, setResult] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [dbPath, setDbPath] = React.useState('')

      const openModal = function () {
        setOpen(true)
        setPhase('loading')
        setError(null)
        setResult(null)
        setSelected({})
        host.call('ccswitch.list', {}).then(function (res) {
          if (res && res.ok) {
            setProviders(res.providers || [])
            setDbPath(res.dbPath || '')
            setPhase('ready')
          } else {
            setError('读取失败: ' + JSON.stringify(res))
            setPhase('error')
          }
        }).catch(function (err) {
          setError('读取失败: ' + String((err && err.message) || err))
          setPhase('error')
        })
      }

      const closeModal = function () { setOpen(false) }

      const toggle = function (id) {
        setSelected(function (prev) {
          const next = {}
          for (const k of Object.keys(prev)) next[k] = prev[k]
          if (next[id]) delete next[id]
          else next[id] = true
          return next
        })
      }

      const toggleAll = function () {
        const usable = providers.filter(function (p) { return p.usable })
        const allOn = usable.length > 0 && usable.every(function (p) { return selected[p.id] })
        setSelected(function () {
          const next = {}
          if (!allOn) for (const p of usable) next[p.id] = true
          return next
        })
      }

      const count = providers.filter(function (p) { return selected[p.id] }).length
      const usable = providers.filter(function (p) { return p.usable })
      const allOn = usable.length > 0 && usable.every(function (p) { return selected[p.id] })

      const doImport = function () {
        const ids = providers.filter(function (p) { return selected[p.id] }).map(function (p) { return p.id })
        if (!ids.length) return
        setPhase('importing')
        setError(null)
        host.call('ccswitch.import', { ids: ids }).then(function (res) {
          setResult((res && res.results) || [])
          setPhase('done')
        }).catch(function (err) {
          setError('导入失败: ' + String((err && err.message) || err))
          setPhase('ready')
        })
      }

      const backToReady = function () {
        setResult(null)
        setPhase('ready')
        host.call('ccswitch.list', {}).then(function (res) {
          if (res && res.ok) { setProviders(res.providers || []); setDbPath(res.dbPath || ''); setSelected({}) }
        }).catch(function () {})
      }

      const okCount = (result || []).filter(function (r) { return r.status === 'ok' }).length
      const failCount = (result || []).length - okCount

      let body = null
      if (phase === 'loading') {
        body = e('div', { className: 'ccs-empty' }, '正在读取 CCSWITCH 供应商…')
      } else if (phase === 'error') {
        body = e('div', { className: 'ccs-err' }, error)
      } else if (phase === 'done' && result) {
        body = e('div', null,
          e('div', { className: 'ccs-result' },
            result.map(function (r) {
              return e('div', { className: 'ccs-resrow', key: r.id },
                e('span', { className: r.status === 'ok' ? 'ccs-ok' : 'ccs-fail' }, r.status === 'ok' ? (r.updated ? '已更新' : '已导入') : '失败'),
                e('span', null, r.name + (r.route ? ' → ' + r.route : '')),
                r.message ? e('span', { className: 'ccs-fail' }, r.message) : null,
              )
            }),
          ),
          e('p', { className: 'ccs-hint' }, '共 ' + result.length + ' 项：成功 ' + okCount + ' 项' + (failCount ? '，失败 ' + failCount + ' 项' : '') + '。供应商已写入设置（llm-pi-ai），可立即在模型选择器中使用。')
        )
      } else {
        body = e('div', null,
          e('div', { className: 'ccs-toolbar' },
            e('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
              e('input', { type: 'checkbox', checked: allOn, onChange: toggleAll }),
              '全选（仅可选条目）',
            ),
            e('span', null, '已选 ' + count + ' / ' + usable.length + ' 项'),
          ),
          providers.length === 0 ? e('div', { className: 'ccs-empty' }, '未从 CCSWITCH 读取到供应商') : null,
          providers.map(function (p) { return e(Row, { key: p.id, p: p, checked: !!selected[p.id], onToggle: toggle }) }),
          e('p', { className: 'ccs-hint' }, '数据来源: ' + (dbPath || '(未知)') + '。只有包含地址、密钥且至少一个模型的供应商可以导入。')
        )
      }

      const modal = open ? e('div', { className: 'ccs-overlay', onClick: function (ev) { if (ev.target === ev.currentTarget) closeModal() } },
        e('div', { className: 'ccs-modal', onClick: function (ev) { ev.stopPropagation() } },
          e('div', { className: 'ccs-mhead' },
            e('h3', { className: 'ccs-mtitle' }, '从 CCSWITCH 导入供应商'),
            e('button', { className: 'ccs-x', onClick: closeModal, 'aria-label': '关闭' }, '✕'),
          ),
          e('div', { className: 'ccs-mbody' }, body),
          phase === 'ready' || phase === 'importing' ? e('div', { className: 'ccs-mfoot' },
            e('button', { className: 'ccs-btn', onClick: closeModal, disabled: phase === 'importing' }, '取消'),
            e('button', { className: 'ccs-btn primary', onClick: doImport, disabled: count === 0 || phase === 'importing' }, phase === 'importing' ? '导入中…' : '一键导入 (' + count + ')'),
          ) : null,
          phase === 'done' ? e('div', { className: 'ccs-mfoot' },
            e('button', { className: 'ccs-btn', onClick: backToReady }, '继续选择'),
            e('button', { className: 'ccs-btn primary', onClick: closeModal }, '完成'),
          ) : null,
        ),
      ) : null

      return e('div', { className: 'ccs-section' },
        e('h2', { className: 'ccs-title' }, 'CCSwitch 导入'),
        e('p', { className: 'ccs-desc' }, '从 CCSWITCH（~/.cc-switch）读取已保存的模型供应商（地址、密钥、模型），批量导入为 DeepSeek Harness 的模型供应商。导入后可在「模型」设置页查看，并在模型选择器中直接使用。'),
        e('div', null,
          e('button', { className: 'ccs-btn primary', onClick: openModal }, '从 CCSWITCH 导入'),
        ),
        modal,
      )
    }

    slots.inject('settings.section', function () {
      return slots.register(
        { name: 'settings.section', id: 'ccswitch-import', order: 25, label: function () { return 'CCSwitch 导入' } },
        SectionView,
      )
    })
  },
}
