// the js module powering the mobile and desktop app

const Autobase = require('autobase')
const BlindPairing = require('blind-pairing')
const HyperDB = require('hyperdb')
const Hyperswarm = require('hyperswarm')
const Wakeup = require('protomux-wakeup')
const ReadyResource = require('ready-resource')
const z32 = require('z32')
const b4a = require('b4a')
const crypto = require('crypto')
const { Router, encode, decode } = require('./spec/hyperdispatch')
const BlindPeering = require('blind-peering')
const db = require('./spec/db/index.js')
const enc = require('hypercore-id-encoding')

const VALUE_PREFIX = 'ap01:'
const FILE_PREFIX = b4a.from('AP01')
const IV_BYTES = 12
const TAG_BYTES = 16
const ENCRYPTION_KEY_BYTES = 32
const DEFAULT_KDF_SALT = b4a.from('autopass-default-salt')

class InMemoryKeyProvider {
  constructor() {
    this._key = null
  }

  async getKey() {
    return this._key
  }

  async setKey(key) {
    this._key = key
  }

  async clearKey() {
    this._key = null
  }
}

function normalizeEncryptionKey(key, salt) {
  if (!key) return null
  const buf = b4a.isBuffer(key) ? key : b4a.from(String(key))
  if (buf.length === ENCRYPTION_KEY_BYTES) return buf
  const kdfSalt = salt || DEFAULT_KDF_SALT
  return crypto.scryptSync(buf, kdfSalt, ENCRYPTION_KEY_BYTES)
}

function encryptString(value, key) {
  if (value === null || value === undefined) return value
  if (typeof value !== 'string') {
    throw new Error('value must be a string when encryption is enabled')
  }
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const payload = Buffer.concat([iv, tag, ciphertext]).toString('base64')
  return VALUE_PREFIX + payload
}

function decryptString(value, key) {
  if (value === null || value === undefined) return value
  if (typeof value !== 'string' || !value.startsWith(VALUE_PREFIX)) return value
  try {
    const payload = Buffer.from(value.slice(VALUE_PREFIX.length), 'base64')
    const iv = payload.subarray(0, IV_BYTES)
    const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
    const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return plaintext.toString('utf8')
  } catch {
    return null
  }
}

function encryptBuffer(value, key) {
  if (!value) return value
  if (!b4a.isBuffer(value)) {
    throw new Error('file must be a buffer when encryption is enabled')
  }
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([FILE_PREFIX, iv, tag, ciphertext])
}

function decryptBuffer(value, key) {
  if (!value || !b4a.isBuffer(value)) return value
  if (value.length < FILE_PREFIX.length + IV_BYTES + TAG_BYTES) return value
  if (!b4a.equals(value.subarray(0, FILE_PREFIX.length), FILE_PREFIX)) return value
  try {
    const start = FILE_PREFIX.length
    const iv = value.subarray(start, start + IV_BYTES)
    const tag = value.subarray(start + IV_BYTES, start + IV_BYTES + TAG_BYTES)
    const ciphertext = value.subarray(start + IV_BYTES + TAG_BYTES)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    return null
  }
}

class AutopassPairer extends ReadyResource {
  constructor(store, invite, opts = {}) {
    super()
    this.store = store
    this.invite = invite
    this.swarm = null
    this.wakeup = null
    this.pairing = null
    this.peering = null
    this.candidate = null
    this.bootstrap = opts.bootstrap || null
    this.onresolve = null
    this.onreject = null
    this.pass = null
    this.relayThrough = opts.relayThrough || null
    this.encryptionKey = opts.encryptionKey || null
    this.keyProvider = opts.keyProvider || null

    this.ready().catch(noop)
  }

  async _open() {
    await this.store.ready()
    this.swarm = new Hyperswarm({
      keyPair: await this.store.createKeyPair('hyperswarm'),
      bootstrap: this.bootstrap,
      relayThrough: this.relayThrough
    })

    this.wakeup = new Wakeup()

    const store = this.store
    this.swarm.on('connection', (connection, peerInfo) => {
      store.replicate(connection)
      this.wakeup.addStream(connection)
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
            wakeup: this.wakeup,
            encryptionKey: this.encryptionKey || result.encryptionKey,
            keyProvider: this.keyProvider,
            bootstrap: this.bootstrap
          })

          await this.pass.deleteInvite()
        }
        this.swarm = null
        this.store = null
        if (this.onresolve) this._whenWritable()
        this.candidate.close().catch(noop)
      }
    })
  }

  _whenWritable() {
    if (this.pass.base.writable) return
    const check = () => {
      if (this.pass.base.writable) {
        this.pass.base.off('update', check)
        this.onresolve(this.pass)
      }
    }
    this.pass.base.on('update', check)
  }

  async _close() {
    if (this.candidate !== null) {
      await this.candidate.close()
    }

    if (this.wakeup !== null) {
      this.wakeup.destroy()
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

  finished() {
    return new Promise((resolve, reject) => {
      this.onresolve = resolve
      this.onreject = reject
    })
  }
}

class Autopass extends ReadyResource {
  constructor(corestore, opts = {}) {
    super()
    this.router = new Router()
    this.relayThrough = opts.relayThrough || null
    this.store = corestore
    this.swarm = opts.swarm || null
    this.base = null
    this.bootstrap = opts.bootstrap || null
    this.member = null
    this.pairing = null
    this.replicate = opts.replicate !== false
    this.debug = !!opts.key
    this._providedKey = opts.encryptionKey || null
    this._keyProvider = opts.keyProvider || new InMemoryKeyProvider()
    this._encryptionKey = null
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

    this.router.add('@autopass/add-mirror', async (data, context) => {
      await context.view.insert('@autopass/mirrors', data)
    })

    this.router.add('@autopass/del', async (data, context) => {
      await context.view.delete('@autopass/records', { key: data.key })
    })

    this.router.add('@autopass/del-mirror', async (data, context) => {
      await context.view.delete('@autopass/mirrors', { key: data.key })
    })

    this.router.add('@autopass/add-invite', async (data, context) => {
      await context.view.insert('@autopass/invite', data)
    })

    this.router.add('@autopass/del-invite', async (data, context) => {
      await context.view.delete('@autopass/invite', { id: data.id })
    })

    this._boot(opts)
    this.ready().catch(noop)
  }

  // Initialize autobase
  _boot(opts = {}) {
    const { key, wakeup } = opts

    this.base = new Autobase(this.store, key, {
      wakeup,
      open(store) {
        return HyperDB.bee(store.get('view'), db, {
          extension: false,
          autoUpdate: true
        })
      },
      // New data blocks will be added using the apply function
      apply: this._apply.bind(this)
    })

    this.base.on('update', () => {
      if (!this.base._interrupting) this.emit('update')
    })
  }

  async _apply(nodes, view, base) {
    for (const node of nodes) {
      await this.router.dispatch(node.value, { view, base })
    }
    await view.flush()
  }

  async _open() {
    await this._ensureEncryptionKey()
    await this.base.ready()
    if (this.replicate) await this._replicate()
  }

  async _close() {
    if (this.swarm) {
      await this.member.close()
      await this.pairing.close()
      await this.swarm.destroy()
    }
    await this.base.close()
  }

  get writerKey() {
    return this.base.local.key
  }

  get key() {
    return this.base.key
  }

  get discoveryKey() {
    return this.base.discoveryKey
  }

  get encryptionKey() {
    return this._encryptionKey
  }

  async _ensureEncryptionKey() {
    if (this._encryptionKey) return
    if (this._providedKey) {
      this._encryptionKey = normalizeEncryptionKey(this._providedKey, this.base.key)
      return
    }
    const candidate = this._keyProvider ? await this._keyProvider.getKey() : null
    if (candidate) {
      this._encryptionKey = normalizeEncryptionKey(candidate, this.base.key)
      return
    }
    const generated = crypto.randomBytes(ENCRYPTION_KEY_BYTES)
    this._encryptionKey = generated
    if (this._keyProvider && this._keyProvider.setKey) {
      await this._keyProvider.setKey(generated)
    }
  }

  static pair(store, invite, opts) {
    return new AutopassPairer(store, invite, opts)
  }

  async createInvite(opts) {
    if (this.opened === false) await this.ready()
    const existing = await this.base.view.findOne('@autopass/invite', {})
    if (existing) {
      if (this.member) await this.member.flushed()
      return z32.encode(existing.invite)
    }
    const { id, invite, publicKey, expires } = BlindPairing.createInvite(this.base.key)

    const record = { id, invite, publicKey, expires }
    await this.base.append(encode('@autopass/add-invite', record))
    if (this.member) await this.member.flushed()
    return z32.encode(record.invite)
  }

  async deleteInvite() {
    if (this.opened === false) await this.ready()
    const existing = await this.base.view.findOne('@autopass/invite', {})
    if (existing) {
      await this.base.append(encode('@autopass/del-invite', existing))
    }
  }

  list(opts) {
    return this.base.view.find('@autopass/records', {})
  }

  async listDecrypted() {
    const queryStream = this.base.view.find('@autopass/records', {})
    const results = await queryStream.toArray()
    if (!this._encryptionKey) return results
    return results.map((record) => ({
      ...record,
      value: decryptString(record.value, this._encryptionKey),
      file: decryptBuffer(record.file, this._encryptionKey)
    }))
  }

  async get(key) {
    const data = await this.base.view.get('@autopass/records', { key })
    if (data === null) {
      return null
    }
    if (!this._encryptionKey) return { value: data.value, file: data.file }
    return {
      value: decryptString(data.value, this._encryptionKey),
      file: decryptBuffer(data.file, this._encryptionKey)
    }
  }

  async addWriter(key) {
    await this.base.append(
      encode('@autopass/add-writer', {
        key: b4a.isBuffer(key) ? key : b4a.from(key)
      })
    )
    return true
  }

  async removeWriter(key) {
    await this.base.append(
      encode('@autopass/remove-writer', {
        key: b4a.isBuffer(key) ? key : b4a.from(key)
      })
    )
  }

  get writable() {
    return this.base.writable
  }

  async _replicate() {
    await this.base.ready()
    if (this.swarm === null) {
      this.swarm = new Hyperswarm({
        keyPair: await this.store.createKeyPair('hyperswarm'),
        bootstrap: this.bootstrap,
        relayThrough: this.relayThrough
      })
      this.swarm.on('connection', (connection, peerInfo) => {
        this.base.replicate(connection)
      })
    }
    this.pairing = new BlindPairing(this.swarm)
    this.member = this.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: async (candidate) => {
        const id = candidate.inviteId
        const inv = await this.base.view.findOne('@autopass/invite', {})
        if (inv === null || !b4a.equals(inv.id, id)) {
          return
        }
        candidate.open(inv.publicKey)
        await this.addWriter(candidate.userData)
        candidate.confirm({
          key: this.base.key,
          encryptionKey: this._encryptionKey
        })
        await this.deleteInvite()
      }
    })
    this.swarm.join(this.base.discoveryKey)

    const mirrorList = await this.getMirror()
    const mirrors = mirrorList.map((item) => item.key)
    this.peering = new BlindPeering(this.swarm, this.store, {
      wakeup: this.base.wakeupProtocol,
      autobaseMirrors: mirrors
    })
    this.peering.addAutobaseBackground(this.base)
  }

  async add(key, value, file) {
    if (file && file.byteLength > 6 * 1024 * 1024) {
      throw new Error('File length should be less than 6 MB')
    }
    const nextValue = this._encryptionKey ? encryptString(value, this._encryptionKey) : value
    const nextFile = this._encryptionKey ? encryptBuffer(file, this._encryptionKey) : file
    await this.base.append(encode('@autopass/put', { key, value: nextValue, file: nextFile }))
  }

  async remove(key) {
    await this.base.append(encode('@autopass/del', { key }))
  }

  async addMirror(key) {
    const keyBuffer = enc.decode(enc.normalize(key))
    await this.base.append(encode('@autopass/add-mirror', { key: keyBuffer }))
  }

  async getMirror() {
    const queryStream = this.base.view.find('@autopass/mirrors', {})
    const results = await queryStream.toArray()
    return results.map((r) => ({
      ...r,
      key: enc.encode(r.key)
    }))
  }

  async removeMirror(key) {
    const keyBuffer = enc.decode(enc.normalize(key))
    await this.base.append(encode('@autopass/del-mirror', { key: keyBuffer }))
  }

  async suspend() {
    if (this.swarm) {
      await this.pairing.suspend()
      await this.swarm.suspend()
      await this.store.suspend()
    }
  }

  async resume() {
    if (this.swarm) {
      await this.store.resume()
      await this.swarm.resume()
      await this.pairing.resume()
    }
  }
} // end class

function noop() {}

Autopass.InMemoryKeyProvider = InMemoryKeyProvider

module.exports = Autopass
