var express = require('express');
var app = express();
var server = require('http').Server(app);
var io = require('socket.io')(server);
//var io = require('socket.io')(server, {resource: '/wordthing/socket.io', origins: 'http://localhost:3002'});
var fs = require('fs');
var path = require('path');

var tdict = [];
var dict = {};

var filePath = path.join(__dirname, 'sowpods.txt');
var data = fs.readFileSync(filePath, {encoding: 'utf-8'});
tdict = data.split('\n');
tdict.forEach(function(word){
	dict[word] = true;
});

require('./controllers/connections')(app,io, dict);

server.listen(3002, function(){
	console.log('Game started');
})
