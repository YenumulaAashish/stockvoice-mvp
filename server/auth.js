import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fail } from './rules.js';

const publicUser = ({ id, fullName, username, email, emailVerified }) => ({ id, fullName, username, email, emailVerified });
const cookieName = 'stockvoice_auth';
const getCookie = req => req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
const signupSchema = z.object({
  fullName: z.string().trim().min(1).max(80),
  username: z.string().trim().toLowerCase().min(3).max(32).regex(/^[a-z0-9_.-]+$/, 'Use letters, numbers, dots, underscores or hyphens.'),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(72).regex(/[a-z]/i, 'Include a letter.').regex(/[0-9]/, 'Include a number.').refine(s => Buffer.byteLength(s, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes.'),
  confirmPassword: z.string()
}).strict().refine(v => v.password === v.confirmPassword, { message: 'Passwords do not match.', path: ['confirmPassword'] });

export function installAuth(app, store, config) {
  if (!config.jwtSecret || config.jwtSecret.length < 32) throw new Error('Set JWT_SECRET to a random secret of at least 32 characters.');
  const cookies = { httpOnly: true, sameSite: 'lax', secure: Boolean(config.production), path: '/' };
  const options = { algorithms: ['HS256'], issuer: 'stockvoice', audience: 'stockvoice-web' };
  const dummyHash = bcrypt.hashSync(randomUUID(), 10);
  function issue(res, user) {
    const token = jwt.sign({ version: user.authVersion }, config.jwtSecret, { algorithm: 'HS256', issuer: options.issuer, audience: options.audience, subject: user.id, expiresIn: '7d' });
    res.cookie(cookieName, token, { ...cookies, maxAge: 7 * 86400000 });
  }
  const requireAuth = async (req, res, next) => {
    let claims;
    try { claims = jwt.verify(getCookie(req) || '', config.jwtSecret, options); }
    catch { return res.status(401).json({ error: 'Please log in to continue.' }); }
    const user = await store.users.findById(claims.sub);
    if (!user || user.authVersion !== claims.version) return res.status(401).json({ error: 'Please log in to continue.' });
    req.user = publicUser(user);
    req.owner = user.id;
    req.inventory = store.forOwner(user.id);
    next();
  };
  const limiter = rateLimit({ windowMs: 15 * 60000, limit: 30, message: { error: 'Too many login attempts. Please try again later.' } });
  app.post('/api/auth/signup', limiter, async (req, res) => {
    const data = signupSchema.parse(req.body);
    const now = new Date().toISOString();
    const user = { id: randomUUID(), fullName: data.fullName, username: data.username, email: data.email, passwordHash: await bcrypt.hash(data.password, 10), emailVerified: false, authVersion: 0, createdAt: now, updatedAt: now };
    try { await store.users.create(user); }
    catch (error) { if (error.code === 11000) fail('An account with that email or username already exists.', 409); throw error; }
    issue(res, user);
    res.status(201).json({ user: publicUser(user) });
  });
  app.post('/api/auth/login', limiter, async (req, res) => {
    const data = z.object({ identifier: z.string().trim().min(1).max(254), password: z.string().min(1).max(72).refine(s => Buffer.byteLength(s, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes.') }).strict().parse(req.body);
    const user = await store.users.findByIdentifier(data.identifier.toLowerCase());
    const matches = await bcrypt.compare(data.password, user?.passwordHash || dummyHash);
    if (!user || !matches) fail('Invalid email/username or password.', 401);
    issue(res, user);
    res.json({ user: publicUser(user) });
  });
  app.post('/api/auth/logout', async (req, res) => {
    let claims;
    try { claims = jwt.verify(getCookie(req) || '', config.jwtSecret, options); } catch { /* Clear expired cookies too. */ }
    if (claims) await store.users.revoke(claims.sub, claims.version);
    res.clearCookie(cookieName, cookies);
    res.status(204).end();
  });
  app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));
  app.use('/api', requireAuth);
}
