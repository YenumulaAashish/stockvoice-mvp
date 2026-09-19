import request from 'supertest';
export const jwtSecret = 'test-only-secret-not-a-production-secret-123456';
export async function register(app, suffix = 'one') {
  const agent = request.agent(app);
  const body = { fullName: `Test ${suffix}`, username: `user_${suffix}`, email: `${suffix}@example.com`, password: 'Testpass123', confirmPassword: 'Testpass123' };
  const result = await agent.post('/api/auth/signup').send(body).expect(201);
  return { agent, user: result.body.user, body, cookie: result.headers['set-cookie'][0].split(';')[0] };
}
export async function seedOwner(store, ownerId) {
  await store.mutate(state => { state.products = state.products.map(p => ({ ...p, ownerId })); });
}
