# autopass

Distributed notes/password manager

```sh
npm install autopass
```

> [!NOTE]
> Autopass needs Corestore 7, our latest major version that is backed by RocksDB for storage and atomicity.

## Usage

First choose if you wanna pair or make a new instance.

```js
import Autopass from 'autopass'
import Corestore from 'corestore'

const pass = new Autopass(new Corestore('./pass'), {
  encryptionKey: 'your-secret-passphrase'
})

const inv = await pass.createInvite()
console.log('share to add', inv)
```

Then invite another instance

```js
const pair = Autopass.pair(new Corestore('./another-pass'), inv)

const anotherPass = await pair.finished()
await anotherPass.ready()
```

When paired you can simply start the instance again with the normal constructor.

```js
await pass.add('a-note', 'hello this is a note')
```

Then on the other node you get it out with

```js
const note = await pass.get('a-note')
console.log({ note })
```

## API

#### `pass = new Autopass(new Corestore(path), [opts])`

Make a new pass instance.

Options:

- `encryptionKey` (string or buffer): Enables entry-level encryption for values/files. The key is not persisted to disk, so callers must supply it every time they open the store.
- `keyProvider` (object): Optional async key provider with `getKey()`, `setKey(key)`, `clearKey()` used when `encryptionKey` is not supplied.
  - When neither is supplied, Autopass generates an in-memory key (entries will be unreadable after restart unless the caller persists the key).
  - Passphrases are derived with `scrypt` using the vault key as salt; raw 32-byte keys are used directly.

Example key provider interface:

```js
const keyProvider = {
  async getKey() {
    return await loadFromSecureStore()
  },
  async setKey(key) {
    await saveToSecureStore(key)
  },
  async clearKey() {
    await deleteFromSecureStore()
  }
}
```

#### `pass.on('update', fn)`

Triggered when it updates, ie something added/removed an entry

#### `value = await pass.get(key)`

Get an entry.

#### `stream = pass.list()`

Get all entries.

#### `entries = await pass.listDecrypted()`

Get all entries with decrypted values/files when entry-level encryption is enabled.
If decryption fails (wrong key), `value`/`file` will be `null`.

#### `Autopass.InMemoryKeyProvider`

Default key provider implementation that keeps keys in memory only.

#### `await pass.add(key, value, file)`

Add new entry

#### `await pass.remove(key)`

Remove an entry.

#### `await pass.removeWriter(writerKey)`

Remove a writer explictly.

#### `await pass.addWriter(writerKey)`

Add a writer explictly.

#### `pass.writerKey`

Get the local writer key.

#### `inv = await pass.createInvite()`

Get invite to add a writer.

#### `await deleteInvite()`

Delete the current invite.

#### `await pass.ready()`

Wait for the pass to load fully

#### `pair = Autopass.pair(new Corestore(path), invite)`

Pair with another instance.
If `encryptionKey` or `keyProvider` is provided, the pair instance will prefer those; otherwise it uses the key sent by the inviter.

#### `pass = await pair.finished()`

Wait for the pair to finish.

#### `await pass.addMirror(key)`

Add a blind mirror.

#### `await getMirror()`

Returns an array of blind mirrors

#### `await removeMirror(key)`

Remove a blind mirror

#### `await pair.close()`

Force close the pair instance. Only need to call this if you dont wait for it to finish.get

#### `await pass.close()`

Fully close the pass instance.

#### `await pass.suspend()`

Suspend the swarm and discovery

#### `await pass.resume`

Resume the swarm is suspended

## Contributors

Written with big contributions from [@supersu](https://github.com/supersuryaansh)
