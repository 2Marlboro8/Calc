import { useState, useCallback, useRef } from 'react'
import { Plus, Trash2, Calculator, FileText, ChevronDown, ChevronUp, Copy, CheckCheck, Sparkles, Loader, Database, Key, X, Search } from 'lucide-react'
import { PRICE_DB, findPrices, midPrice } from './db'
import type { Unit } from './db'

const UNITS: Unit[] = ['шт.', 'м²', 'м.', 'п.м.', 'компл.', 'ч.', 'кг', 'л.']
const VAT = 0.12
const uid = () => Math.random().toString(36).slice(2, 8)
const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })

interface WorkItem {
  id: string; name: string; unit: Unit
  qty: number; workPrice: number; matPrice: number; note: string
}
interface Section {
  id: string; title: string; items: WorkItem[]
  collapsed: boolean; loading?: boolean
}

function newItem(): WorkItem { return { id: uid(), name: '', unit: 'шт.', qty: 1, workPrice: 0, matPrice: 0, note: '' } }
function newSection(title = 'Раздел'): Section { return { id: uid(), title, items: [newItem()], collapsed: false } }

const PRESETS = [
  { label: 'Электромонтаж LED', sections: [
    { title: 'Демонтаж', items: [
      { id: uid(), name: 'Демонтаж светильников', unit: 'шт.' as Unit, qty: 120, workPrice: 0, matPrice: 0, note: '' },
      { id: uid(), name: 'Демонтаж кабельных лотков', unit: 'м.' as Unit, qty: 50, workPrice: 0, matPrice: 0, note: '' },
    ]},
    { title: 'Монтаж LED', items: [
      { id: uid(), name: 'Монтаж LED-светильников 40Вт', unit: 'шт.' as Unit, qty: 120, workPrice: 0, matPrice: 0, note: '' },
      { id: uid(), name: 'Прокладка кабеля ВВГнг 3х2.5', unit: 'м.' as Unit, qty: 200, workPrice: 0, matPrice: 0, note: '' },
      { id: uid(), name: 'Пусконаладочные работы', unit: 'компл.' as Unit, qty: 1, workPrice: 0, matPrice: 0, note: '' },
    ]},
  ]},
  { label: 'Сантехника', sections: [
    { title: 'Работы', items: [
      { id: uid(), name: 'Замена жироуловителя', unit: 'шт.' as Unit, qty: 1, workPrice: 0, matPrice: 0, note: '' },
      { id: uid(), name: 'Монтаж канализационных труб НПВХ 110мм', unit: 'м.' as Unit, qty: 20, workPrice: 0, matPrice: 0, note: '' },
      { id: uid(), name: 'Пусконаладка системы', unit: 'компл.' as Unit, qty: 1, workPrice: 0, matPrice: 0, note: '' },
    ]},
  ]},
]

// ── API call ─────────────────────────────────────────────────
async function callAI(items: WorkItem[], objectType: string, apiKey: string) {
  const list = items.filter(i => i.name.trim())
    .map(i => `id=${i.id} | "${i.name}" | ед=${i.unit} | кол=${i.qty}`).join('\n')
  const prompt = `Ты опытный сметчик Казахстан. Объект: ${objectType}.\nДля каждой работы укажи цены в тенге (₸) 2024-2025:\n- workPrice: цена работы/ед\n- matPrice: цена материала/ед (0 если не нужен)\n- unit: исправь если неверная\n- note: 3-5 слов комментарий\n\n${list}\n\nОтвечай ТОЛЬКО JSON массивом:\n[{"id":"...","workPrice":1500,"matPrice":0,"unit":"шт.","note":"..."}]`
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  const data = await res.json()
  const text = data.content?.find((b: any) => b.type === 'text')?.text || '[]'
  return JSON.parse(text.replace(/```json|```/g, '').trim())
}

// ── DB Modal ─────────────────────────────────────────────────
function DBModal({ onSelect, onClose }: { onSelect: (name: string, unit: Unit, work: number, mat: number) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const results = q.length > 1
    ? PRICE_DB.filter(i => i.tags.some(t => q.toLowerCase().includes(t)) || i.name.toLowerCase().includes(q.toLowerCase())).slice(0, 12)
    : PRICE_DB.slice(0, 20)

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#1a1d2e] border border-white/10 rounded-xl w-full max-w-2xl mx-4 shadow-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <Database size={16} className="text-emerald-400" />
          <span className="text-white font-semibold text-sm">База цен · {PRICE_DB.length} позиций</span>
          <span className="text-xs text-slate-500 ml-1">Казахстан 2024-2025</span>
          <button onClick={onClose} className="ml-auto text-slate-500 hover:text-white"><X size={16} /></button>
        </div>
        <div className="px-4 py-3 border-b border-white/5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="Поиск: кабель, светильник, плитка..."
              className="w-full bg-[#0f1117] border border-white/10 rounded pl-8 pr-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50" />
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#1a1d2e]">
              <tr className="text-slate-500 border-b border-white/5">
                <th className="text-left px-4 py-2">Наименование</th>
                <th className="text-center px-2 py-2">Ед.</th>
                <th className="text-right px-3 py-2 text-blue-400/70">Работа ₸</th>
                <th className="text-right px-3 py-2 text-emerald-400/70">Материал ₸</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {results.map((item, i) => {
                const mid = midPrice(item, true)
                return (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/3 cursor-pointer group"
                    onClick={() => onSelect(item.name, item.unit, mid.work, mid.mat)}>
                    <td className="px-4 py-2 text-slate-200">{item.name}</td>
                    <td className="px-2 py-2 text-center text-slate-400">{item.unit}</td>
                    <td className="px-3 py-2 text-right font-mono text-blue-400">
                      {fmt(item.workMin)}–{fmt(item.workMax)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-400">
                      {item.matMin > 0 ? `${fmt(item.matMin)}–${fmt(item.matMax)}` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className="opacity-0 group-hover:opacity-100 text-amber-400 text-xs transition-opacity">+ добавить</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-white/5 text-xs text-slate-500">
          Кликни на позицию чтобы добавить в смету со средней ценой
        </div>
      </div>
    </div>
  )
}

// ── AI Modal ─────────────────────────────────────────────────
function AIModal({ apiKey, onConfirm, onClose }: {
  apiKey: string
  onConfirm: (objectType: string, key: string) => void
  onClose: () => void
}) {
  const [obj, setObj] = useState('')
  const [key, setKey] = useState(apiKey)
  const OBJECTS = ['Промышленный объект (горнодобыча)', 'Вахтовый городок', 'Офисное здание', 'Склад / ангар', 'Жилой дом', 'Завод']
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#1a1d2e] border border-white/10 rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
            <Sparkles size={16} className="text-amber-400" />
          </div>
          <div>
            <div className="text-white font-semibold text-sm">ИИ-оценка цен</div>
            <div className="text-slate-500 text-xs">Claude заполнит пустые цены</div>
          </div>
          <button onClick={onClose} className="ml-auto text-slate-500 hover:text-white"><X size={16} /></button>
        </div>

        <label className="block text-xs text-slate-400 mb-1">Тип объекта</label>
        <input value={obj} onChange={e => setObj(e.target.value)}
          placeholder="напр. вахтовый городок, Актогай"
          className="w-full bg-[#0f1117] border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 mb-2" autoFocus />
        <div className="flex flex-wrap gap-1.5 mb-4">
          {OBJECTS.map(o => (
            <button key={o} onClick={() => setObj(o)}
              className={`px-2.5 py-1 rounded text-xs border transition-all ${obj === o ? 'border-amber-500 text-amber-400' : 'border-white/10 text-slate-400 hover:border-white/30'}`}>
              {o}
            </button>
          ))}
        </div>

        <label className="block text-xs text-slate-400 mb-1 flex items-center gap-1.5">
          <Key size={11} /> Anthropic API ключ
        </label>
        <input value={key} onChange={e => setKey(e.target.value)} type="password"
          placeholder="sk-ant-..."
          className="w-full bg-[#0f1117] border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 mb-1 font-mono" />
        <div className="text-xs text-slate-600 mb-4">
          Получить ключ: <a href="https://console.anthropic.com" target="_blank" className="text-amber-400/70 hover:text-amber-400">console.anthropic.com</a> · ~$0.003 за запрос
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded border border-white/10 text-slate-400 text-sm hover:text-white transition-colors">Отмена</button>
          <button onClick={() => obj.trim() && key.trim() && onConfirm(obj.trim(), key.trim())}
            disabled={!obj.trim() || !key.trim()}
            className="flex-1 px-4 py-2 rounded bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center justify-center gap-2">
            <Sparkles size={14} /> Рассчитать
          </button>
        </div>
      </div>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────
export default function App() {
  const [projectName, setProjectName] = useState('Новая смета')
  const [contractor, setContractor] = useState('ТОО SANA Corp')
  const [client, setClient] = useState('KAZ Minerals Aktogay')
  const [sections, setSections] = useState<Section[]>([newSection('Раздел 1')])
  const [vatEnabled, setVatEnabled] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit')
  const [error, setError] = useState<string | null>(null)
  const [dbModal, setDbModal] = useState<{ sectionId: string } | null>(null)
  const [aiModal, setAiModal] = useState<{ sectionId: string } | null>(null)
  const [apiKey, setApiKey] = useState('')

  const sw  = (s: Section) => s.items.reduce((sum, i) => sum + Number(i.qty)*Number(i.workPrice), 0)
  const sm  = (s: Section) => s.items.reduce((sum, i) => sum + Number(i.qty)*Number(i.matPrice), 0)
  const st  = (s: Section) => sw(s)+sm(s)
  const tW  = sections.reduce((s,x)=>s+sw(x),0)
  const tM  = sections.reduce((s,x)=>s+sm(x),0)
  const grand = tW+tM
  const vat = vatEnabled ? grand*VAT : 0
  const final = grand+vat

  const addSection = () => setSections(p=>[...p, newSection(`Раздел ${p.length+1}`)])
  const removeSection = (id: string) => setSections(p=>p.filter(s=>s.id!==id))
  const toggle = (id: string) => setSections(p=>p.map(s=>s.id===id?{...s,collapsed:!s.collapsed}:s))
  const setTitle = (id: string, v: string) => setSections(p=>p.map(s=>s.id===id?{...s,title:v}:s))
  const addItem = (sid: string) => setSections(p=>p.map(s=>s.id===sid?{...s,items:[...s.items,newItem()]}:s))
  const removeItem = (sid: string, iid: string) => setSections(p=>p.map(s=>s.id===sid?{...s,items:s.items.filter(i=>i.id!==iid)}:s))
  const updateItem = useCallback((sid: string, iid: string, field: keyof WorkItem, value: unknown) =>
    setSections(p=>p.map(s=>s.id===sid?{...s,items:s.items.map(i=>i.id===iid?{...i,[field]:value}:i)}:s)), [])

  const loadPreset = (idx: number) => {
    const pr = PRESETS[idx]
    setProjectName(pr.label)
    setSections(pr.sections.map(s=>({...s,id:uid(),collapsed:false})))
  }

  // DB — подставить цены из базы для раздела
  const fillFromDB = (sectionId: string) => {
    setSections(p=>p.map(s=>{
      if (s.id!==sectionId) return s
      return {...s, items: s.items.map(item=>{
        if (!item.name.trim()) return item
        const found = findPrices(item.name)
        if (!found) return item
        const prices = midPrice(found, true)
        return {
          ...item,
          unit: found.unit,
          workPrice: item.workPrice===0 ? prices.work : item.workPrice,
          matPrice:  item.matPrice===0  ? prices.mat  : item.matPrice,
          note: `база цен: ${fmt(found.workMin)}–${fmt(found.workMax)} ₸`,
        }
      })}
    }))
  }

  // DB modal — добавить строку из базы
  const addFromDB = (sectionId: string, name: string, unit: Unit, work: number, mat: number) => {
    const newI: WorkItem = { id: uid(), name, unit, qty: 1, workPrice: work, matPrice: mat, note: 'из базы цен' }
    setSections(p=>p.map(s=>s.id===sectionId?{...s,items:[...s.items,newI]}:s))
    setDbModal(null)
  }

  // AI fill
  const handleAI = async (objectType: string, key: string) => {
    if (!aiModal) return
    setApiKey(key)
    setAiModal(null)
    setError(null)
    const sid = aiModal.sectionId
    const section = sections.find(s=>s.id===sid)
    if (!section) return
    const filled = section.items.filter(i=>i.name.trim())
    if (!filled.length) return
    setSections(p=>p.map(s=>s.id===sid?{...s,loading:true}:s))
    try {
      const results = await callAI(filled, objectType, key)
      setSections(p=>p.map(s=>{
        if (s.id!==sid) return s
        return {...s, loading:false, items:s.items.map(item=>{
          const ai = results.find((r:any)=>r.id===item.id)
          if (!ai) return item
          return {...item, workPrice:ai.workPrice??item.workPrice, matPrice:ai.matPrice??item.matPrice, unit:ai.unit??item.unit, note:ai.note??item.note}
        })}
      }))
    } catch(e:any) {
      setSections(p=>p.map(s=>s.id===sid?{...s,loading:false}:s))
      setError('Ошибка ИИ: '+(e?.message||'попробуй снова'))
    }
  }

  const copySummary = () => {
    const lines = [`СМЕТА: ${projectName}`,`Подрядчик: ${contractor} | Заказчик: ${client}`,'',
      ...sections.map(s=>[`▪ ${s.title}: работы ${fmt(sw(s))} ₸ | матер. ${fmt(sm(s))} ₸`,
        ...s.items.map(i=>`   ${i.name} — ${i.qty} ${i.unit} | раб: ${fmt(Number(i.workPrice))} | мат: ${fmt(Number(i.matPrice))} | итог: ${fmt(Number(i.qty)*(Number(i.workPrice)+Number(i.matPrice)))} ₸`)].join('\n')),
      '',`Работы: ${fmt(tW)} ₸`,`Материалы: ${fmt(tM)} ₸`,`Итого: ${fmt(grand)} ₸`,
      vatEnabled?`НДС 12%: ${fmt(vat)} ₸`:null,`ВСЕГО: ${fmt(final)} ₸`,
    ].filter(Boolean).join('\n')
    navigator.clipboard.writeText(lines)
    setCopied(true); setTimeout(()=>setCopied(false),2000)
  }

  const inp  = `bg-[#0f1117] border border-white/8 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50 transition-colors`
  const inpR = inp+` text-right`

  return (
    <div className="min-h-screen bg-[#0f1117] text-slate-200 font-sans">

      {dbModal && <DBModal
        onSelect={(name, unit, work, mat) => addFromDB(dbModal.sectionId, name, unit, work, mat)}
        onClose={() => setDbModal(null)} />}

      {aiModal && <AIModal
        apiKey={apiKey}
        onConfirm={handleAI}
        onClose={() => setAiModal(null)} />}

      {/* Header */}
      <header className="border-b border-white/10 bg-[#161820] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-amber-500 flex items-center justify-center">
            <Calculator size={16} className="text-white" />
          </div>
          <div>
            <div className="font-semibold text-white text-sm">Калькулятор смет</div>
            <div className="text-xs text-slate-500">SANA Corp · База цен + ИИ</div>
          </div>
        </div>
        <div className="flex gap-2">
          {(['edit','preview'] as const).map(tab=>(
            <button key={tab} onClick={()=>setActiveTab(tab)}
              className={`px-4 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-1 ${activeTab===tab?'bg-amber-500 text-white':'text-slate-400 hover:text-white'}`}>
              {tab==='preview'&&<FileText size={12}/>}
              {tab==='edit'?'Редактор':'Смета'}
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {activeTab==='edit' ? (
          <>
            {error && (
              <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex justify-between">
                {error}<button onClick={()=>setError(null)}><X size={14}/></button>
              </div>
            )}

            {/* Project info */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[['Название проекта',projectName,setProjectName],['Подрядчик',contractor,setContractor],['Заказчик',client,setClient]].map(([label,val,set]:any)=>(
                <div key={label}>
                  <label className="block text-xs text-slate-500 mb-1">{label}</label>
                  <input value={val} onChange={e=>set(e.target.value)}
                    className="w-full bg-[#1e2130] border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors"/>
                </div>
              ))}
            </div>

            {/* Presets */}
            <div className="flex items-center gap-2 mb-5">
              <span className="text-xs text-slate-500">Шаблоны:</span>
              {PRESETS.map((p,i)=>(
                <button key={i} onClick={()=>loadPreset(i)}
                  className="px-3 py-1 rounded border border-white/10 text-xs text-slate-400 hover:border-amber-500 hover:text-amber-400 transition-all">
                  {p.label}
                </button>
              ))}
            </div>

            {/* Column headers */}
            <div className="mb-2 px-4 py-2 bg-[#1a1d2e] rounded-lg border border-white/5">
              <div className="grid gap-2 text-xs text-slate-500" style={{gridTemplateColumns:'minmax(140px,2fr) 62px 72px 1fr 1fr 100px 24px'}}>
                <span>Наименование</span><span>Ед.</span>
                <span className="text-right">Кол-во</span>
                <span className="text-right text-blue-400/70">Работа, ₸/ед.</span>
                <span className="text-right text-emerald-400/70">Материал, ₸/ед.</span>
                <span className="text-right text-amber-400/70">Итог строки, ₸</span>
                <span></span>
              </div>
            </div>

            {/* Sections */}
            <div className="space-y-3">
              {sections.map(section=>(
                <div key={section.id} className="bg-[#161820] border border-white/10 rounded-lg overflow-hidden">

                  {/* Section header */}
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-[#1a1d2e] border-b border-white/10 flex-wrap gap-y-1.5">
                    <button onClick={()=>toggle(section.id)} className="text-slate-500 hover:text-white transition-colors shrink-0">
                      {section.collapsed?<ChevronDown size={14}/>:<ChevronUp size={14}/>}
                    </button>
                    <input value={section.title} onChange={e=>setTitle(section.id,e.target.value)}
                      className="flex-1 bg-transparent text-sm font-medium text-white focus:outline-none min-w-[80px]"/>

                    {/* Buttons */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* DB button */}
                      <button onClick={()=>setDbModal({sectionId:section.id})}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-emerald-500/30 text-emerald-400 text-xs hover:bg-emerald-500/10 transition-all">
                        <Database size={11}/> База цен
                      </button>
                      {/* DB auto-fill */}
                      <button onClick={()=>fillFromDB(section.id)}
                        disabled={!section.items.some(i=>i.name.trim())}
                        title="Автозаполнить цены из базы"
                        className="flex items-center gap-1 px-2 py-1 rounded border border-emerald-500/20 text-emerald-400/70 text-xs hover:bg-emerald-500/10 disabled:opacity-30 transition-all">
                        <Search size={11}/> Авто
                      </button>
                      {/* AI button */}
                      <button onClick={()=>setAiModal({sectionId:section.id})}
                        disabled={section.loading||!section.items.some(i=>i.name.trim())}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-amber-500/30 text-amber-400 text-xs hover:bg-amber-500/10 disabled:opacity-30 transition-all">
                        {section.loading?<><Loader size={11} className="animate-spin"/>Считаю...</>:<><Sparkles size={11}/>ИИ-оценка</>}
                      </button>
                    </div>

                    {/* Totals */}
                    <div className="flex items-center gap-2 text-xs font-mono shrink-0">
                      <span className="text-blue-400">{fmt(sw(section))}</span>
                      <span className="text-slate-600">+</span>
                      <span className="text-emerald-400">{fmt(sm(section))}</span>
                      <span className="text-slate-600">=</span>
                      <span className="text-amber-400 font-semibold">{fmt(st(section))} ₸</span>
                    </div>
                    {sections.length>1&&(
                      <button onClick={()=>removeSection(section.id)} className="text-slate-600 hover:text-red-400 transition-colors shrink-0">
                        <Trash2 size={13}/>
                      </button>
                    )}
                  </div>

                  {section.loading&&(
                    <div className="px-4 py-2.5 bg-amber-500/5 border-b border-amber-500/10 flex items-center gap-2 text-xs text-amber-400/80">
                      <Loader size={12} className="animate-spin"/> Claude анализирует работы...
                    </div>
                  )}

                  {!section.collapsed&&(
                    <div className="p-3 space-y-1.5">
                      {section.items.map(item=>(
                        <div key={item.id}>
                          <div className="grid gap-2 items-center" style={{gridTemplateColumns:'minmax(140px,2fr) 62px 72px 1fr 1fr 100px 24px'}}>
                            <input value={item.name} onChange={e=>updateItem(section.id,item.id,'name',e.target.value)}
                              placeholder="Название работы..." className={inp+' placeholder:text-slate-700'}/>
                            <select value={item.unit} onChange={e=>updateItem(section.id,item.id,'unit',e.target.value as Unit)} className={inp}>
                              {UNITS.map(u=><option key={u}>{u}</option>)}
                            </select>
                            <input type="text" inputMode="numeric" value={item.qty}
                              onFocus={e=>{if(Number(e.target.value)===0)updateItem(section.id,item.id,'qty','')}}
                              onBlur={e=>{if(e.target.value==='')updateItem(section.id,item.id,'qty',0)}}
                              onChange={e=>updateItem(section.id,item.id,'qty',e.target.value.replace(/[^0-9.]/g,''))}
                              className={inpR}/>
                            <input type="text" inputMode="numeric" value={item.workPrice}
                              onFocus={e=>{if(Number(e.target.value)===0)updateItem(section.id,item.id,'workPrice','')}}
                              onBlur={e=>{if(e.target.value==='')updateItem(section.id,item.id,'workPrice',0)}}
                              onChange={e=>updateItem(section.id,item.id,'workPrice',e.target.value.replace(/[^0-9.]/g,''))}
                              className={inpR+' border-blue-400/30 focus:border-blue-400/60'}/>
                            <input type="text" inputMode="numeric" value={item.matPrice}
                              onFocus={e=>{if(Number(e.target.value)===0)updateItem(section.id,item.id,'matPrice','')}}
                              onBlur={e=>{if(e.target.value==='')updateItem(section.id,item.id,'matPrice',0)}}
                              onChange={e=>updateItem(section.id,item.id,'matPrice',e.target.value.replace(/[^0-9.]/g,''))}
                              className={inpR+' border-emerald-400/30 focus:border-emerald-400/60'}/>
                            <div className={`${inpR} bg-[#1a1d2e] border-amber-400/20 text-amber-400 font-semibold cursor-default select-none`}>
                              {fmt(Number(item.qty)*(Number(item.workPrice)+Number(item.matPrice)))}
                            </div>
                            <button onClick={()=>removeItem(section.id,item.id)}
                              className="w-6 h-6 flex items-center justify-center text-slate-700 hover:text-red-400 transition-colors">
                              <Trash2 size={12}/>
                            </button>
                          </div>
                          {item.note&&(
                            <div className="text-xs text-slate-600 italic pl-1 mt-0.5">{item.note}</div>
                          )}
                        </div>
                      ))}
                      <button onClick={()=>addItem(section.id)}
                        className="mt-2 flex items-center gap-1.5 text-xs text-slate-600 hover:text-amber-400 transition-colors">
                        <Plus size={12}/> Добавить строку
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <button onClick={addSection}
              className="mt-3 flex items-center gap-2 text-sm text-slate-500 hover:text-amber-400 transition-colors border border-dashed border-white/10 hover:border-amber-500/40 rounded-lg px-4 py-3 w-full justify-center">
              <Plus size={14}/> Добавить раздел
            </button>

            {/* Totals */}
            <div className="mt-6 bg-[#161820] border border-white/10 rounded-lg p-5">
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1 space-y-1">
                  {sections.map(s=>(
                    <div key={s.id} className="grid text-xs" style={{gridTemplateColumns:'10rem 90px 90px 110px'}}>
                      <span className="text-slate-500 truncate">{s.title}</span>
                      <span className="text-blue-400 font-mono text-right">{fmt(sw(s))}</span>
                      <span className="text-emerald-400 font-mono text-right">{fmt(sm(s))}</span>
                      <span className="text-slate-300 font-mono text-right">{fmt(st(s))} ₸</span>
                    </div>
                  ))}
                  <div className="border-t border-white/10 pt-2 mt-2 space-y-1">
                    <div className="grid text-xs text-slate-600" style={{gridTemplateColumns:'10rem 90px 90px 110px'}}>
                      <span></span><span className="text-right text-blue-400/50">работы</span>
                      <span className="text-right text-emerald-400/50">матер.</span><span className="text-right">итого</span>
                    </div>
                    <div className="grid text-sm" style={{gridTemplateColumns:'10rem 90px 90px 110px'}}>
                      <span className="text-slate-400">Без НДС</span>
                      <span className="text-blue-400 font-mono font-semibold text-right">{fmt(tW)}</span>
                      <span className="text-emerald-400 font-mono font-semibold text-right">{fmt(tM)}</span>
                      <span className="text-white font-mono font-semibold text-right">{fmt(grand)} ₸</span>
                    </div>
                    {vatEnabled&&(
                      <div className="grid text-sm" style={{gridTemplateColumns:'10rem 90px 90px 110px'}}>
                        <span className="text-slate-500">НДС 12%</span><span></span><span></span>
                        <span className="text-slate-300 font-mono text-right">{fmt(vat)} ₸</span>
                      </div>
                    )}
                    <div className="grid text-base font-bold" style={{gridTemplateColumns:'10rem 90px 90px 110px'}}>
                      <span className="text-amber-400">ИТОГО</span><span></span><span></span>
                      <span className="text-amber-400 font-mono text-right">{fmt(final)} ₸</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-3 items-end">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <span className="text-xs text-slate-500">НДС 12%</span>
                    <div onClick={()=>setVatEnabled(v=>!v)}
                      className={`w-9 h-5 rounded-full transition-colors relative ${vatEnabled?'bg-amber-500':'bg-slate-700'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${vatEnabled?'left-4.5':'left-0.5'}`}/>
                    </div>
                  </label>
                  <button onClick={copySummary}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded text-xs font-medium transition-colors">
                    {copied?<><CheckCheck size={13}/>Скопировано!</>:<><Copy size={13}/>Копировать итог</>}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* PREVIEW */
          <div className="bg-white text-slate-800 rounded-lg p-8 shadow-xl">
            <div className="border-b-2 border-amber-500 pb-4 mb-6">
              <div className="text-xs text-slate-400 uppercase tracking-widest mb-1">Локальная смета</div>
              <h1 className="text-2xl font-bold text-slate-900">{projectName}</h1>
              <div className="flex gap-8 mt-3 text-sm text-slate-500">
                <span><b className="text-slate-700">Подрядчик:</b> {contractor}</span>
                <span><b className="text-slate-700">Заказчик:</b> {client}</span>
                <span><b className="text-slate-700">Дата:</b> {new Date().toLocaleDateString('ru-RU')}</span>
              </div>
            </div>
            {sections.map((section,si)=>(
              <div key={section.id} className="mb-6">
                <div className="flex justify-between items-center bg-slate-100 px-3 py-2 rounded mb-2">
                  <span className="font-semibold text-sm text-slate-700">{si+1}. {section.title}</span>
                  <div className="flex gap-6 text-xs font-mono">
                    <span className="text-blue-600">{fmt(sw(section))} ₸ <span className="text-slate-400 font-normal">работы</span></span>
                    <span className="text-emerald-600">{fmt(sm(section))} ₸ <span className="text-slate-400 font-normal">матер.</span></span>
                    <span className="text-amber-600 font-bold">{fmt(st(section))} ₸</span>
                  </div>
                </div>
                <table className="w-full text-xs">
                  <thead><tr className="text-slate-400 border-b">
                    <th className="text-left py-1 pr-2 w-5">№</th>
                    <th className="text-left py-1 pr-2">Наименование</th>
                    <th className="text-center py-1 pr-2 w-10">Ед.</th>
                    <th className="text-right py-1 pr-2 w-12">Кол.</th>
                    <th className="text-right py-1 pr-2 w-20 text-blue-500">Работа ₸</th>
                    <th className="text-right py-1 pr-2 w-20 text-emerald-500">Матер. ₸</th>
                    <th className="text-right py-1 w-24 text-amber-600">Итого ₸</th>
                  </tr></thead>
                  <tbody>
                    {section.items.map((item,ii)=>(
                      <tr key={item.id} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2 text-slate-400">{ii+1}</td>
                        <td className="py-1.5 pr-2">{item.name||'—'}{item.note&&<span className="text-slate-400 ml-1 italic">({item.note})</span>}</td>
                        <td className="py-1.5 pr-2 text-center text-slate-500">{item.unit}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">{item.qty}</td>
                        <td className="py-1.5 pr-2 text-right font-mono text-blue-600">{fmt(Number(item.workPrice))}</td>
                        <td className="py-1.5 pr-2 text-right font-mono text-emerald-600">{fmt(Number(item.matPrice))}</td>
                        <td className="py-1.5 text-right font-mono font-semibold text-amber-700">{fmt(Number(item.qty)*(Number(item.workPrice)+Number(item.matPrice)))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <div className="border-t-2 border-slate-200 pt-4 mt-4 flex justify-end">
              <table className="text-sm">
                <tbody>
                  <tr><td className="pr-8 py-0.5 text-slate-500">Работы:</td><td className="text-right font-mono text-blue-600">{fmt(tW)} ₸</td></tr>
                  <tr><td className="pr-8 py-0.5 text-slate-500">Материалы:</td><td className="text-right font-mono text-emerald-600">{fmt(tM)} ₸</td></tr>
                  <tr className="border-t border-slate-200"><td className="pr-8 pt-2 font-semibold text-slate-600">Итого без НДС:</td><td className="pt-2 text-right font-mono font-semibold">{fmt(grand)} ₸</td></tr>
                  {vatEnabled&&<tr><td className="pr-8 py-0.5 text-slate-500">НДС 12%:</td><td className="py-0.5 text-right font-mono">{fmt(vat)} ₸</td></tr>}
                  <tr className="border-t-2 border-amber-300 text-base font-bold">
                    <td className="pr-8 pt-2 text-amber-700">ИТОГО:</td>
                    <td className="pt-2 text-right font-mono text-amber-700">{fmt(final)} ₸</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-8 pt-4 border-t border-slate-100 flex justify-between text-xs text-slate-400">
              <span>{contractor}</span>
              <span>Сформировано: {new Date().toLocaleDateString('ru-RU')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
