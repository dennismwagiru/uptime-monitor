/*
 * Helpers for various tasks
 * @created 15/01/2021 - 11:46 PM
 * @project app
 * @author  denni
*/

// Dependencies
var crypto = require('crypto');
var config = require('./config');

// Container for all the helpers
const helpers = {};

// Create a SHA256 has
helpers.hash = function (str){
    if (typeof(str) == 'string' && str.length > 0){
        return crypto.createHmac('sha256', config.hashingSecret).update(str).digest('hex');
    } else { return false }
};

// Parse a JSON string to an object in all cases, without throwing
helpers.parseJsonToObject = function (str){
    try{
        return JSON.parse(str);
    } catch (e){
        return {};
    }
}


// Export the module
module.exports = helpers;
