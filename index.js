/*
 * @created 15/01/2021 - 7:00 PM
 * @project app
 * @author  dennis joel
*/

// Dependencies
const server = require('./lib/server');
const workers = require('./lib/workers');

// Declare the app
const app = {

}

// Init function
app.init = () => {
    // Start the server
    server.init();

    // Start the workers
    workers.init();
};

// Execute
app.init();

module.exports = app;
