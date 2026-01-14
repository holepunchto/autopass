import Autopass from './index.js'
import Corestore from 'corestore'
import process from 'process'
const store = new Corestore('example/' + process.argv[2])
const encryptionKey = process.argv[4] || null

let pass = null

if (process.argv[3]) {
  const pair = Autopass.pair(store, process.argv[3], { encryptionKey })
  pass = await pair.finished()
} else {
  pass = new Autopass(store, { encryptionKey })
  await pass.ready()
}

if (pass.base.writable) {
  const inv = await pass.createInvite()
  console.log('invite', inv)
}
onupdate()
pass.on('update', onupdate)

function onupdate() {
  console.log('db changed, all entries:')
  if (pass.encryptionKey) {
    pass.listDecrypted().then((entries) => console.log(entries))
    return
  }
  pass.list().on('data', console.log)
}
