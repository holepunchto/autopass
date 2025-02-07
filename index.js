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
        if (this.onresolve) this._whenWritable()
        this.candidate.close().catch(noop)
      }
    })
  }

  _whenWritable () {
    if (this.pass.base.writable) return
    const check = () => {
      if (this.pass.base.writable) {
        this.pass.base.off('update', check)
        this.onresolve(this.pass)
      }
    }
    this.pass.base.on('update', check)
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
    this.router.add('@autopass/remove-writer', async (data, context) => {
      await context.base.removeWriter(data.key)
    })

    this.router.add('@autopass/add-writer', async (data, context) => {
      await context.base.addWriter(data.key)
    })

    this.router.add('@autopass/put', async (data, context) => {
      await context.view.insert('@autopass/records', data)
    })

    this.router.add('@autopass/del', async (data, context) => {
      await context.view.delete('@autopass/records', { key: data.key })
    })

    this.router.add('@autopass/add-invite', async (data, context) => {
      await context.view.insert('@autopass/invite', data)
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
    await view.flush()
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
    const existing = await this.base.view.findOne('@autopass/invite', {})
    if (existing) {
      return z32.encode(existing.invite)
    }
    const { id, invite, publicKey, expires } = BlindPairing.createInvite(this.base.key)

    const record = { id, invite, publicKey, expires }
    await this.base.append(dispatch('@autopass/add-invite', record))
    return z32.encode(record.invite)
  }

  list (opts) {
    return this.base.view.find('@autopass/records', {})
  }

  async get (key) {
    const data = await this.base.view.get('@autopass/records', { key })
    if (data === null) {
      return null
    }
    return data.value
  }

  async addWriter (key) {
    await this.base.append(dispatch('@autopass/add-writer', { key: b4a.isBuffer(key) ? key : b4a.from(key) }))
    return true
  }

  async removeWriter (key) {
    await this.base.append(dispatch('@autopass/remove-writer', { key: b4a.isBuffer(key) ? key : b4a.from(key) }))
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
        const id = candidate.inviteId
        const inv = await this.base.view.findOne('@autopass/invite', {})
        if (!b4a.equals(inv.id, id)) {
          return
        }
        candidate.open(inv.publicKey)
        await this.addWriter(candidate.userData)
        candidate.confirm({
          key: this.base.key,
          encryptionKey: this.base.encryptionKey
        })
      }
    })
    this.swarm.join(this.base.discoveryKey)
  }

  async add (key, value) {
    await this.base.append(dispatch('@autopass/put', { key, value }))
  }

  async remove (key) {
    await this.base.append(dispatch('@autopass/del', { key }))
  }
} // end class

function noop () {}

module.exports = Autopass
