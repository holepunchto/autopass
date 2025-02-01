const Hyperschema = require('hyperschema')
const HyperdbBuilder = require('hyperdb/builder')
const Hyperdispatch = require('hyperdispatch')

// SCHEMA CREATION START //
const schemaTemplate = Hyperschema.from('./spec/schema')
const templateNamespace = schemaTemplate.namespace('autopass-namespace')
// You can find a list of supported data types here: https://github.com/holepunchto/compact-encoding
templateNamespace.register({
  name: 'autopass',
  compact: false,
  fields: [{
    name: 'key',
    type: 'string',
    required: true
  }, {
    name: 'value',
    type: 'string',
    required: false
  }
  ]
})
templateNamespace.register({
  name: 'invite',
  compact: false,
  fields: [{
    name: 'id',
    type: 'string',
    required: true
  }, {
    name: 'invite',
    type: 'string',
    required: true
  }, {
    name: 'publicKey',
    type: 'string',
    required: true
  }, {
    name: 'expires',
    type: 'int',
    required: true
  }
  ]
})
Hyperschema.toDisk(schemaTemplate)

const dbTemplate = HyperdbBuilder.from('./spec/schema', './spec/db')
const blobs = dbTemplate.namespace('autopass-namespace')
blobs.collections.register({
  name: 'autopass',
  schema: '@autopass-namespace/autopass',
  key: ['key']
})
blobs.collections.register({
  name: 'invite',
  schema: '@autopass-namespace/invite',
  key: ['id']
})
HyperdbBuilder.toDisk(dbTemplate)

const hyperdispatch = Hyperdispatch.from('./spec/schema', './spec/hyperdispatch')
const namespace = hyperdispatch.namespace('autopass-namespace')
namespace.register({
  name: 'removeWriter',
  requestType: '@autopass-namespace/autopass'
})
namespace.register({
  name: 'addWriter',
  requestType: '@autopass-namespace/autopass'
})
namespace.register({
  name: 'put',
  requestType: '@autopass-namespace/autopass'
})
namespace.register({
  name: 'del',
  requestType: '@autopass-namespace/autopass'
})
namespace.register(({
  name: 'addInvite',
  requestType: '@autopass-namespace/invite'
}))
Hyperdispatch.toDisk(hyperdispatch)
