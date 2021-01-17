/*
 * @created 16/01/2021 - 11:39 PM
 * @project app
 * @author  denni
*/

// Dependencies
const path = require('path');
const fs = require('fs');
const _data = require('./data');
const https = require('https');
const http = require('http');
const helpers = require('./helpers');
const url = require('url');
const _logs = require('./logs');

// Instantiate the workers object
const workers = {};

// Lookup all checks, get their data, send to a validator
workers.gatherAllChecks = () => {
    // Get all the checks
    _data.list('checks', (err, checks) => {
        if (!err && checks.length > 0) {
            checks.forEach((check) => {
                // Read in the check data
                _data.read('checks', check, (err, originalCheckData) => {
                    if (!err && originalCheckData) {
                        // Pass it to the check validator, and let that function continue or log errors as needed
                        workers.validateCheckData(originalCheckData);
                    } else {
                        console.log("Error reading one of the check's data");
                    }
                });
            });
        } else {
            console.log("Error: Could not find any checks to process");
        }
    });
}

// Sanity-check the check-data
workers.validateCheckData = (originalCheckData) => {
    originalCheckData = typeof(originalCheckData) == 'object' && originalCheckData !== null ? originalCheckData : {};
    originalCheckData.id = typeof(originalCheckData.id) == 'string' && originalCheckData.id.trim().length === 20 ? originalCheckData.id.trim() : false;
    originalCheckData.userPhone = typeof(originalCheckData.userPhone) == 'string' && originalCheckData.userPhone.trim().length === 9 ? originalCheckData.userPhone.trim() : false;
    originalCheckData.protocol = typeof(originalCheckData.protocol) == 'string' && ['http', 'https'].indexOf(originalCheckData.protocol) > -1 ? originalCheckData.protocol : false;
    originalCheckData.url = typeof(originalCheckData.url) == 'string' && originalCheckData.url.trim().length > 0 ? originalCheckData.url.trim() : false;
    originalCheckData.successCodes = typeof(originalCheckData.successCodes) == 'object' && originalCheckData.successCodes instanceof Array && originalCheckData.successCodes.length > 0 ? originalCheckData.successCodes : false;
    originalCheckData.timeoutSeconds = typeof(originalCheckData.timeoutSeconds) == 'number' && originalCheckData.timeoutSeconds % 1 === 0 && originalCheckData.timeoutSeconds >= 1 && originalCheckData.timeoutSeconds <= 5 ? originalCheckData.timeoutSeconds : false;

    // Set the keys that mey not be set (if the workers have never seen this check before)
    originalCheckData.state = typeof(originalCheckData.state) == 'string' && ['up', 'down'].indexOf(originalCheckData.state) > -1 ? originalCheckData.state : 'down';
    originalCheckData.lastChecked = typeof(originalCheckData.lastChecked) == 'number' && originalCheckData.lastChecked >= 1 ? originalCheckData.lastChecked : false;

    // If all the checks pass, pass the data along to the next step to the next process

    if (originalCheckData.id &&
        originalCheckData.userPhone &&
        originalCheckData.protocol &&
        originalCheckData.url &&
        originalCheckData.method &&
        originalCheckData.successCodes &&
        originalCheckData.timeoutSeconds){
        workers.performCheck(originalCheckData);
    } else {
        console.log("Error: One of the checks is not properly formatted. Skipping it.");
    }
};

// Perform the check, send the originalCheckData and send the outcome of the check process, to the next step in the process
workers.performCheck = (originalCheckData) => {
    // Prepare the initial check outcome
    const checkOutcome = {
        'error': false,
        'responseCode': false
    };

    // Mark that the outcome has not been sent yet
    var outcomeSent = false;

    // Parse the hostname and the path out of the original check data
    var parsedUrl = url.parse(originalCheckData.protocol+'://'+originalCheckData.url, true);
    var hostName = parsedUrl.hostname;
    const path = parsedUrl.path; // Using path and not pathname because we want the querystring

    // Construct the request
    const requestDetails = {
        'protocol': originalCheckData.protocol + ':',
        'hostname': hostName,
        'method': originalCheckData.method.toUpperCase(),
        'path': path,
        'timeout': originalCheckData.timeoutSeconds * 1000
    };

    // Instantiate the request object (using either the http or https module)
    var _moduleToUse = originalCheckData.protocol === 'http' ? http : https;
    var req = _moduleToUse.request(requestDetails, res => {
        // Grab the status of the sent request
        const status = res.statusCode;

        // Update the checkOutcome and pass the data along
        checkOutcome.responseCode = status;
        if (!outcomeSent){
            workers.processCheckOutcome(originalCheckData, checkOutcome);
            outcomeSent = true;
        }
    });

    // Bind to the error so it doesn't get thrown
    req.on('error', err => {
        // Update the checkOutcome and pass the data along
        checkOutcome.error = {
            'error': true,
            'value': err
        };
        if (!outcomeSent) {
            workers.processCheckOutcome(originalCheckData, checkOutcome);
        }
    });

    // Bind to the timeout event
    req.on('timeout', err => {
        // Update the checkOutcome and pass the data along
        checkOutcome.error = {
            'error': true,
            'value': 'timeout'
        };
        if (!outcomeSent) {
            workers.processCheckOutcome(originalCheckData, checkOutcome);
        }
    });

    // End the request
    req.end();
};

// Process the check outcome, update the check data as needed, trigger an alert if needed
// Special logic for accommodating a check that has never been tested before (don't want to alert on that one)
workers.processCheckOutcome = (originalCheckData, checkOutcome) => {
    // Decides if the check is considered up or down
    const state = !checkOutcome.error && checkOutcome.responseCode &&originalCheckData.successCodes.indexOf(checkOutcome.responseCode) > -1 ? 'up' : 'down';

    // Decide if an alert is warranted
    const alertWarranted = originalCheckData.lastChecked && originalCheckData.state !== state;

    // Log the outcome
    const timeOfCheck = Date.now();
    workers.log(originalCheckData, checkOutcome, state, alertWarranted, timeOfCheck);

    // Update the check data
    const newCheckData = originalCheckData;
    newCheckData.state = state;
    newCheckData.lastChecked = Date.now();

    // Save the updates
    _data.update('checks', newCheckData.id, newCheckData, (err) => {
        if (!err) {
            // Send the new check data to the next phase in the process if needed
            if (alertWarranted){
                workers.alertUserToStatusChange(newCheckData);
            } else {
                console.log("Check outcome has not changed, no alert needed");
            }
        } else {
            console.log("Error trying to save updates to one of the checks");
        }
    })
};

// Alert the user to a change in their check status
workers.alertUserToStatusChange = (newCheckData) => {
    const msg = 'Alert: Your check for '+newCheckData.method.toUpperCase() +' '+ newCheckData.protocol+'://'+newCheckData.url+' is currently '+newCheckData.state;
    helpers.sendTwilioSms(newCheckData.userPhone, msg, (err) => {
        if (!err) {
            console.log("Success: User was alerted to a status change in their check, via sms: ", msg);
        } else {
            console.log("Error: Could not send sms alert to user who had a state change in their check");
        }
    });
}

workers.log = (originalCheckData, checkOutcome, state, alertWarranted, timeOfCheck) => {
    // Form the log data
    const logData = {
        'check': originalCheckData,
        'outcome': checkOutcome,
        'state': state,
        'alert': alertWarranted,
        'time': timeOfCheck
    };

    // Convert to a string
    const logString = JSON.stringify(logData);

    // Determine the name of the log file
    const logFileName = originalCheckData.id;

    // Append the log string to the log file
    _logs.append(logFileName, logString, (err) => {
        if (!err) {
            console.log("Logging to file succeeded");
        } else {
            console.log("Logging to file failed");
        }
    });
};


// Timer to execute the worker-process once per minute
workers.loop = () => {
    setInterval(() => {
        workers.gatherAllChecks();
    }, 1000 * 5);
}

// Rotate (Compress) thr log files
workers.rotateLogs = () => {
    // List all the non compresses log files
    _logs.list(false, (err, logs) => {
        if (!err && logs && logs.length > 0) {
            logs.forEach((logName) => {
                // Compress the data to a different file
                const logId = logName.replace('.log', '');
                const newFileId = logId+'-'+Date.now();
                _logs.compress(logId, newFileId, err => {
                    if (!err) {
                        // Truncating the log
                        _logs.truncate(logId, err => {
                            if (!err) {
                                console.log("Success truncating logFile");
                            } else {
                                console.log("Error truncating logFile");
                            }
                        });
                    } else {
                        console.log('Error compressing one of the log files', err);
                    }
                });
            });
        } else {
            console.log('Error: Could not find any logs to rotate');
        }
    });
};

// Timer to execute the log-rotation
workers.logRotationLoop = () => {
    setInterval(() => {
        workers.rotateLogs();
    }, 1000 * 60 * 60 * 24);
};

// Init script
workers.init = () => {
    // Execute all the checks immediately
    workers.gatherAllChecks();

    // Call the loop so the checks will execute later on
    workers.loop();

    // Compress all the logs immediately
    workers.rotateLogs();

    // Call the compression loop so logs will be compress later on.
    workers.logRotationLoop();
}



// Export the module
module.exports = workers;
