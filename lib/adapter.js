// constant to use for the root database directory
const ROOT = Ti.Filesystem.applicationDataDirectory;

// constant to use as a \n buffer
const NEWLINE = Ti.createBuffer({
	value: '\n'
});

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
	constructor(opts = {}) {
		this.mode = 'reference';
		this.parent = opts.parent || 'data';
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
		meta.write(data);
		meta.close();

		// iterate all collections in the database to store separately
		for (let cidx = 0; cidx < database.collections.length; cidx++) {

			// pull the next collection in the list
			let collection = database.collections[cidx];

			// skip if no changes
			if (!collection.dirty) {
				continue;
			}

			// open a descriptor to write contents directly to
			let descriptor = this._getDescriptor(name, cidx)
				.open(Titanium.Filesystem.MODE_WRITE);

			// iterate all documents found in the collection
			for (let document of collection.data) {
				// convert the document to a buffer
				let data = Ti.createBuffer({
					value: JSON.stringify(document)
				});

				// write out as JSONL
				descriptor.write(data);
				descriptor.write(NEWLINE);
			}

			// close streams
			descriptor.close();
		}

		// done, so finish!
		callback(undefined);
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
			return callback(undefined);
		}

		// otherwise read in the content directly
		let database = JSON.parse(meta.read().text);

		// fetch all collections (which are stored separately)
		for (let idx = 0; idx < database.collections.length; idx++) {
			// grab the collection and file descriptor
			let collection = database.collections[idx];
			let descriptor = this._getDescriptor(name, idx);

			// initialize resources
			let offset = '';
			let buffer = Ti.createBuffer({ length: 1024 });
			let stream = descriptor.open(Ti.Filesystem.MODE_READ);

			// read all content from the stream
			while (stream.read(buffer) > -1) {
				// save our buffer for comparison
				let bytes = buffer.toString();

				// chunk into lines and pass the entries through
				offset = _chunk(offset, bytes, function (entry) {
					collection.data.push(entry);
				});

				// clear our buffer
				buffer.clear();
			}

			// chunk any remaining entries through
			_chunk('', offset, function (entry) {
				collection.data.push(entry);
			});

			// cleanup
			stream.close();
		}

		// pass it back
		callback(database);
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
 * Chunks a set of bytes into lines for consumption.
 *
 * This is abstracted out to provide a reasonably efficient walking
 * of bytes which are consumed on-demand. The alternative was a lot
 * of copying/allocation which seemed unnecessary.
 *
 * @param {String} initial
 * 		the initial state of the temporary buffer.
 * @param {String} input
 * 		the input bytes to walk over and emit from.
 * @param {Function} consumer
 * 		the consuming function to handle a parsed line.
 */
function _chunk(initial, input, consumer) {
	// set temp buffer
	let tmp = initial;

	// iterate all bytes
	for (let byte of input) {
		// append each byte
		if (byte !== '\n') {
			tmp += byte;
			continue;
		}

		// skip empty entries
		if (tmp.length === 0) {
			continue;
		}

		// consume the parsed line
		consumer(JSON.parse(tmp));

		// reset
		tmp = '';
	}

	// any remaining
	return tmp;
}
