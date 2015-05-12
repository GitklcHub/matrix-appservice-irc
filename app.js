"use strict";
var crc = require("crc");
var crypto = require("crypto");
var yaml = require("js-yaml");
var fs = require("fs");
var nopt = require("nopt");

var validator = require("./lib/config/validator");

// when invoked with 'node app.js', make an AS with just the IRC service.
var appservice = require("matrix-appservice");
var irc = require("./lib/irc-appservice.js");

var configFile = undefined;
var opts = nopt({
    "generate-registration": Boolean
});

// load the config file
try {
    configFile = yaml.safeLoad(fs.readFileSync('./config.yaml', 'utf8'));
} 
catch (e) {
    console.error(e);
    return;
}

var config = validator.loadConfig(configFile);
if (!config) {
    console.error("Failed to validate config file.");
    process.exit(1);
    return;
}
config.appService.service = irc;
config.appService.generateRegistration = opts["generate-registration"];

// make a checksum of the IRC server configuration. This will be checked against
// the checksum created at the last "--generate-registration". If there is a
// difference, it means that the user has failed to tell the HS of the new
// registration, so we can refuse to start until that is done.
var checksum = crc.crc32(JSON.stringify(config.servers)).toString(16);
var randomPart = crypto.randomBytes(32).toString('hex');
config.appService.homeserver.token = randomPart + "_crc" + checksum;
irc.configure(config);
appservice.registerService(config.appService);

if (config.appService.generateRegistration) {
    var fname = "appservice-registration-irc.yaml";
    console.log("Generating registration file to %s...", fname);
    appservice.getRegistration().done(function(registration) {
        fs.writeFile(fname, yaml.safeDump(registration), function(e) {
            if (e) {
                console.error("Failed to write registration file: %s", e);
                return;
            }
            console.log(" "+Array(74).join("="));
            console.log("   Generated registration file located at:");
            console.log("       %s", fname);
            console.log("");
            console.log("   The HS token this service looks for has been"+
                " updated. You MUST update");
            console.log("   the HS even if config.yaml was not modified."+
                " This file MUST be added");
            console.log("   to the destination home "+
                "server configuration file (e.g. 'homeserver.yaml'):");
            console.log("");
            console.log('       app_service_config_files: '+
                '["appservice-registration-irc.yaml"]');
            console.log(" "+Array(74).join("="));
            process.exit(0);
        });
    });
}
else {
    appservice.runForever();
}
