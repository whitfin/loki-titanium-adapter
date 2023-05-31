# loki-titanium-adapter
[![Build Status](https://img.shields.io/github/actions/workflow/status/whitfin/loki-titanium-adapter/ci.yml)](https://github.com/whitfin/loki-titanium-adapter/actions)
![npm](https://img.shields.io/npm/v/loki-titanium-adapter.svg)

Titanium SDK adapter for the [Loki](https://github.com/techfort/LokiJS)
embedded database.

You can use this library to persist Loki databases inside Titanium applications
using the Titanium API. Everything else operates as it would in any other runtime,
so visit the [Loki documentation](https://github.com/techfort/LokiJS) for further
information.

### Usage

This module is on npm, so feel free to grab from there (as well as Loki):

```shell
$ npm i lokijs loki-titanium-adapter
```

You can then configure it inside your application pretty easily, as the
API is still synchronous for the time being:

```javascript
// Load our modules
const Loki = require('lokijs');
const TitaniumAdapter = require('loki-titanium-adapter');

// Construct our database instance
const db = new Loki('my-database', {
	adapter: new TitaniumAdapter({
		parent: 'data',				// subdirectory in app data
		reader: {
			buffer: 1024 * 1024		// max buffer during disk reads
		},
		writer: {
			batch: 25			// number of documents to write in batch
		}
	}),
	autoload: true,
	autosave: true,
	autosaveInterval: 5000,
	autoloadCallback: function () {
		// called when your database is loaded
	},
});
```

This will save your database changes to disk every 5 seconds (configured via
the `autosaveInterval` parameter). In addition to this, I recommend adding a
hook for the `pause` event to flush when the application is closed:

```javascript
// Add a pause listener to ensure flush on background
Ti.App.addEventListener('pause', function (_e) {
	db.saveDatabase(function (e) {
		// documents should have been flushed
	});
});
```

There is also a more complete [example app](example/) available - just keep
in mind that you need to run `npm install` before you try to run it. For any
further use, check out [Loki wiki](https://github.com/techfort/LokiJS/wiki)
as the API is exactly the same.
