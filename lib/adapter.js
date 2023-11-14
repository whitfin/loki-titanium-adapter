const async = require('neo-async');

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
	 * @param {Object} [options]
	 * 		options object to control behaviour.
	 * @param {string} [options.parent]
	 * 		the parent directory to store databases under (data).
	 * @param {number} [options.reader.buffer]
	 * 		the max bytes of the buffer used to read in data (1MB).
	 * @param {number} [options.writer.batch]
	 * 		the batch sizing to use when flushing items to disk (25).
	 */
    constructor(options = {}) {
        this.mode = 'reference';
        this.parent = options.parent || 'data';
        this.reader = options.reader || {};
        this.writer = options.writer || {};
        this.reader.buffer = this.reader.buffer || 1024 * 1024;
        this.writer.batch = this.writer.batch || 25;
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

        // write it all to the meta file
        meta.write(data, (result) => {
            // check for success
            if (!result.success) {
                return callback(result.error);
            }

            // close the handle
            meta.close();
            async.each(
                database.collections,
                (collection, cidx, cnext) => {
                    // skip if no changes
                    if (!collection.dirty) {
                        return cnext();
                    }

                    // open a descriptor to write contents directly to
                    let descriptor = this._getDescriptor(name, cidx)
                        .open(Titanium.Filesystem.MODE_WRITE);

                    let batch = '';
                    function _write(cb) {
                        // skip empty stacks
                        if (batch.length === 0) {
                            return cb();
                        }

                        // turn batch into a buffer
                        let data = Ti.createBuffer({
                            value: batch
                        });

                        // empty the batch
                        batch = '';

                        // write the batch buffer to the descriptor
                        descriptor.write(data, function (result) {
                            if (!result.success) {
                                return cb(result.error);
                            }
                            cb();
                        });
                    }

                    async.eachSeries(
                        collection.data,
                        (document, didx, dnext) => {
                            // append document to the buffer
                            batch += JSON.stringify(document) + '\n';

                            // trigger write on batch limit
                            if (didx % this.writer.batch === 0) {
                                return _write(dnext);
                            }

                            // continue
                            dnext();
                        },
                        function (err1) {
                            // write remaining items
                            _write(function (err2) {
                                descriptor.close();
                                cnext(err1 || err2 || undefined);
                            });
                        }
                    );
                },
                callback
            );
        });
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
        async.each(
            database.collections,
            (collection, cidx, next) => {
                // grab a file descriptor for the collection
                let descriptor = this._getDescriptor(name, cidx);

                // initialize resources
                let offset = '';
                let buffer = Ti.createBuffer({ length: this.reader.buffer });
                let stream = descriptor.open(Ti.Filesystem.MODE_READ);
                let parsed = 0;

                // chunk reader
                let _read = () => {
                    // fetch the next chunk of bytes into
                    stream.read(buffer, (result) => {
                        // check for success
                        if (!result.success) {
                            return parsed
                                ? _complete()
                                : next(result.error);
                        }

                        // convert through to string
                        let bytes = buffer.toString();

                        // chunk into lines and pass the entries through
                        offset = _chunk(offset, bytes, function (entry) {
                            collection.data.push(entry);
                        });

                        // clear buffer
                        buffer.clear();

                        // store previous byte count
                        parsed = result.bytesProcessed;

                        // check length to iterate onward
                        if (parsed === this.reader.buffer) {
                            return setTimeout(_read, 0);
                        }

                        // finished
                        _complete();
                    });
                };

                // end of stream writer
                function _complete() {
                    // chunk any remaining entries through
                    _chunk('', offset, function (entry) {
                        collection.data.push(entry);
                    });

                    // close handle
                    stream.close();

                    // done!
                    next();
                }

                // begin
                _read();
            },
            function () {
                callback(database);
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
 * @returns {String}
 * 		any leftover bytes that have not been consumed.
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
