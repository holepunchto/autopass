const test = require('brittle')
const Autopass = require('./')
const Corestore = require('corestore')
const testnet = require('hyperdht/testnet')
const tmp = require('test-tmp')

test('basic', async function (t) {
  const a = await create(t, { replicate: false })

  await a.add('hello', 'world')

  t.ok(a.base.encryptionKey)
  t.is(await a.get('hello'), 'world')

  await a.close()
})

test('invites', async function (t) {
  t.plan(2)

  const tn = await testnet(10, t)

  const a = await create(t, { bootstrap: tn.bootstrap })
  t.teardown(() => {
    a.close()
    a.removeListener('update', onUpdate)
  })

  const onUpdate = function () {
    if (a.base.system.members === 2) t.pass('a has two members')
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
    a.removeListener('update', updateListener) // Remove the listener in teardown
  })

  const updateListener = function () {
    if (a.base.system.members === 2) t.pass('a has two members')
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
  const a = new Autopass(new Corestore(dir), opts)
  await a.ready()
  return a
}

async function pair(t, inv, opts) {
  const dir = await tmp(t)
  const a = Autopass.pair(new Corestore(dir), inv, opts)
  return a
}
