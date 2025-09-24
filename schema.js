const Hyperschema = require("hyperschema");
const HyperdbBuilder = require("hyperdb/builder");
const Hyperdispatch = require("hyperdispatch");

// SCHEMA CREATION START //
const autopass = Hyperschema.from("./spec/schema");
const template = autopass.namespace("autopass");
// You can find a list of supported data types here: https://github.com/holepunchto/compact-encoding
template.register({
  name: "records",
  compact: false,
  fields: [
    {
      name: "key",
      type: "string",
      required: true,
    },
    {
      name: "value",
      type: "string",
      required: false,
    },
    {
      name: "file",
      type: "buffer",
      required: false,
    },
  ],
});
template.register({
  name: "mirrors",
  compact: false,
  fields: [
    {
      name: "key",
      type: "string",
      required: true,
    },
  ],
});
template.register({
  name: "writer",
  compact: false,
  fields: [
    {
      name: "key",
      type: "buffer",
      required: true,
    },
  ],
});

template.register({
  name: "delete",
  compact: false,
  fields: [
    {
      name: "key",
      type: "string",
      required: true,
    },
  ],
});

template.register({
  name: "invite",
  compact: false,
  fields: [
    {
      name: "id",
      type: "buffer",
      required: true,
    },
    {
      name: "invite",
      type: "buffer",
      required: true,
    },
    {
      name: "publicKey",
      type: "buffer",
      required: true,
    },
    {
      name: "expires",
      type: "int",
      required: true,
    },
  ],
});

template.register({
  name: "del-invite",
  compact: false,
  fields: [
    {
      name: "id",
      type: "buffer",
      required: true,
    },
  ],
});
template.register({
  name: "del-mirror",
  compact: false,
  fields: [
    {
      name: "key",
      type: "string",
      required: true,
    },
  ],
});
Hyperschema.toDisk(autopass);

const dbTemplate = HyperdbBuilder.from("./spec/schema", "./spec/db");
const blobs = dbTemplate.namespace("autopass");
blobs.collections.register({
  name: "records",
  schema: "@autopass/records",
  key: ["key"],
});
blobs.collections.register({
  name: "invite",
  schema: "@autopass/invite",
  key: ["id"],
});
blobs.collections.register({
  name: "mirrors",
  schema: "@autopass/mirrors",
  key: ["key"],
});
blobs.collections.register({
  name: "writer",
  schema: "@autopass/writer",
  key: ["key"],
});

blobs.collections.register({
  name: "delete",
  schema: "@autopass/delete",
  key: ["key"],
});

blobs.collections.register({
  name: "del-invite",
  schema: "@autopass/del-invite",
  key: ["id"],
});
blobs.collections.register({
  name: "del-mirror",
  schema: "@autopass/del-mirror",
  key: ["key"],
});
HyperdbBuilder.toDisk(dbTemplate);

const hyperdispatch = Hyperdispatch.from(
  "./spec/schema",
  "./spec/hyperdispatch",
);
const namespace = hyperdispatch.namespace("autopass");
namespace.register({
  name: "remove-writer",
  requestType: "@autopass/writer",
});
namespace.register({
  name: "add-writer",
  requestType: "@autopass/writer",
});
namespace.register({
  name: "put",
  requestType: "@autopass/records",
});
namespace.register({
  name: "add-mirror",
  requestType: "@autopass/mirrors",
});
namespace.register({
  name: "del-mirror",
  requestType: "@autopass/del-mirror",
});
namespace.register({
  name: "del",
  requestType: "@autopass/delete",
});
namespace.register({
  name: "add-invite",
  requestType: "@autopass/invite",
});
namespace.register({
  name: "del-invite",
  requestType: "@autopass/del-invite",
});
Hyperdispatch.toDisk(hyperdispatch);
