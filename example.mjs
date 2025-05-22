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

await pass.addMirror('k1qhqgipx7h1jo34mt6565uabaiofn69fu8i6w61qipeyeyqgp9y')
await pass.addMirror('p1qhqgipx7h1jo34mt6565uabaiofn69fu8i6w61qipeyeyqgp9y')
console.log(await pass.getMirror())
await pass.removeMirror('k1qhqgipx7h1jo34mt6565uabaiofn69fu8i6w61qipeyeyqgp9y')

console.log(await pass.getMirror())
