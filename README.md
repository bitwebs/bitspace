# bitspace

> Unichains, batteries included.

BitSpace is a lightweight server that provides remote access to Unichains and a BitSwarm instance. It exposes a simple [RPC interface](https://github.com/bitwebs/bitspace-rpc) that can be accessed with the [Bitspace client for Node.js](https://github.com/bitwebs/bitspace-client).

The RPC API's designed to be minimal, maintaining parity with Unichain and the [`@web4/chainstore-networker`](https://github.com/bitwebs/chainstore-networker) but with few extras.

Features include:
* A `RemoteChainstore` interface for creating namespaced [`Chainstore`](https://github.com/bitwebs/chainstore) instances. 
* A `RemoteNetworker` interface for managing [BitSwarm DHT](https://github.com/bitwebs/bitswarm) connections. Supports stream-level extensions. 
* A `RemoteUnichain` interface that feels exactly like normal ol' [`Unichain`](https://github.com/bitwebs/unichain), with [few exceptions](TODO). Extensions included.

#### Already using the BitDrive daemon?
With Bitspace, most of the [BitDrive daemon's](https://github.com/bitwebs/bitdrive-daemon) functionality has been moved into "userland" -- instead of providing remote access to BitDrives, the regular [`bitdrives`](https://github.com/bitwebs/bitdrive) module can be used with remote Unichains.

If you're currently using the BitDrive daemon with FUSE and/or the daemon CLI, take a look at the upgrade instructions in [`bitdrive-cli`](https://github.com/bitwebs/bitdrive-cli), which is our new BitDrive companion service for handling FUSE/CLI alongside BitSpace.

__Note: The first time you run Bitspace, it will detect your old BitDrive daemon installation and do an automatic migration. You can postpone the migration by starting the server with the `--no-migrate` flag (`bitspace --no-migrate`).__

### Installation
```
npm i bitspace -g
```

### Getting Started
When installed globally, you can use the `bitspace` CLI tool to start the server:
```
❯ bitspace --no-migrate  // Starts the server without performing the BitDrive daemon migration
```

The `bitspace` command supports the following flags:
```
--bootstrap   // BitSwarm bootstrapping options (see BitSwarm docs).
--host        // Host to bind to.
--port        // Port to bind to (if specified, will use TCP).
--memory-only // Run in memory-only mode.
--no-announce // Never announce topics on the DHT.
--no-migrate  // Do not attempt to migrate the BitDrive daemon's storage to Bitspace.
--repl        // Start the server with a debugging REPL.
```

By default, Bitspace binds to a UNIX domain socket (or named pipe on Windows) at `~/.bitspace/bitspace.sock`.

Once the server's started, you can use the client to create and manage remote Unichains. If you'd like the use the BitDrive CLI, check out the [`@web4/bitdrive` docs](https://github.com/bitwebs/bitdrive-cli).

### API
To work with Bitspace, you'll probably want to start with the [Node.js client library](https://github.com/bitwebs/bitspace-client). The README over there provides detailed API info.

### Simulator

Bitspace includes a "simulator" that can be used to create one-off Bitspace instances, which can be used for testing.

```js
const simulator = require('bitspace/simulator')
// client is a BitspaceClient, server is a BitspaceServer
const { client, server, cleanup } = await simulator()
```

### License
MIT
