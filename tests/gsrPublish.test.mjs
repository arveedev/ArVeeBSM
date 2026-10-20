import test from 'node:test'
import assert from 'node:assert/strict'

const mkRes = () => {
  const r = { code: 0, body: null }
  r.status = (c) => { r.code = c; return r }
  r.json = (b) => { r.body = b; return r }
  return r
}

test('the GSR publish function: gate, allow-list, token added on the server, errors passed on', async () => {
  process.env.VITE_APP_SHARED_KEY = 'key1'
  process.env.GSR_SCRIPT_URL = 'https://script.example/exec'
  process.env.GSR_SCRIPT_TOKEN = 'secret-token'
  const { default: handler } = await import('../api/gsr-publish.js')
  const sent = []
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) })
    return { status: 200, json: async () => (sent.at(-1).body.action === 'create' ? { ok: true, files: [] } : { ok: false, error: 'folder missing' }) }
  }
  const call = async (headers, body, method = 'POST') => { const res = mkRes(); await handler({ method, headers, body }, res); return res }

  assert.equal((await call({}, { action: 'ping' }, 'GET')).code, 405)
  assert.equal((await call({ 'x-bsm-app-key': 'wrong' }, { action: 'ping' })).code, 401)
  assert.equal((await call({ 'x-bsm-app-key': 'key1' }, { action: 'delete' })).code, 400)

  const ok = await call({ 'x-bsm-app-key': 'key1' }, { action: 'create', token: 'forged', files: [] })
  assert.equal(ok.code, 200)
  assert.equal(sent[0].body.token, 'secret-token', 'the token comes from the server, never from the browser')
  assert.equal(sent[0].url, 'https://script.example/exec')

  const refused = await call({ 'x-bsm-app-key': 'key1' }, { action: 'read', fileId: 'x' })
  assert.equal(refused.code, 502)
  assert.match(refused.body.detail, /folder missing/)
})
