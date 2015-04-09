"use strict";
var q = require("q");
var extend = require("extend");

// set up integration testing mocks
var proxyquire =  require('proxyquire');
var clientMock = require("../util/client-sdk-mock");
clientMock["@global"] = true; 
var ircMock = require("../util/irc-mock");
ircMock["@global"] = true;
var dbHelper = require("../util/db-helper");
var asapiMock = require("../util/asapi-controller-mock");

// ADDITIONAL MOCKS FOR AUTH WEB SERVER
var authExpressMock = require("../util/auth-express-mock");
authExpressMock["@global"] = true;

// set up test config
var appConfig = extend(true, {}, require("../util/config-mock"));
var roomMapping = appConfig.roomMapping;

// augment the config with irc auth
var ircAuthServer = "irc.auth.only";
appConfig.ircConfig.servers[ircAuthServer] = {
    nick: "authbot",
    expose: {
        channels: true
    },
    auth: {
        type: "cas",
        url: "https://cas.irc.auth.only.com"
    }
};
appConfig.ircConfig.auth = {
    redirectBase: "https://redirected-url.irc.auth.only",
    port: 4567
};

describe("Creating admin rooms", function() {
    var ircService = null;
    var mockAsapiController = null;

    var botUserId = "@"+appConfig.botLocalpart+":"+appConfig.homeServerDomain;

    beforeEach(function(done) {
        console.log(" === Admin Rooms [create] Test Start === ");
        ircMock._reset();
        clientMock._reset();
        authExpressMock(true)._reset();
        ircService = proxyquire("../../lib/irc-appservice.js", {
            "matrix-js-sdk": clientMock,
            "irc": ircMock,
            "express": authExpressMock
        });
        mockAsapiController = asapiMock.create();

        // do the init
        dbHelper._reset(appConfig.databaseUri).then(function() {
            ircService.configure(appConfig.ircConfig);
            return ircService.register(mockAsapiController, appConfig.serviceConfig);
        }).done(function() {
            done();
        });
    });

    it("should be possible by sending an invite to the bot's user ID", 
    function(done) {
        var botJoinedRoom = false;
        var sdk = clientMock._client();
        sdk.joinRoom.andCallFake(function(roomId) {
            expect(roomId).toEqual("!adminroomid:here");
            botJoinedRoom = true;
            return q({});
        });

        mockAsapiController._trigger("type:m.room.member", {
            content: {
                membership: "invite",
            },
            state_key: botUserId,
            user_id: "@someone:somewhere",
            room_id: "!adminroomid:here",
            type: "m.room.member"
        }).done(function(e) {
            expect(botJoinedRoom).toBe(true);
            done();
        });
    });
});

describe("Admin rooms", function() {
    var ircService = null;
    var mockAsapiController = null;
    var sdk = null;

    var adminRoomId = "!adminroomid:here";
    var userId = "@someone:somewhere";
    var botUserId = "@"+appConfig.botLocalpart+":"+appConfig.homeServerDomain;

    beforeEach(function(done) {
        console.log(" === Admin Rooms Test Start === ");
        ircMock._reset();
        clientMock._reset();
        authExpressMock(true)._reset();
        ircService = proxyquire("../../lib/irc-appservice.js", {
            "matrix-js-sdk": clientMock,
            "irc": ircMock,
            "express": authExpressMock
        });
        mockAsapiController = asapiMock.create();

        // auto-join an admin room
        sdk = clientMock._client();
        sdk.joinRoom.andCallFake(function(roomId) {
            expect(roomId).toEqual(adminRoomId);
            return q({});
        });

        // do the init
        dbHelper._reset(appConfig.databaseUri).then(function() {
            ircService.configure(appConfig.ircConfig);
            return ircService.register(mockAsapiController, appConfig.serviceConfig);
        }).then(function() {
            // auto-setup an admin room
            return mockAsapiController._trigger("type:m.room.member", {
                content: {
                    membership: "invite",
                },
                state_key: botUserId,
                user_id: userId,
                room_id: adminRoomId,
                type: "m.room.member"
            });
        }).done(function() {
            done();
        });
    });

    it("should respond to bad !join commands with a help notice", function(done) {
        var sentNotice = false;
        sdk.sendMessage.andCallFake(function(roomId, content) {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            sentNotice = true;
            return q();
        });

        mockAsapiController._trigger("type:m.room.message", {
            content: {
                body: "!join blargle",
                msgtype: "m.text"
            },
            user_id: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        }).done(function() {
            expect(sentNotice).toBe(true);
            done();
        });
    });

    it("should ignore messages sent by the bot", function(done) {
        mockAsapiController._trigger("type:m.room.message", {
            content: {
                body: "!join blargle",
                msgtype: "m.text"
            },
            user_id: botUserId,
            room_id: adminRoomId,
            type: "m.room.message"
        }).catch(function(e) {
            done();
        });
    });

    it("should provide an auth url when given a valid !join by an unauthed user",
    function(done) {
        var sentNotice = false;
        var redirectUrl = appConfig.ircConfig.servers[ircAuthServer].auth.url;
        sdk.sendMessage.andCallFake(function(roomId, content) {
            expect(roomId).toEqual(adminRoomId);
            expect(content.body).toContain(redirectUrl);
            expect(content.msgtype).toEqual("m.notice");
            sentNotice = true;
            return q();
        });

        mockAsapiController._trigger("type:m.room.message", {
            content: {
                body: "!join "+ircAuthServer+" #foo",
                msgtype: "m.text"
            },
            user_id: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        }).done(function(e) {
            expect(sentNotice).toBe(true);
            done();
        });
    });
});