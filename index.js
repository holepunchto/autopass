// the js module powering the mobile and desktop app

const Autobase = require('autobase')
const BlindPairing = require('blind-pairing')
const HyperDB = require('hyperdb')
const Hyperswarm = require('hyperswarm')
const ReadyResource = require('ready-resource')
const z32 = require('z32')
const b4a = require('b4a')
const { Router, dispatch } = require('./spec/hyperdispatch')
const db = require('./spec/db/index.js')

class AutopassPairer extends ReadyResource {
  constructor (store, invite, opts = {}) {
    super()
    this.store = store
    this.invite = invite
    this.swarm = null
    this.pairing = null
    this.candidate = null
    this.bootstrap = opts.bootstrap || null
    this.onresolve = null
    this.onreject = null
    this.pass = null

    this.ready().catch(noop)
  }

  async _open () {
    await this.store.ready()
    this.swarm = new Hyperswarm({
      keyPair: await this.store.createKeyPair('hyperswarm'),
      bootstrap: this.bootstrap
    })

    const store = this.store
    this.swarm.on('connection', (connection, peerInfo) => {
      store.replicate(connection)
    })

    this.pairing = new BlindPairing(this.swarm)
    const core = Autobase.getLocalCore(this.store)
    await core.ready()
    const key = core.key
    await core.close()
    this.candidate = this.pairing.addCandidate({
      invite: z32.decode(this.invite),
      userData: key,
      onadd: async (result) => {
        if (this.pass === null) {
          this.pass = new Autopass(this.store, {
            swarm: this.swarm,
            key: result.key,
            encryptionKey: result.encryptionKey,
            bootstrap: this.bootstrap
          })
        }
        this.swarm = null
        this.store = null
        if (this.onresolve) this.onresolve(this.pass)
        this.candidate.close().catch(noop)
      }
    })
  }

  async _close () {
    if (this.candidate !== null) {
      await this.candidate.close()
    }

    if (this.swarm !== null) {
      await this.swarm.destroy()
    }

    if (this.store !== null) {
      await this.store.close()
    }

    if (this.onreject) {
      this.onreject(new Error('Pairing closed'))
    } else if (this.base) {
      await this.base.close()
    }
  }

  finished () {
    return new Promise((resolve, reject) => {
      this.onresolve = resolve
      this.onreject = reject
    })
  }
}

class Autopass extends ReadyResource {
  constructor (corestore, opts = {}) {
    super()
    this.router = new Router()
    this.store = corestore
    this.swarm = opts.swarm || null
    this.base = null
    this.bootstrap = opts.bootstrap || null
    this.member = null
    this.pairing = null
    this.replicate = opts.replicate !== false
    this.debug = !!opts.key
    // Register handlers for commands
    this.router.add('@autopass-namespace/removeWriter', async (data, context) => {
      await context.base.removeWriter(z32.decode(data))
      return { success: true }
    })

    this.router.add('@autopass-namespace/addWriter', async (data, context) => {
      await context.base.addWriter(z32.decode(data.value))
      return { success: true }
    })

    this.router.add('@autopass-namespace/put', async (data, context) => {
      await context.view.insert('@autopass-namespace/autopass', data)
      await context.view.flush()
      return { success: true }
    })

    this.router.add('@autopass-namespace/del', async (data, context) => {
      await context.view.delete('@autopass-namespace/autopass', { key: data.key })
      await context.view.flush()
      return { success: true }
    })

    this.router.add('@autopass-namespace/addInvite', async (data, context) => {
      await context.view.insert('@autopass-namespace/invite', data)
      await context.view.flush()
      return { success: true }
    })

    this._boot(opts)
    this.ready().catch(noop)
  }

  // Initialize autobase
  _boot (opts = {}) {
    const { encryptionKey, key } = opts

    this.base = new Autobase(this.store, key, {
      encrypt: true,
      encryptionKey,
      open (store) {
        return HyperDB.bee(store.get('view'), db, {
          extension: false,
          autoUpdate: true
        })
      },
      // New data blocks will be added using the apply function
      apply: this._apply.bind(this)
    })

    this.base.on('update', () => {
      this.emit('update')
    })
  }

  async _apply (nodes, view, base) {
    for (const node of nodes) {
      await this.router.dispatch(node.value, { view, base })
    }
  }

  async _open () {
    await this.base.ready()
    if (this.replicate) await this._replicate()
  }

  async _close () {
    if (this.swarm) {
      await this.member.close()
      await this.pairing.close()
      await this.swarm.destroy()
    }
    await this.base.close()
  }

  get writerKey () {
    return this.base.local.key
  }

  get key () {
    return this.base.key
  }

  get discoveryKey () {
    return this.base.discoveryKey
  }

  get encryptionKey () {
    return this.base.encryptionKey
  }

  static pair (store, invite, opts) {
    return new AutopassPairer(store, invite, opts)
  }

  async createInvite (opts) {
    if (this.opened === false) await this.ready()
    const existing = await this.base.view.findOne('@autopass-namespace/invite', {})
    if (existing) {
      return existing.invite
    }
    const { id, invite, publicKey, expires } = BlindPairing.createInvite(this.base.key)

    const record = { id: z32.encode(id), invite: z32.encode(invite), publicKey: z32.encode(publicKey), expires }
    await this.base.append(dispatch('@autopass-namespace/addInvite', record))
    return record.invite
  }

  list (opts) {
    const queryStreams = this.base.view.find('@autopass-namespace/autopass', {})
    return queryStreams
  }

  async get (key) {
    const queryStreams = await this.base.view.get('@autopass-namespace/autopass', { key })
    const data = await queryStreams
    if (data === null) {
      return null
    }
    return data.value
  }

  async addWriter (key) {
    const mm = b4a.isBuffer(key) ? z32.encode(key) : key
    await this.base.append(dispatch('@autopass-namespace/addWriter', { key: '', value: mm }))

    return true
  }

  async removeWriter (key) {
    await this.base.append(dispatch('@autopass-namespace/removeWriter', b4a.isBuffer(key) ? z32.encode(key) : key))
  }

  get writable () {
    return this.base.writable
  }

  async _replicate () {
    await this.base.ready()
    if (this.swarm === null) {
      this.swarm = new Hyperswarm({
        keyPair: await this.store.createKeyPair('hyperswarm'),
        bootstrap: this.bootstrap
      })
      this.swarm.on('connection', (connection, peerInfo) => {
        this.store.replicate(connection)
      })
    }
    this.pairing = new BlindPairing(this.swarm)
    this.member = this.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: async (candidate) => {
        const id = z32.encode(candidate.inviteId)
        const inv = await this.base.view.findOne('@autopass-namespace/invite', {})
        if (inv.id !== id) {
          return
        }
        candidate.open(z32.decode(inv.publicKey))
        await this.addWriter(candidate.userData)
        candidate.confirm({
          key: this.base.key,
          encryptionKey: this.base.encryptionKey
        })
      }
    })
    await this.member.flushed()
    await this.swarm.join(this.base.discoveryKey)
  }

  async add (key, value) {
    await this.base.append(dispatch('@autopass-namespace/put', { key, value }))
  }

  async remove (key) {
    await this.base.append(dispatch('@autopass-namespace/del', { key, value: '' }))
  }
} // end class

function noop () {}

module.exports = Autopass
