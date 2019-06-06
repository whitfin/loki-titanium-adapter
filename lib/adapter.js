// constant to use for the root database directory
const ROOT = Ti.Filesystem.applicationDataDirectory;

/**
 * A Loki adapter for the Titanium SDK.
 *
 * This class allows for database persistence when using LokiJS from within
 * the Titanium SDK. Databases are stored in files and easily accessible from
 * within a Titanium context.
 *
 * This adapter operates in a similar fashion to the high performance Node.js
 * implementation in the Loki library itself. Collections are stored and written
 * separately to avoid having to carry out large writes for minimal changes.
 *
 * Working in this way also allows for better concurrency when writing files
 * (although we're not being optimal at this point, due to some restrictions).
 */
class TitaniumAdapter {
	/**
	 * Constructs a new instance of this adapter.
	 *
	 * @param {Object} options
	 * 		options object to control behaviour.
	 * @param {Object} options.parent
	 * 		the parent directory to store databases under.
	 */
	constructor(options = {}) {
		this.mode = 'reference';
		this.parent = options.parent || 'data';
	}

	/**
	 * Serializes a database to a local disk.
	 *
	 * @param {String} name
	 * 		the name of the database to write.
	 * @param {Object} database
	 * 		the database reference to store locally.
	 * @param {Function} callback
	 *      the callback to pass results to.
	 */
	exportDatabase(name, database, callback) {
		// clone the metadata headers
		let cloned = database.copy();
		for (let collection of cloned.collections) {
			collection.data = [];
		}

		// initializes the storage directories
		Ti.Filesystem
			.getFile(ROOT, this.parent, name)
			.createDirectory(true);

		// open a descriptor for the metadata
		let meta = this._getDescriptor(name, '_')
			.open(Titanium.Filesystem.MODE_WRITE);

		// serialize the meta into a buffer
		let data = Ti.createBuffer({
			value: cloned.serialize({
				serializationMethod: 'normal'
			})
		});

		// write it all
		meta.write(data, function () {
			meta.close();
		});

		// iterate all collections in the database to store separately
		_each(
			database.collections,
			(collection, cidx, next) => {
				// skip if no changes
				if (!collection.dirty) {
					return next();
				}

				// open a descriptor to write contents directly to
				let descriptor = this._getDescriptor(name, cidx)
					.open(Titanium.Filesystem.MODE_WRITE);

				// convert the collection to a buffer
				let buffer = Ti.createBuffer({
					value: JSON.stringify(collection.data)
				});

				// attempt to write the JSON to the descriptor
				descriptor.write(buffer, function (result) {
					// check for success
					if (!result.success) {
						return next(result.error);
					}

					// close descriptor
					descriptor.close();

					// continue
					next();
				});
			},
			callback
		);
	}

	/**
	 * Loads a database instance from the local disk.
	 *
	 * @param {String} name
	 * 		the name of the database to load from disk.
	 * @param {Function} callback
	 *      the callback to pass contents back to.
	 */
	loadDatabase(name, callback) {
		// grab the descriptor for the meta file
		let meta = this._getDescriptor(name, '_');

		// if it's not there, skip
		if (!meta.exists()) {
			callback(undefined);
			return;
		}

		// otherwise read in the content directly
		let database = JSON.parse(meta.read().text);

		// fetch all collections (which are stored separately)
		_each(
			database.collections,
			(collection, cidx, next) => {
				// grab a file descriptor for the collection
				let descriptor = this._getDescriptor(name, cidx);

				// initialize resources
				let source = '';
				let buffer = Ti.createBuffer({ length: 1024 });
				let stream = descriptor.open(Ti.Filesystem.MODE_READ);

				// stream reader
				function _read() {
					// fetch the next chunk of bytes into
					stream.read(buffer, function (result) {
						// check for success
						if (!result.success) {
							return next(result.error);
						}

						// save our buffer for parsing
						source += buffer.toString();

						// continue our read when not done
						if (result.bytesProcessed > -1) {
							return _read();
						}

						// overwrite the data from the loaded
						collection.data = JSON.parse(source);

						// cleanup
						stream.close();

						// done!
						next();
					})
				}

				// begin
				_read();
			},
			function () {
				// pass it back
				callback(database)
			}
		);
	}

	/**
	 * Deletes a database from the disk.
	 *
	 * @param {String} name
	 *      the name of the database to remove.
	 * @param {Function} callback
	 *      the callback to fire after deletion.
	 */
	deleteDatabase(name, callback) {
		Ti.Filesystem
			.getFile(ROOT, this.parent, name)
			.deleteDirectory(true);
		callback();
	}

	/**
	 * Opens a descriptor to the underlying storage directory.
	 *
	 * @param {String} name
	 * 		the name of the database we're associated with.
	 * @param {String} file
	 * 		the name of the file to open in context.
	 * @returns {Object}
	 * 		the file descriptor for a location on device.
	 */
	_getDescriptor(name, file) {
		return Ti.Filesystem.getFile(
			ROOT,
			this.parent,
			name,
			file
		);
	}
}

// export the adapter directly
module.exports = TitaniumAdapter;

/**
 * Iterates a collection asynchronously. Similar to async.each,
 * except implemented manually to avoid a large dependency.
 *
 * @param {object[]} iter
 * 		the iterator to walk through, usually an array.
 * @param {function} next
 * 		the handler function to process each item in the iterator.
 * @param {function} callback
 * 		the callback to call when processing has completed.
 */
function _each(iter, next, callback) {
	// skip when nothing is provided
	if (iter.length === 0) {
		return callback();
	}

	// initialize iterator state
	let counts = 0;
	let length = iter.length;
	let exited = false;

	// iterate each item in the iterator
	iter.forEach(function (item, idx) {
		// execute the handler with item and index
		next(item, idx, function (err) {
			// skip when done
			if (exited) {
				return;
			}

			// exit on error
			if (err) {
				exited = true;
				return callback(err);
			}

			// track done
			count += 1;

			// complete when done
			if (count === length) {
				return callback();
			}
		});
	});
}
