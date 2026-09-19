import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Mic, Square, ArrowUpRight, ArrowDownLeft, Package, Plus, Search, ChevronRight, Pencil, Trash2, X, Check, AlertTriangle, AudioLines, LoaderCircle, History, LayoutDashboard } from 'lucide-react';
import './style.css';
import { speakResponse, stopSpeaking, resultResponse, transactionResponse, messageResponse, replyText, loadReplyLanguage, saveReplyLanguage } from './speech.js';
import { AuthGate } from './auth.jsx';

const units = ['piece', 'kg', 'litre', 'bag', 'dozen'];
const money = n => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 3 }).format(n);
async function api(url, options = {}) {
  let res;
  try { res = await fetch(`/api${url}`, { ...options, headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' } }); } catch { throw new Error('Something went wrong. Please try again.'); }
  if (res.status === 204) return;
  const data = await res.json().catch(() => { throw new Error('Something went wrong. Please try again.'); });
  if (!res.ok) { if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('stockvoice:unauthorized')); const error = new Error(data.error || 'Something went wrong. Try again.'); error.status = res.status; throw error; }
  return data;
}
const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) });

function Modal({ title, children, onClose, locked = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.focus();
  }, []);
  return <dialog aria-label={title} ref={ref} onCancel={e => { e.preventDefault(); if (!locked) onClose(); }} className="modal"><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" disabled={locked} onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}

function ProductForm({ product, onClose, onSave, busy }) {
  const [form, setForm] = useState(product || { name: '', quantity: 0, unit: 'kg', price: 0, lowStockThreshold: 5 });
  const [error, setError] = useState('');
  const field = (name, value) => setForm(prev => ({ ...prev, [name]: value }));
  return <Modal title={product ? 'Edit product' : 'New product'} onClose={onClose} locked={busy}><form onSubmit={async e => { e.preventDefault(); setError(''); try { await onSave({ name: form.name, unit: form.unit, quantity: Number(form.quantity), price: Number(form.price), lowStockThreshold: Number(form.lowStockThreshold) }); } catch (e) { setError(e.message); } }}>
    <p className="muted mb-5">{product ? 'Review your changes before saving.' : 'Add an item to your store inventory.'}</p>
    <label>Product name<input autoFocus required maxLength={80} value={form.name} onChange={e => field('name', e.target.value)} placeholder="e.g. Rice"/></label>
    <div className="form-grid"><label>Quantity<input required type="number" min="0" max="1000000" step={['kg', 'litre'].includes(form.unit) ? '0.001' : '1'} value={form.quantity} onChange={e => field('quantity', e.target.value)}/></label><label>Unit<select disabled={Boolean(product)} value={form.unit} onChange={e => field('unit', e.target.value)}>{units.map(u => <option key={u}>{u}</option>)}</select></label><label>Price per unit (₹)<input required type="number" min="0" max="1000000" step="0.001" value={form.price} onChange={e => field('price', e.target.value)}/></label><label>Low-stock threshold<input required type="number" min="0" max="1000000" step={['kg', 'litre'].includes(form.unit) ? '0.001' : '1'} value={form.lowStockThreshold} onChange={e => field('lowStockThreshold', e.target.value)}/></label></div>
    {error && <p className="error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Preparing…' : 'Review changes'}<ChevronRight size={17}/></button></div>
  </form></Modal>;
}

function App({ user, onLogout }) {
  const [data, setData] = useState({ products: [], transactions: [], mode: '', voiceReady: false });
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [text, setText] = useState(''), [result, setResult] = useState(null), [confirmation, setConfirmation] = useState(null), [confirmError, setConfirmError] = useState('');
  const [editing, setEditing] = useState(undefined), [search, setSearch] = useState(''), [lowOnly, setLowOnly] = useState(false);
  const [language, setLanguage] = useState('auto'), [recording, setRecording] = useState(false), [seconds, setSeconds] = useState(0);
  const [phase, setPhase] = useState('');
  const [replyLanguage, setReplyLanguage] = useState(loadReplyLanguage);
  const [voiceWarning, setVoiceWarning] = useState(''), [lastReply, setLastReply] = useState(null);
  const reply = message => {
    const response = typeof message === 'string' ? messageResponse(message) : message;
    setLastReply(response); setVoiceWarning('');
    speakResponse({ ...response, replyLanguage, onUnavailable: setVoiceWarning });
  };
  function chooseReplyLanguage(value) { stopSpeaking(); setReplyLanguage(value); saveReplyLanguage(value); setVoiceWarning(''); }

  function reportError(e) { setError(e.message); setPhase('Error'); reply(e.message === 'I could not understand that. Please try again.' ? 'I could not understand the voice clearly. Please try again.' : e.message); }
  const recorder = useRef(null), timer = useRef(null), stream = useRef(null);
  async function refresh() { const value = await api('/dashboard'); setData(value); }
  useEffect(() => { refresh().catch(e => setError(e.message)).finally(() => setLoading(false)); return () => { stopSpeaking(); clearInterval(timer.current); if (recorder.current) recorder.current.onstop = null; stream.current?.getTracks().forEach(t => t.stop()); }; }, []);
  const low = data.products.filter(p => p.quantity <= p.lowStockThreshold);
  const products = data.products.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) && (!lowOnly || p.quantity <= p.lowStockThreshold));
  async function run(fn) { setLastReply(null); setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { reportError(e); } finally { setBusy(false); } }
  async function interpret(e) {
    e?.preventDefault(); stopSpeaking(); setResult(null); setPhase('Understanding…');
    await run(async () => { const value = await post('/commands', { transcript: text }); if (value.type === 'confirmation') { setConfirmError(''); setConfirmation(value.confirmation); setPhase('Confirmation required'); reply('Confirmation required. Please review the stock change.'); } else { setResult(value); const message = resultResponse(value); setNotice(replyText(message, replyLanguage)); setPhase('Success'); reply(message); } });
  }
  async function saveProduct(product) {
    setBusy(true);
    try { const value = await post('/products/prepare', { operation: editing ? 'UPDATE' : 'CREATE', ...(editing ? { id: editing.id } : {}), product }); setEditing(undefined); setConfirmError(''); setConfirmation(value.confirmation); setPhase('Confirmation required'); reply('Confirmation required. Please review the change.'); } catch (e) { reply(e.message); throw e; } finally { setBusy(false); }
  }
  async function cancelConfirmation() {
    setBusy(true); setConfirmError('');
    try { await api(`/confirmations/${confirmation.id}`, { method: 'DELETE' }); setConfirmation(null); setNotice('Operation cancelled.'); setPhase('Cancelled'); reply('Operation cancelled.'); } catch (e) { setConfirmError(e.message); reply(e.message); } finally { setBusy(false); }
  }
  async function confirm() {
    stopSpeaking(); setBusy(true); setConfirmError(''); setPhase('Updating stock…');
    try { const saved = await post(`/confirmations/${confirmation.id}`, {}); setConfirmation(null); setResult(null); const message = transactionResponse(saved.transaction); setNotice(replyText(message, replyLanguage)); setPhase('Success'); reply(message); try { await refresh(); } catch { setError('Change saved, but the dashboard could not refresh. Reload to see current stock.'); } } catch (e) { setConfirmError(e.message); setPhase('Error'); reply(e.message); } finally { setBusy(false); }
  }
  async function toggleRecording() {
    if (recording) { recorder.current?.stop(); return; }
    stopSpeaking(); setLastReply(null); setError(''); setNotice(''); setResult(null);
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) { reportError(new Error('Microphone recording requires localhost or HTTPS and a supported browser. Use text input below.')); return; }
    setBusy(true);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined); recorder.current = r;
      let recordingFailed = false;
      const chunks = []; r.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      r.onstop = async () => {
        clearInterval(timer.current); stream.current?.getTracks().forEach(t => t.stop()); setRecording(false);
        if (recordingFailed) { setBusy(false); return; }
        setBusy(true); setPhase('Transcribing…');
        try { const body = new FormData(); body.append('audio', new Blob(chunks, { type: r.mimeType }), 'recording'); body.append('language', language); const value = await api('/transcribe', { method: 'POST', body }); setText(value.transcript); setPhase('Transcript ready'); setNotice('Transcript ready. Check the words, then select Review command.'); } catch (e) { reportError(e); } finally { setBusy(false); }
      };
      r.onerror = () => { recordingFailed = true; reportError(new Error('I could not understand that. Please try again.')); if (r.state !== 'inactive') r.stop(); stream.current?.getTracks().forEach(t => t.stop()); };
      r.start(); setPhase('Listening…'); setRecording(true); setSeconds(0);
      const start = Date.now(); timer.current = setInterval(() => { const elapsed = Math.floor((Date.now() - start) / 1000); setSeconds(elapsed); if (elapsed >= 60 && r.state === 'recording') r.stop(); }, 250);
    } catch { stream.current?.getTracks().forEach(t => t.stop()); reportError(new Error('Microphone access was unavailable. Allow microphone access or type your command.')); }
    finally { setBusy(false); }
  }
  const disabled = busy || recording;
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#"><span className="brand-icon"><AudioLines size={25}/></span>stockvoice<span className="brand-dot">.</span></a><div className="workspace"><span className="store-avatar">S</span><div><strong>{user.username}’s store</strong><small>Inventory workspace</small></div></div><div className="nav-caption">WORKSPACE</div><nav><a className="active" href="#"><LayoutDashboard size={19}/>Overview</a><a href="#inventory"><Package size={19}/>Inventory<span>{data.products.length}</span></a><a href="#activity"><History size={19}/>Activity</a></nav><div className="sidebar-bottom"><span className="language-badge">అ</span><p>Your store. Your language.<small>English · తెలుగు · Mixed</small></p></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">Workspace <ChevronRight size={14}/><span>Overview</span></div><div className="topbar-right"><span className={`mode-badge ${data.mode === 'demo' ? 'demo' : ''}`}>{data.mode === 'demo' ? 'Demo workspace' : data.mode === 'live' ? 'Live workspace' : 'Connecting…'}</span><span className="small">Hi, {user.fullName}</span><button className="text-button" disabled={busy || recording} onClick={() => run(async () => { stopSpeaking(); await onLogout(); })}>Logout</button></div></header>
    <main><div className="page-heading"><div><div className="eyebrow">YOUR STORE, IN SYNC</div><h1>Inventory overview</h1><p className="muted">A little less counting. A lot more clarity.</p></div><button className="button primary" disabled={disabled || loading} onClick={() => setEditing(null)}><Plus size={18}/>New product</button></div>
    {data.mode === 'demo' && <div className="demo-banner">Demo mode · Sample inventory resets when the server restarts. Use the example text commands below.</div>}
    {error && <div className="error global-message" role="alert">{error}<button onClick={() => run(refresh)} className="text-button">Refresh dashboard</button></div>}
    <div className="reply-setting"><label htmlFor="reply-language">Reply Language</label><select id="reply-language" value={replyLanguage} onChange={e => chooseReplyLanguage(e.target.value)}><option value="en">English</option><option value="te">Telugu</option></select><span className="muted small">Independent of speech input</span></div>
    {lastReply && <div className="success global-message" lang={replyLanguage === 'te' ? 'te' : 'en'} role="status">{replyText(lastReply, replyLanguage)}</div>}
    {voiceWarning && <p className="muted small mb-3" role="status">{voiceWarning}</p>}
    {phase && <p className="muted small mb-3" role="status">{phase}</p>}
    {notice && !lastReply && <div className="success global-message" role="status"><Check size={18}/>{notice}</div>}
    <section className="stats" aria-label="Inventory summary"><div className="stat"><span className="stat-icon"><Package size={20}/></span><div><span>Total products</span><strong>{loading ? '—' : data.products.length}<small>items in your store</small></strong></div></div><div className="stat"><span className="stat-icon amber"><AlertTriangle size={20}/></span><div><span>Low-stock items</span><strong>{loading ? '—' : low.length}<small>{low.length ? 'need your attention' : 'stock looks healthy'}</small></strong></div></div><div className="stat"><span className="stat-icon"><span className="rupee">₹</span></span><div><span>Inventory value</span><strong>{loading ? '—' : money(data.products.reduce((s, p) => s + p.quantity * p.price, 0))}<small>at current unit prices</small></strong></div></div></section>
    <div className="command-grid"><section className="voice-card"><div className="voice-top"><span className="eyebrow">SPEAK TO YOUR STORE</span><span className="voice-label"><AudioLines size={16}/>Voice assistant</span></div><div className="voice-content"><button className={`mic-button ${recording ? 'recording' : ''}`} aria-label={recording ? 'Stop recording' : 'Start recording'} disabled={busy || !data.voiceReady} onClick={toggleRecording}>{recording ? <Square size={32} fill="currentColor"/> : busy ? <LoaderCircle size={36} className="spin"/> : <Mic size={38}/>}</button><div><h2>{recording ? `Listening… ${seconds}s` : 'Say it. Review it. Done.'}</h2><p>{recording ? 'Tap stop when you’re finished.' : 'Add, remove, or check stock in your own words.'}</p><label className="language-select"><span className="sr-only">Speech language</span><select disabled={disabled} value={language} onChange={e => setLanguage(e.target.value)}><option value="auto">English + తెలుగు · Auto</option><option value="en">English</option><option value="te">తెలుగు</option></select></label></div></div><p className="voice-foot">{data.voiceReady ? 'Tap the microphone to start · Up to 60 seconds' : 'Use text below · Configure Gemini to enable the microphone'}</p></section>
    <section className="card alerts-card"><div className="section-heading"><h2><span className="tiny-square amber"><AlertTriangle size={16}/></span>Running low</h2><span className="count amber">{low.length}</span></div>{loading ? <p className="empty">Loading stock…</p> : low.length ? <div className="alerts-list">{low.slice(0, 3).map(p => <button className="alert-row" key={p.id} disabled={disabled} onClick={() => { setText(`add 5 ${p.unit} ${p.name}`); document.getElementById('command').focus(); }}><span className="product-avatar">{p.name.slice(0, 1)}</span><span><strong>{p.name}</strong><small>Threshold: {p.lowStockThreshold} {p.unit}</small></span><b>{p.quantity} <small>{p.unit}</small></b><ChevronRight size={16}/></button>)}</div> : <p className="empty">All products are above their stock thresholds.</p>}<button className="text-button alerts-link" onClick={() => { setLowOnly(true); document.getElementById('inventory').scrollIntoView({ behavior: 'smooth' }); }}>View low-stock inventory <ArrowUpRight size={16}/></button></section></div>
    <section className="card command-card"><div className="section-heading"><h2>Your command</h2><span className="muted small">Speak above or type below</span></div><form onSubmit={interpret}><label htmlFor="command" className="sr-only">Inventory command or transcript</label><div className="command-input"><textarea id="command" rows="2" maxLength={1000} placeholder="Try “add 5 kg Rice”" value={text} disabled={disabled} onChange={e => { setText(e.target.value); setResult(null); }}/><button className="button primary" disabled={disabled || !text.trim() || loading}>{busy ? <LoaderCircle size={17} className="spin"/> : <ChevronRight size={17}/>}Review command</button></div></form><div className="examples"><span>Try it</span>{['add 5 kg Rice', 'check Rice', 'low stock'].map(t => <button key={t} disabled={disabled} onClick={() => { setText(t); setResult(null); }}>{t}<ArrowUpRight size={12}/></button>)}</div>{result && <div className="command-result" role="status"><strong>{result.intent === 'LOW_STOCK' ? 'Low-stock results' : 'Current stock'}</strong>{result.products.length ? result.products.map(p => <div key={p.id}>{p.name}<b>{p.quantity} {p.unit}</b></div>) : <p>No low-stock products.</p>}</div>}</section>
    <section className="card inventory-card" id="inventory"><div className="inventory-heading"><div><h2>Store inventory <span className="count">{data.products.length}</span></h2><p className="muted small">Everything on your shelves, in one place.</p></div><div className="inventory-tools"><label className="search"><Search size={16}/><input aria-label="Search products" placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)}/></label><button className={`filter-button ${lowOnly ? 'selected' : ''}`} onClick={() => setLowOnly(v => !v)}>{lowOnly ? 'Show all' : 'Low stock'}</button></div></div><div className="table-scroll"><table><thead><tr><th>PRODUCT</th><th>AVAILABLE</th><th>UNIT PRICE</th><th>STATUS</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{products.map(p => <tr key={p.id}><td><span className="product-name"><span className="product-avatar">{p.name[0]}</span><strong>{p.name}</strong></span></td><td><strong>{p.quantity}</strong><span className="muted"> {p.unit}</span></td><td>{money(p.price)}</td><td><span className={`status ${p.quantity <= p.lowStockThreshold ? 'low' : ''}`}>{p.quantity <= p.lowStockThreshold ? 'Low stock' : 'In stock'}</span></td><td><div className="row-actions"><button className="icon-button" aria-label={`Edit ${p.name}`} disabled={disabled} onClick={() => setEditing(p)}><Pencil size={16}/></button><button className="icon-button delete" aria-label={`Delete ${p.name}`} disabled={disabled} onClick={() => run(async () => { const value = await post('/products/prepare', { operation: 'DELETE', id: p.id }); setConfirmError(''); setConfirmation(value.confirmation); })}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table></div>{!products.length && <div className="empty">{loading ? 'Loading inventory…' : search || lowOnly ? 'No products match this filter.' : 'Your shelves are ready. Add your first product to get started.'}</div>}<div className="table-footer">Showing {products.length} of {data.products.length} products<span>Review required for every change <Check size={14}/></span></div></section>
    <section className="card activity-card" id="activity"><div className="section-heading"><div><h2>Recent activity</h2><p className="muted small">A clear record of every confirmed change.</p></div><History size={20} className="muted"/></div>{!data.transactions.length ? <div className="activity-empty"><span className="stat-icon"><History size={21}/></span><div><strong>No changes yet</strong><p className="muted small">Your first confirmed update will appear here.</p></div></div> : <div className="activity-list">{data.transactions.map(t => <div className="activity-row" key={t.id}><span className={`activity-icon ${t.after < t.before ? 'out' : ''}`}>{t.after < t.before ? <ArrowDownLeft size={18}/> : <ArrowUpRight size={18}/>}</span><div className="activity-detail"><strong>{t.name}<span>{t.type.replaceAll('_', ' ').toLowerCase()}</span></strong><p>“{t.transcript}”</p><small>{new Date(t.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</small></div><div className="activity-quantity"><strong>{t.before} → {t.after} {t.unit}</strong><small>{t.price !== null ? money(t.price) + ' / ' + t.unit : 'Product deleted'}</small></div></div>)}</div>}</section>
    <footer>stockvoice<span>Made for the way you run your store.</span></footer></main></div>
    {editing !== undefined && <ProductForm product={editing} busy={busy} onClose={() => setEditing(undefined)} onSave={saveProduct}/>}
    {confirmation && <Modal title="Review your change" onClose={cancelConfirmation} locked={busy}><div className="confirm-label">{confirmation.title}</div><h3 className="confirm-product">{confirmation.name}</h3><div className="confirm-stock"><div><span>Current stock</span><strong>{confirmation.before} <small>{confirmation.unit}</small></strong></div><ChevronRight size={24}/><div><span>After confirmation</span><strong>{confirmation.after === null ? 'Deleted' : <>{confirmation.after} <small>{confirmation.unit}</small></>}</strong></div></div><p className="confirm-meta">Unit price: {money(confirmation.price)}{confirmation.previousPrice !== undefined && confirmation.price !== confirmation.previousPrice ? ` (was ${money(confirmation.previousPrice)})` : ''}{confirmation.lowStockThreshold !== undefined && <><br/>Low-stock threshold: {confirmation.lowStockThreshold} {confirmation.unit}</>}</p><blockquote>{confirmation.transcript}</blockquote><p className="muted small">Nothing changes until you confirm. This preview expires in 5 minutes.</p>{confirmError && <p className="error" role="alert">{confirmError}</p>}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={cancelConfirmation}>Cancel</button><button className="button primary" disabled={busy} onClick={confirm}>{busy ? <LoaderCircle className="spin" size={17}/> : <Check size={17}/>}Confirm change</button></div></Modal>}
  </div>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><AuthGate request={api}>{(user, onLogout) => <App key={user.id} user={user} onLogout={onLogout}/>}</AuthGate></React.StrictMode>);


