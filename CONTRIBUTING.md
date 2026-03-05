# Contributing

## Development

Node.js 22+ is required.

1. Install dependencies:
   - `cd gateway && npm ci`
   - `cd runner && npm ci`
2. Build both packages before opening a PR:
   - `cd gateway && npm run build`
   - `cd runner && npm run build`
3. Run tests from repo root:
   - `node --test tests/*.test.mjs`

## Security Rules

- Do not commit runtime secrets:
  - `gateway/data/config.json`
  - `gateway/data/state.json`
  - `runner/data/identity.json`
- Use the `*.example.json` files as templates for local setup.
- Keep password handling hashed only (`web.passwordHash`), never plaintext.

## Pull Request Checklist

- Build passes for both `gateway` and `runner`.
- `node --test tests/*.test.mjs` passes.
- New/changed APIs are documented.
- Security impact is called out when auth, sessions, WS, or token flow changes.
