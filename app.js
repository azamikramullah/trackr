/**
 * Created by azamikramullah on 12/24/16.
 */


var config = require("./config.json")
var shippoToken = config.shippoToken;
var slackClientId= config.slackClient;
var slackSecret= config.slackSecret;
var express = require('express');
var https = require('https');
var bodyParser = require('body-parser');
var moment = require('moment');
var request = require('request');
var mongoose = require('mongoose');
mongoose.connect(config.mongoUrl);
var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {
    console.log("we're connected!");
});
moment().format();
var app = express();

app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());

var tokenSchema = mongoose.Schema({
    team: String,
    token: String
});
var token = mongoose.model('token', tokenSchema);

app.post('/package/status',function (req,res) {
    console.log("Webhook callback initiated. There is some status update");
    console.log(req.body);
    //var metaData = req.body.metadata.split(",");
    var userId = "U1W54LMNZ";//metaData[0];
    var teamId = "T1W55134P";//metaData[1];
    var botToken;

    token.findOne({team: teamId}, function(err,doc){
        botToken = doc.token;
        sendStatusUpdate(botToken, userId, req.body);
    });

    res.send("OK");


});

app.get('/token', function (req, res) {
    var options = {
        host: 'slack.com',
        method: 'GET',
        path: '/api/oauth.access?client_id=' + slackClientId + "&client_secret=" + slackSecret + "&code=" + req.query.code
    };

    callback = function(response) {
        var str = '';
        response.on('data', function (chunk) {
            str += chunk;
        });
        response.on('end', function () {
            var data = JSON.parse(str);
            console.log(data);
            var oAuthToken = new token({team:data.team_id, token:data.bot.bot_access_token});
            oAuthToken.save(function (err,token) {
                if (err) return console.error(err);
                console.log("saved")
            });
        });
    }
    https.request(options,callback).end();
    res.send();

});

app.post('/notification', function(req,res){

    var postData = {};
    if(req.body.text.substring(0,1) == "9"){
        postData.carrier = "usps";
    } else if(req.body.text.substring(0,2) == '1Z'){
        postData.carrier = "ups";
    } else if(req.body.text.length == 12 || req.body.text.length == 15){
        postData.carrier = "fedex";
    } else if(req.body.text == ""){
        res.send("Hey there neighbor! Go ahead and give me a UPS, USPS or FedEx tracking number and I'll notify you when the status changes!!");
        return;
    } else {
        res.send("Shoot! I don't recognize that tracking number, sorry! :(");
        return;
    }
    postData.tracking_number = req.body.text;
    postData.metadata= req.body.user_id + "," + req.body.team_id;
    console.log(postData);

    request({
        url: "https://api.goshippo.com/tracks/",
        method: "POST",
        json: true,   // <--Very important!!!
        headers:{Authorization:"ShippoToken " + shippoToken},
        body: postData
    }, function (error, response, body){
        console.log(response.statusCode);
        res.send("Cool, I'll let you know of any updates. You can count on me :)")
    });

});

app.post('/package', function (req, res) {

    var options = {
        host:'api.goshippo.com',
        method: 'GET',
        headers : {
            authorization : 'ShippoToken ' + shippoToken
        },
        path : '/tracks/'
    };

    if(req.body.text.substring(0,1) == "9"){
        options.path += "usps/";
    } else if(req.body.text.substring(0,2) == '1Z'){
        options.path += "ups/";
    } else if(req.body.text.length == 12 || req.body.text.length == 15){
        options.path += "fedex/";
    } else if(req.body.text == ""){
        res.send("Hey there neighbor! Go ahead and give me a UPS, USPS or FedEx tracking number and I'll try to track it for you!");
        return;
    } else {
        res.send("Shoot! I don't recognize that tracking number, sorry! :(");
        return;
    }
    options.path += req.body.text;

    callback = function(response) {
        var str = '';
        response.on('data', function (chunk) {
            str += chunk;
        });
        response.on('end', function () {
           var packageData = JSON.parse(str);
           var attachments = getAttachments(packageData.tracking_history);
           var responseData = {text:"Cool, got it! Here's what I've got so far", attachments:attachments, mrkdwn:false};
           res.send(responseData);
        });
    }
    https.request(options,callback).end();
})

function getAttachments(history){
    var attachments = [];
    for(x=history.length-1;x>=(history.length-3);x--){
        if(x<0){
            break;
        }
        var attachment = {};
        attachment.text = history[x].status_details;
        if(history[x].status == "DELIVERED"){
            attachment.color = "good";
        } else if(history[x].status == "FAILURE"){
            attachment.color = "danger";
        } else if(history[x].status == "UNKNOWN"){
            attachment.color = "warning";
        }

        attachment.fields=[];
        if(history[x].location != null){
            attachment.fields.push({
                title:"Location",
                value:history[x].location.city + ", " + history[x].location.state,
                short:true
            });
        }

        attachment.fields.push({
            title:"Date",
            value: moment(history[x].status_date).format('MMMM Do YYYY, h:mm a'),
            short:true
        })
        attachments.push(attachment);
    }
    return attachments;
}

function sendStatusUpdate(botToken, userId, update){
    var channelId;
    var attatchment;
    var postData = {};
    request({
        url: "https://slack.com/api/im.open?token="+botToken+"&user=" +userId,
        method: "GET",
        json: true   // <--Very important!!!
    }, function (error, response, body){
        console.log(response.statusCode);
        console.log(body);
        channelId = body["channel"]["id"];
        console.log(channelId);
        attatchment = getAttachments([update.tracking_status]);
        postData.attachments = attatchment;
        console.log(attatchment);
        console.log(JSON.stringify(attatchment));
        postData.text = "Your package (" +update.tracking_number + ") is on the move, here's the latest!";
        postData.token = botToken;
        postData.channel = channelId;
        postData.as_user=false;
        postData.icon_emoji=":package:";
        request({
            url: "https://slack.com/api/chat.postMessage?token=" +botToken+"&channel=" + channelId+"&text="+postData.text+ "&attachments="+JSON.stringify(attatchment)+
            "&as_user=false&icon_emoji=:package:",
            method: "GET",
            json: true,
        },function(err,resp,bod){
            console.log(bod);
        });
    });
}

app.listen(8081, function () {
    console.log('Trackr app listening on port 8081!')
})