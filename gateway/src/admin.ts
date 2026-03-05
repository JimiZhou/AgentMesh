import type { FastifyInstance } from 'fastify';

export async function registerAdminRoutes(app: FastifyInstance, deps: {
  requireSession: (req: any, reply: any) => any;
  touchSession: (s: any) => void;
  setAuthCookie: (req: any, reply: any, sid: string, exp: number) => void;
  clearAuthCookie: (req: any, reply: any) => void;
  checkCsrf: (req: any, reply: any, session: any) => boolean;
  cfgWebUser: () => string;
  verifyWebPassword: (rawPassword: string) => boolean;
  cfgTotpEnabled: () => boolean;
  cfgTotpProvisioned: () => boolean;
  cfgTotpSecret: () => string;
  cfgTotpIssuer: () => string;
  totpVerify: (secretBase32: string, token: string) => boolean;
  setAuthConfig: (next: { user?: string; password?: string }) => void;
  setTotpConfig: (next: { enabled?: boolean; provisioned?: boolean; secretBase32?: string; issuer?: string }) => void;
  reloadConfig: () => any;
}) {
  app.get('/api/admin/settings', async (req, reply) => {
    const session = deps.requireSession(req, reply);
    if (!session) return;
    deps.touchSession(session);
    deps.setAuthCookie(req, reply, session.id, session.expiresAt);

    return {
      ok: true,
      web: {
        user: deps.cfgWebUser(),
        totp: {
          enabled: deps.cfgTotpEnabled(),
          provisioned: deps.cfgTotpProvisioned(),
          issuer: deps.cfgTotpIssuer(),
          configured: !!deps.cfgTotpSecret(),
        },
      },
    };
  });

  app.post('/api/admin/auth/change', async (req, reply) => {
    const session = deps.requireSession(req, reply);
    if (!session) return;
    if (!deps.checkCsrf(req, reply, session)) return;

    const body = (req.body || {}) as any;
    const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';
    const newUser = typeof body.newUser === 'string' ? body.newUser.trim() : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (!deps.verifyWebPassword(oldPassword)) {
      reply.code(401);
      return { ok: false, error: 'invalid password' };
    }

    if (newUser && newUser.length < 2) {
      reply.code(400);
      return { ok: false, error: 'username too short' };
    }

    if (newPassword && newPassword.length < 12) {
      reply.code(400);
      return { ok: false, error: 'password too short (min 12)' };
    }

    if (!newUser && !newPassword) {
      reply.code(400);
      return { ok: false, error: 'no changes provided' };
    }

    deps.setAuthConfig({
      user: newUser || undefined,
      password: newPassword || undefined,
    });

    // Force re-login
    deps.clearAuthCookie(req, reply);
    return { ok: true, relogin: true };
  });

  app.post('/api/admin/totp/disable', async (req, reply) => {
    const session = deps.requireSession(req, reply);
    if (!session) return;
    if (!deps.checkCsrf(req, reply, session)) return;

    const body = (req.body || {}) as any;
    const password = typeof body.password === 'string' ? body.password : '';
    const totp = typeof body.totp === 'string' ? body.totp.trim() : '';

    if (!deps.verifyWebPassword(password)) {
      reply.code(401);
      return { ok: false, error: 'invalid password' };
    }

    const secret = deps.cfgTotpSecret();
    if (deps.cfgTotpEnabled() && deps.cfgTotpProvisioned() && secret) {
      if (!deps.totpVerify(secret, totp)) {
        reply.code(401);
        return { ok: false, error: 'invalid totp' };
      }
    }

    deps.setTotpConfig({ enabled: false, provisioned: false, secretBase32: '' });
    return { ok: true };
  });

  app.post('/api/admin/totp/enable', async (req, reply) => {
    const session = deps.requireSession(req, reply);
    if (!session) return;
    if (!deps.checkCsrf(req, reply, session)) return;

    const body = (req.body || {}) as any;
    const password = typeof body.password === 'string' ? body.password : '';

    if (!deps.verifyWebPassword(password)) {
      reply.code(401);
      return { ok: false, error: 'invalid password' };
    }

    // enabling requires (re)setup
    deps.setTotpConfig({ enabled: true, provisioned: false, secretBase32: '' });
    deps.clearAuthCookie(req, reply);
    return { ok: true, relogin: true, needSetup: true };
  });

  app.post('/api/admin/totp/reset', async (req, reply) => {
    const session = deps.requireSession(req, reply);
    if (!session) return;
    if (!deps.checkCsrf(req, reply, session)) return;

    const body = (req.body || {}) as any;
    const password = typeof body.password === 'string' ? body.password : '';
    const totp = typeof body.totp === 'string' ? body.totp.trim() : '';

    if (!deps.verifyWebPassword(password)) {
      reply.code(401);
      return { ok: false, error: 'invalid password' };
    }

    const secret = deps.cfgTotpSecret();
    if (deps.cfgTotpEnabled() && deps.cfgTotpProvisioned() && secret) {
      if (!deps.totpVerify(secret, totp)) {
        reply.code(401);
        return { ok: false, error: 'invalid totp' };
      }
    }

    deps.setTotpConfig({ enabled: true, provisioned: false, secretBase32: '' });
    deps.clearAuthCookie(req, reply);
    return { ok: true, relogin: true, needSetup: true };
  });
}
