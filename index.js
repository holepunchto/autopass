// the js module powering the mobile and desktop app

const Autobase = require('autobase')
const BlindPairing = require('blind-pairing')
const Hyperbee = require('hyperbee')
const Hyperswarm = require('hyperswarm')
const ReadyResource = require('ready-resource')
const z32 = require('z32')
const b4a = require('b4a')

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

    this.swarm.on('connection', (connection, peerInfo) => {
      this.store.replicate(connection)
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

    this.store = corestore
    this.swarm = opts.swarm || null
    this.base = null
    this.bootstrap = opts.bootstrap || null
    this.member = null
    this.pairing = null
    this.replicate = opts.replicate !== false
    this.debug = !!opts.key

    this._boot(opts)
    this.ready().catch(noop)
  }

  // Initialize autobase
  _boot (opts = {}) {
    const { encryptionKey, key } = opts

    this.base = new Autobase(this.store, key, {
      encrypt: true,
      encryptionKey,
      valueEncoding: 'json',
      open (store) {
        return new Hyperbee(store.get('view'), {
          extension: false,
          keyEncoding: 'utf-8',
          valueEncoding: 'json'
        })
      },
      // New data blocks will be added using the apply function
      async apply (nodes, view, base) {
        for (const node of nodes) {
          const op = node.value

          // Add support for adding other peers as a writer to the base
          if (op.type === 'addWriter') {
            await base.addWriter(z32.decode(op.key))
          } else if (op.type === 'removeWriter') {
            await base.removeWriter(z32.decode(op.key))
          } else if (op.type === 'addRecord') {
            // This adds a new record
            await view.put(op.key, op.value)
          } else if (op.type === 'removeRecord') {
            // Remove an existing record
            await view.del(op.key)
          }
        }
      }
    })

    this.base.on('update', () => this.emit('update'))
  }

  async _open () {
    await this.base.ready()
    if (this.replicate) await this._replicate()
  }

  // Close the base
  async _close () {
    if (this.swarm) {
      await this.member.close()
      await this.pairing.close()
      await this.swarm.destroy()
    }
    await this.base.close()
  }

  // Need this key to become a writer
  get writerKey () {
    return this.base.local.key
  }

  // Return bootstrap key of the base
  // This is what other peers should use to bootstrap the base from
  get key () {
    return this.base.key
  }

  // Find peers in Hyperswarm using this
  get discoveryKey () {
    return this.base.discoveryKey
  }

  // Encryption key for the base
  get encryptionKey () {
    return this.base.encryptionKey
  }

  static pair (store, invite, opts) {
    return new AutopassPairer(store, invite, opts)
  }

  async createInvite (opts) {
    if (this.opened === false) await this.ready()
    const existing = await this.get('autopass/invite')
    if (existing) return existing.invite
    const { id, invite, publicKey, expires } = BlindPairing.createInvite(this.base.key)
    const record = { id: z32.encode(id), invite: z32.encode(invite), publicKey: z32.encode(publicKey), expires }
    await this.add('autopass/invite', record)
    return record.invite
  }

  // Get data of all indexes in the base
  list (opts) {
    return this.base.view.createReadStream(opts)
  }

  // Get data stored in a specific key
  async get (key) {
    const node = await this.base.view.get(key)
    if (node === null) return null
    return node.value
  }

  // Add a peer as a writer
  async addWriter (key) {
    await this.base.append({
      type: 'addWriter',
      key: b4a.isBuffer(key) ? z32.encode(key) : key
    })

    return true
  }

  // To later add removeWriter
  async removeWriter (key) {
    await this.base.append({
      type: 'removeWriter',
      key: b4a.isBuffer(key) ? z32.encode(key) : key
    })
  }

  // Check if the base is writable
  get writable () {
    return this.base.writable
  }

  // Start Replicating the base across peers
  async _replicate () {
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
        const inv = await this.get('autopass/invite')

        if (inv.id !== id) return

        candidate.open(z32.decode(inv.publicKey))

        await this.addWriter(candidate.userData)

        candidate.confirm({
          key: this.base.key,
          encryptionKey: this.base.encryptionKey
        })
      }
    })

    this.swarm.join(this.base.discoveryKey)
  }

  // Append a key/value to the base
  async add (key, value) {
    await this.base.append({
      type: 'addRecord',
      key,
      value
    })
  }

  // Remove a key pair
  async remove (key) {
    await this.base.append({
      type: 'removeRecord',
      key,
      value: null
    })
  }
} // end class

function noop () {}

module.exports = Autopass
