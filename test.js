const test = require('brittle')
const Autopass = require('./')
const Corestore = require('corestore')
const testnet = require('hyperdht/testnet')
const tmp = require('test-tmp')
const b4a = require('b4a')
const { encode } = require('./spec/hyperdispatch')

test('basic', async function (t) {
  const a = await create(t, { replicate: false })

  await a.add('hello', 'world')

  t.ok(a.encryptionKey)
  t.is((await a.get('hello')).value, 'world')

  await a.close()
})

test('decryption fails gracefully with wrong key', async function (t) {
  const dir = await tmp(t)
  const a = new Autopass(new Corestore(dir), { encryptionKey: 'correct' })
  await a.ready()
  await a.add('secret', 'value')
  await a.close()

  const b = new Autopass(new Corestore(dir), { encryptionKey: 'wrong' })
  await b.ready()
  const result = await b.get('secret')
  t.is(result.value, null)
  await b.close()
})

test('keyProvider persists generated key', async function (t) {
  const dir = await tmp(t)
  let stored = null
  let setCalled = false
  const provider = {
    async getKey() {
      return stored
    },
    async setKey(key) {
      stored = key
      setCalled = true
    },
    async clearKey() {
      stored = null
    }
  }

  const a = new Autopass(new Corestore(dir), { keyProvider: provider })
  await a.ready()
  await a.add('hello', 'provider')
  await a.close()

  const b = new Autopass(new Corestore(dir), { keyProvider: provider })
  await b.ready()
  t.ok(setCalled)
  t.is((await b.get('hello')).value, 'provider')
  await b.close()
})

test('plaintext compatibility', async function (t) {
  const dir = await tmp(t)
  const a = new Autopass(new Corestore(dir), { encryptionKey: 'compat' })
  await a.ready()
  await a.base.append(encode('@autopass/put', { key: 'plain', value: 'text' }))
  t.is((await a.get('plain')).value, 'text')
  await a.close()
})

test('invites', async function (t) {
  t.plan(2)

  const tn = await testnet(10, t)

  const a = await create(t, { bootstrap: tn.bootstrap })
  t.teardown(() => {
    a.close()
  })

  const onUpdate = function () {
    if (a.base.system.members === 2) {
      t.pass('a has two members')
      a.removeListener('update', onUpdate)
    }
  }

  a.on('update', onUpdate)

  const inv = await a.createInvite()

  const p = await pair(t, inv, { bootstrap: tn.bootstrap })

  const b = await p.finished()
  await b.ready()

  t.teardown(() => b.close())
  b.on('update', function () {
    if (b.base.system.members === 2) t.pass('b has two members')
  })
})

test('invites', async function (t) {
  t.plan(2)

  const tn = await testnet(10, t)

  const a = await create(t, { bootstrap: tn.bootstrap })
  t.teardown(() => {
    a.close()
  })

  const updateListener = function () {
    if (a.base.system.members === 2) {
      t.pass('a has two members')
      a.removeListener('update', updateListener) // Remove the listener in teardown
    }
  }

  a.on('update', updateListener)

  const inv = await a.createInvite()

  const p = await pair(t, inv, { bootstrap: tn.bootstrap })

  const b = await p.finished()
  await b.ready()

  t.teardown(() => b.close())
  b.on('update', function () {
    if (b.base.system.members === 2) t.pass('b has two members')
  })
})

test('suspend and resume', async function (t) {
  t.plan(3)

  const tn = await testnet(2, t)

  const a = await create(t, { bootstrap: tn.bootstrap })
  const inv = await a.createInvite()
  t.teardown(() => a.close())

  const p = await pair(t, inv, { bootstrap: tn.bootstrap })
  const b = await p.finished()
  await b.ready()
  t.teardown(() => b.close())

  await new Promise((resolve) => {
    const check = () => {
      if (a.swarm.peers.size > 0 && b.swarm.peers.size > 0) {
        resolve()
      } else {
        setTimeout(check, 100)
      }
    }
    check()
  })

  t.ok(a.swarm.peers.size > 0, 'a has peers before suspend')

  await a.suspend()

  t.is(a.swarm.peers.size, 0, 'a has 0 peers after suspend')

  await a.resume()

  await new Promise((resolve) => {
    const check = () => {
      if (a.swarm.peers.size > 0) {
        resolve()
      } else {
        setTimeout(check, 100)
      }
    }
    check()
  })

  t.ok(a.swarm.peers.size > 0, 'a has peers after resume')
})

async function create(t, opts) {
  const dir = await tmp(t)
  const a = new Autopass(new Corestore(dir), {
    encryptionKey: b4a.from('test-encryption-key'),
    ...opts
  })
  await a.ready()
  return a
}

async function pair(t, inv, opts) {
  const dir = await tmp(t)
  const a = Autopass.pair(new Corestore(dir), inv, opts)
  return a
}
