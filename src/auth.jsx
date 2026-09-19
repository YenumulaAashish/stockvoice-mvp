import React, { useEffect, useState } from 'react';

export function AuthGate({ request, children }) {
  const [user, setUser] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [path, setPath] = useState(window.location.pathname);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ fullName: '', username: '', email: '', password: '', confirmPassword: '', identifier: '' });
  const navigate = next => { window.history.replaceState({}, '', next); setPath(next); };
  const clear = () => { setUser(null); setForm({ fullName: '', username: '', email: '', password: '', confirmPassword: '', identifier: '' }); navigate('/login'); };
  useEffect(() => {
    request('/auth/me').then(data => { setUser(data.user); navigate('/'); }).catch(e => { if (e.status !== 401) setError(e.message); navigate(window.location.pathname === '/signup' ? '/signup' : '/login'); }).finally(() => setLoading(false));
    const expired = () => { clear(); setError('Your session expired. Please log in again.'); };
    const pop = () => setPath(window.location.pathname);
    window.addEventListener('stockvoice:unauthorized', expired); window.addEventListener('popstate', pop);
    return () => { window.removeEventListener('stockvoice:unauthorized', expired); window.removeEventListener('popstate', pop); };
  }, []);
  useEffect(() => { if (user && ['/signup', '/login'].includes(path)) navigate('/'); else if (!loading && !user && !['/signup', '/login'].includes(path)) navigate('/login'); }, [user, path, loading]);
  if (loading) return <div className="auth-page"><p role="status">Opening your inventory…</p></div>;
  async function logout() { await request('/auth/logout', { method: 'POST', body: '{}' }); clear(); }
  if (user) return children(user, logout);
  const signup = path === '/signup';
  const field = (name, label, type = 'text', autoComplete) => <label key={name}>{label}<input name={name} type={type} autoComplete={autoComplete} value={form[name]} required minLength={name === 'username' ? 3 : name === 'password' && signup ? 8 : undefined} maxLength={name === 'password' || name === 'confirmPassword' ? 72 : 254} onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}/></label>;
  async function submit(e) {
    e.preventDefault(); setError('');
    if (signup && form.password !== form.confirmPassword) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const body = signup ? { fullName: form.fullName, username: form.username, email: form.email, password: form.password, confirmPassword: form.confirmPassword } : { identifier: form.identifier, password: form.password };
      const data = await request(signup ? '/auth/signup' : '/auth/login', { method: 'POST', body: JSON.stringify(body) });
      setForm({ fullName: '', username: '', email: '', password: '', confirmPassword: '', identifier: '' }); setUser(data.user); navigate('/');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <div className="auth-page"><div className="auth-card"><a className="brand" href="/login">stockvoice.</a><h1>{signup ? 'Create your account' : 'Welcome back'}</h1><p className="muted">{signup ? 'Your inventory, saved in your account.' : 'Log in to your store inventory.'}</p><form onSubmit={submit}>
    {signup ? <>{field('fullName', 'Full Name', 'text', 'name')}{field('username', 'Username', 'text', 'username')}{field('email', 'Email', 'email', 'email')}</> : field('identifier', 'Email or Username', 'text', 'username')}
    {field('password', 'Password', 'password', signup ? 'new-password' : 'current-password')}
    {signup && <>{field('confirmPassword', 'Confirm Password', 'password', 'new-password')}<p className="muted small">At least 8 characters, including a letter and a number.</p></>}
    {error && <p className="error" role="alert">{error}</p>}
    <button className="button primary" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create Account' : 'Login'}</button>
  </form><p className="small">{signup ? 'Already have an account?' : "Don’t have an account?"} <button className="text-button" disabled={busy} onClick={() => { setError(''); setForm(f => ({ ...f, password: '', confirmPassword: '' })); navigate(signup ? '/login' : '/signup'); }}>{signup ? 'Login' : 'Create Account'}</button></p></div></div>;
}
