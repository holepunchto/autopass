import Autopass from './index.js'
import Corestore from 'corestore'
import process from 'process'
const store = new Corestore('example/' + process.argv[2])

let pass = null

if (process.argv[3]) {
  const pair = Autopass.pair(store, process.argv[3])
  pass = await pair.finished()
} else {
  pass = new Autopass(store)
  await pass.ready()
}

if (pass.base.writable) {
  const inv = await pass.createInvite()
  console.log('invite', inv)
}
onupdate()
pass.on('update', onupdate)

function onupdate () {
  console.log('db changed, all entries:')
  pass.list().on('data', console.log)
}

