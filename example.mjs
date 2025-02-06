import Autopass from './index.js'
import Corestore from 'corestore'
const pass = new Autopass(new Corestore('./pass'))

const inv = await pass.createInvite()

const pair = Autopass.pair(new Corestore('./another-pass'), inv)
const anotherPass = await pair.finished()
await anotherPass.ready()
await anotherPass.add('a-note', 'hello this is a note')
console.log(await anotherPass.get('a-note'))
await anotherPass.remove('a-note')