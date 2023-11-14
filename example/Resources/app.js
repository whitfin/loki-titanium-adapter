// Load our PouchDB module dependencies
const Loki = require('lokijs');
const TitaniumAdapter = require('loki-titanium-adapter');

// Construct our database instance
const db = new Loki('values', {
    adapter: new TitaniumAdapter(),
    autoload: false,
    autosave: false,
    autosaveInterval: 3000,
    autoloadCallback: function () {
        if (!db.getCollection('values')) {
            db.addCollection('values');
        }
        _reset();
    },
});

// Create our window instance
let win = Ti.UI.createWindow({
    backgroundColor: 'white',
    layout: 'vertical'
});

// Create our text submit button
let submit = Ti.UI.createButton({
    title: 'Insert',
    height: 24,
    width: 75
});

// Create our insertion text field
let insert = Ti.UI.createTextField({
    top: 75,
    height: 35,
    width: 200,
    backgroundColor: 'white',
    hintText: 'Enter a value',
    borderStyle: Titanium.UI.INPUT_BORDERSTYLE_ROUNDED,
    keyboardType: Titanium.UI.KEYBOARD_DEFAULT,
    rightButton: submit
});

// Create our list of values to display
let records = Ti.UI.createListView({
    defaultItemTemplate: 'default',
    headerTitle: 'Values',
    sections: [],
    templates: {
        default: {
            childTemplates: [
                {
                    type: 'Ti.UI.Label',
                    bindId: 'value',
                    properties: {
                        left: 20,
                        height: 44
                    }
                },
                {
                    type: 'Ti.UI.Button',
                    bindId: 'remove',
                    properties: {
                        width: 75,
                        height: 24,
                        right: 10,
                        title: 'Remove'
                    },
                    events: {
                        click: function report(e) {
                            db.getCollection('values').remove(e.itemId);
                            _reset();
                        }
                    }
                }
            ]
        }
    }
});

// Add a listener to insert the provided value to the database.
//
// This will then update the table with the latest values from the
// database. This persists across restarts, meaning that if you kill
// the app and re-open it, the state will still be available and the
// last known values will be shown.
submit.addEventListener('click', function () {
    if (insert.value.length === 0) {
        return;
    }
    db.getCollection('values').insert({
        value: insert.value
    });
    _reset();
});

// Unfocus the text field when clicked elsewhere
win.addEventListener('click', function () {
    insert.blur();
});

// Add a pause listener to ensure flush on background
Ti.App.addEventListener('pause', function () {
    db.saveDatabase(function () {
        Ti.API.info('Flushing database changes');
    });
});

// Add all window components
win.add(insert);
win.add(records);
win.open();



db.addCollection('values');
let col = db.getCollection('values');
for (let i = 0; i < 1000000; i++) {
    col.insert({ value: i });
}

console.log('save start: ' + Date.now());
db.saveDatabase(function () {
    console.log('save end: ' + Date.now());
    console.log('load start: ' + Date.now());
    db.loadDatabase({}, function () {
        console.log('load end: ' + Date.now());
    });
});


// Reset handler to re-populate the list view.
//
// This will fetch the values from the table and display them in the
// list. This recreates the list from scratch as this is just for
// demonstration purposes, not necessarily for best efficiency.
function _reset() {
    // reset the insert text
    insert.value = '';

    // fetch all values from the database
    let entries = db.getCollection('values').find();

    // create a section from each entry in the database
    let section = Ti.UI.createListSection({
        items: entries.map(function (record) {
            return {
                value: {
                    text: record.value
                },
                properties: {
                    itemId: record.$loki
                }
            };
        })
    });

    // update the list with the new section
    records.sections = [section];
}
