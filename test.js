const test = require('brittle')
const Autopass = require('./')
const Corestore = require('corestore')
const testnet = require('hyperdht/testnet')
const tmp = require('test-tmp')
const b4a = require('b4a')
const BlindEncryptionSodium = require('blind-encryption-sodium')

test('basic', async function (t) {
  const a = await create(t, { replicate: false })

  await a.add('hello', 'world')

  t.ok(a.base.encryptionKey)
  t.is((await a.get('hello')).value, 'world')

  await a.close()
})

test('invites', async function (t) {
  t.plan(2)

  const tn = await testnet(10, t)

  const a = await create(t, { bootstrap: tn.bootstrap })
  t.teardown(async () => {
    await a.close()
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

  t.teardown(async () => await b.close())
  await updateUntil(b, () => b.base.system.members === 2)
  t.pass('b has two members')
})

test('invites', async function (t) {
  t.plan(2)

  const tn = await testnet(10, t)

  const a = await create(t, { bootstrap: tn.bootstrap })
  t.teardown(async () => {
    await a.close()
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

  t.teardown(async () => await b.close())
  await updateUntil(b, () => b.base.system.members === 2)
  t.pass('b has two members')
})

test.solo('invite with name', async function (t) {
  t.plan(3)

  const tn = await testnet(10, t)

  const a = await create(t, { bootstrap: tn.bootstrap })
  t.teardown(async () => {
    await a.close()
  })

  const updateListener = function () {
    if (a.base.system.members === 2) {
      t.pass('a has two members')
      a.removeListener('update', updateListener) // Remove the listener in teardown
    }
  }

  a.on('update', updateListener)

  const inv = await a.createInvite()

  const p = await pair(t, inv, { bootstrap: tn.bootstrap, name: 'maf' })

  const b = await p.finished()
  await b.ready()

  t.teardown(async () => await b.close())
  await updateUntil(b, () => b.base.system.members === 2)
  t.pass('b has two members')
  const arr = await b.listWriters().toArray()
  t.is(arr[0].name, 'maf')
})

test('invite resets when createInvite type is different than previous', async function (t) {
  t.plan(1)

  const tn = await testnet(10, t)

  const a = await create(t, { bootstrap: tn.bootstrap })
  t.teardown(async () => {
    await a.close()
  })

  const inv = await a.createInvite()
  const invReadOnly = await a.createInvite({ readOnly: true })

  if (inv !== invReadOnly) {
    t.pass('invite is reset ')
  } else {
    t.fail()
  }
})

test('blind encryption', async function (t) {
  t.plan(4)

  const password = b4a.alloc(32, 'password')
  const tn = await testnet(10, t)

  const a = await create(t, {
    bootstrap: tn.bootstrap,
    blindEncryption: new BlindEncryptionSodium(password)
  })
  t.teardown(async () => {
    await a.close()
  })

  const updateListener = function () {
    if (a.base.system.members === 2) {
      t.pass('a has two members')
      a.removeListener('update', updateListener) // Remove the listener in teardown
    }
  }

  a.on('update', updateListener)

  const inv = await a.createInvite()

  const p = await pair(t, inv, {
    bootstrap: tn.bootstrap,
    blindEncryption: new BlindEncryptionSodium(password)
  })

  const b = await p.finished()
  await b.ready()

  const [encryptionKeyBuffer, encryptionKeyEncryptedBuffer] = await Promise.all([
    b.base.local.getUserData('autobase/encryption'),
    b.base.local.getUserData('autobase/blind-encryption')
  ])

  t.absent(encryptionKeyBuffer)
  t.ok(encryptionKeyEncryptedBuffer)

  t.teardown(async () => await b.close())
  await updateUntil(b, () => b.base.system.members === 2)
  if (b.base.system.members === 2) t.pass('b has two members')
})

test('suspend and resume', async function (t) {
  t.plan(3)

  const tn = await testnet(2, t)

  const a = await create(t, { bootstrap: tn.bootstrap })
  const inv = await a.createInvite()
  t.teardown(async () => await a.close())

  const p = await pair(t, inv, { bootstrap: tn.bootstrap })
  const b = await p.finished()
  await b.ready()
  t.teardown(async () => await b.close())

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

function updateUntil(b, fn) {
  return new Promise((resolve) => {
    if (fn()) return resolve()
    const check = () => {
      if (!fn()) return
      b.off('update', check)
      resolve()
    }
    b.on('update', check)
  })
}
