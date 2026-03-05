export async function registerAdminRoutes(app, deps) {
    app.get('/api/admin/settings', async (req, reply) => {
        const session = deps.requireSession(req, reply);
        if (!session)
            return;
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
        if (!session)
            return;
        if (!deps.checkCsrf(req, reply, session))
            return;
        const body = (req.body || {});
        const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';
        const newUser = typeof body.newUser === 'string' ? body.newUser.trim() : '';
        const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
        if (oldPassword !== deps.cfgWebPassword()) {
            reply.code(401);
            return { ok: false, error: 'invalid password' };
        }
        if (newUser && newUser.length < 2) {
            reply.code(400);
            return { ok: false, error: 'username too short' };
        }
        if (newPassword && newPassword.length < 6) {
            reply.code(400);
            return { ok: false, error: 'password too short' };
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
        if (!session)
            return;
        if (!deps.checkCsrf(req, reply, session))
            return;
        const body = (req.body || {});
        const password = typeof body.password === 'string' ? body.password : '';
        const totp = typeof body.totp === 'string' ? body.totp.trim() : '';
        if (password !== deps.cfgWebPassword()) {
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
        if (!session)
            return;
        if (!deps.checkCsrf(req, reply, session))
            return;
        const body = (req.body || {});
        const password = typeof body.password === 'string' ? body.password : '';
        if (password !== deps.cfgWebPassword()) {
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
        if (!session)
            return;
        if (!deps.checkCsrf(req, reply, session))
            return;
        const body = (req.body || {});
        const password = typeof body.password === 'string' ? body.password : '';
        const totp = typeof body.totp === 'string' ? body.totp.trim() : '';
        if (password !== deps.cfgWebPassword()) {
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
