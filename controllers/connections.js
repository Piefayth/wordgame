var crypto = require('crypto');
var http = require('http');
var path = require('path');

module.exports = function(app, io, dict){
  var BOARD_SIZE = 50;
  var rooms = {};
  var developmentKey = new Buffer('realkeyhere');

  io.on('connection', function(socket){
    console.log("New Connection: " + socket.id);
    socket.auth = false;
    socket.roomid = socket.handshake.query.room;
    socket.game = socket.handshake.query.game;
    socket.username = socket.handshake.query.username;
    socket.board = [];
    socket.hand = [];
    socket.transitTiles = [];

    encryptProvidedKey(developmentKey, {'user': socket.username, 'room': socket.roomid, 'game': socket.game}, function(tkn){
      if (tkn == socket.handshake.query.token){
        socket.auth = true;
        socket.join(socket.roomid);
        if (!rooms[socket.roomid]){
          rooms[socket.roomid] = new Room(socket.roomid, socket.username, socket, socket.handshake.query.players.split(','));
        } else {
          rooms[socket.roomid].players[socket.username] = socket;
        }
        console.log(Object.keys(rooms[socket.roomid].players));
        if(rooms[socket.roomid].expectedPlayers.length == Object.keys(rooms[socket.roomid].players).length){
          for(var username in rooms[socket.roomid].players){
            rooms[socket.roomid].players[username].emit('initial-connect-success', {me: socket.username, players: Object.keys(rooms[socket.roomid].players)});
          }
        }
      }

    })


    socket.on('error', function(err){
      console.log(err);
      console.log('fuckin hate errors');
    })

    socket.on('ready-for-board', function(){
      console.log('im ready');
      var temp = [];
      for(var w = 0; w < BOARD_SIZE; w++){
        temp[w] = []
        for(var h = 0; h < BOARD_SIZE; h++){
          temp[w].push(0);
        }
      }
      handTiles(socket.roomid, socket);
      socket.board = temp;
      socket.emit('board', temp);
    })

    socket.on('disconnect', function(){
      delete socket;
    })

    socket.on('lift-square', function(data){
      if(socket.board[data.locationX][data.locationY] == data.letter){
        socket.board[data.locationX][data.locationY] = 0;
        console.log("Adding To Transit: " + data.letter);
        socket.transitTiles.push(data.letter);
        console.log("Lift Square: " + data.letter + " X: " + data.locationX + " Y " + data.locationY);
        var words = []
        if(socket.board[data.locationX-1])
          words = words.concat(getCreatedWords(socket.board, data.locationX-1, data.locationY));
        if(socket.board[data.locationX+1])
          words = words.concat(getCreatedWords(socket.board, data.locationX+1, data.locationY));
        words = words.concat(getCreatedWords(socket.board, data.locationX, data.locationY+1));
        words = words.concat(getCreatedWords(socket.board, data.locationX, data.locationY-1));
        console.log("WORDS TO HANDLE: " + words);
        words.forEach(function(word){
            console.log(word);
            socket.emit('play-letter-response', {word: word.word, valid: findWord(word.word), x: word.beginX, y: word.beginY, orientation: word.orientation});
        });
      }
    });

    socket.on('recycle-letter', function(data){
      if(rooms[socket.roomid].tiles.length <= 0){
        socket.emit('give-tile', data.letter);
      } else {
        if(data.origin == 'hand' && socket.hand.indexOf(data.letter) != -1){
          socket.hand.splice(socket.hand.indexOf(data.letter), 1);
        } else if (data.origin == 'board' && socket.transitTiles.indexOf(data.letter) != -1){
          socket.transitTiles.splice(socket.transitTiles.indexOf(data.letter), 1);
        }
        for(var i = 0; i < 3; i++){
          if(rooms[socket.roomid].tiles.length > 0){
            var tile = rooms[socket.roomid].tiles.pop();
            socket.hand.push(tile)
            socket.emit('give-tile', tile);
          }
        }
        var count = playerTileCount(socket);
        for(var username in rooms[socket.roomid].players){
          rooms[socket.roomid].players[username].emit('tiles-remaining', rooms[socket.roomid].tiles.length);
          rooms[socket.roomid].players[username].emit('player-tile-count', {name: socket.username, count: count});
        }
      }
    });

    socket.on('return-to-hand', function(data){
      if(socket.transitTiles.indexOf(data) != -1){
        socket.hand.push(data);
        socket.transitTiles.splice(socket.transitTiles.indexOf(data), 1);
      }

      /*DEBUG
      for(var username in rooms[socket.roomid].players){
        rooms[socket.roomid].players[username].emit('winner-announcement', socket.username);
      }

      someoneWon(socket);
      */
    });

    socket.on('play-letter', function(data){
      var letter = data['letter'];
      var locationX = data['locationX'];
      var locationY = data['locationY'];
      var origin = data['origin'];
      console.log("Attempt to Play: " + letter);
      if(origin == 'hand' && socket.hand.indexOf(letter) != -1){
        console.log(letter + " | " + " X: " + locationX + " Y: " + locationY + " Origin: " + origin);
        socket.hand.splice(socket.hand.indexOf(letter), 1);
        socket.board[locationX][locationY] = letter;
        var words = getCreatedWords(socket.board, locationX, locationY);
        words.forEach(function(word){
          socket.emit('play-letter-response', {word: word.word, valid: findWord(word.word), x: word.beginX, y: word.beginY, orientation: word.orientation});
        });
      } else {
        console.log("Tiles In Transit: " + socket.transitTiles);
        if(origin == 'board' && socket.transitTiles.indexOf(letter) != -1){
          console.log(letter + " | " + " X: " + locationX + " Y: " + locationY + " Origin: " + origin);
          socket.board[locationX][locationY] = letter;
          var words = getCreatedWords(socket.board, locationX, locationY);
          words.forEach(function(word){
            socket.emit('play-letter-response', {word: word.word, valid: findWord(word.word), x: word.beginX, y: word.beginY, orientation: word.orientation});
          });
          socket.transitTiles.splice(socket.transitTiles.indexOf(letter), 1);
        }
      }
      var count = playerTileCount(socket);
      for(var username in rooms[socket.roomid].players){
        rooms[socket.roomid].players[username].emit('player-tile-count', {name: socket.username, count: count});
      }
    })

    socket.on('validate-board', function(data){
      if(isBoardValid(socket)){
        if(rooms[socket.roomid].tiles.length > 0){
          for(var username in rooms[socket.roomid].players){
            var tile = rooms[socket.roomid].tiles.pop();
            rooms[socket.roomid].players[username].emit('give-tile', tile);
            rooms[socket.roomid].players[username].hand.push(tile);
          }
          var count = playerTileCount(socket);
          for(var username in rooms[socket.roomid].players){
            rooms[socket.roomid].players[username].emit('tiles-remaining', rooms[socket.roomid].tiles.length);
            rooms[socket.roomid].players[username].emit('player-tile-count', {name: socket.username, count: count});
          }
        } else {
          var winner;
          for(var username in rooms[socket.roomid].players){
            if(rooms[socket.roomid].players[username] == socket){
              winner = username;
            }
          }
          for(var username in rooms[socket.roomid].players){
            rooms[socket.roomid].players[username].emit('winner-announcement', socket.username);
          }

          someoneWon(socket);

        }
      };
    });

    socket.on('someone-won-response', function(data){
      console.log('bloop');
      someoneWonResponse(socket);
    })

  })



  function someoneWonResponse(socket){
    console.log('someone won response');
    socket.board = [];
    socket.hand = [];
    socket.transitTiles = [];
    delete rooms[socket.roomid].players[socket.username];
    console.log(Object.keys(rooms[socket.roomid].players));
    if(Object.keys(rooms[socket.roomid].players).length == 0){
      rooms[socket.roomid] = null;
      console.log('removed');
    }
    socket.leave(socket.roomid);
    socket.disconnect();

  }
  function someoneWon(socket){
    var data = {user: socket.username, room: socket.roomid, game: socket.game, token: socket.handshake.query.token};
    var sendData = JSON.stringify(data);

    var headers = {
      'Content-Type': 'application/json',
      'Content-Length': sendData.length
    };
    var options = {
      host: 'localhost',
      port: 3001,
      path: '/api/winner',
      method: 'POST',
      headers: headers
    };

    var req = http.request(options, function(res){});

    req.write(sendData);
    req.end();

  }

  function playerTileCount(socket){

    var failedLetterCount = 0;
    var boardLetterCount = 0;

    //Find largest group of letters
      //This involves first seperating the groups
    //Any failed words within that group counts against your total
      //But any failed words outside of it do not

    var board = [];

    for(var i = 0; i < socket.board.length; i++){
      for(var j = 0; j < socket.board.length; j++){
        if(!board[i])
          board[i] = [];
        board[i][j] = socket.board[i][j];
        if(board[i][j])
          boardLetterCount++;
      }
    }

    var largestResult = 0;

    for(var i = 0; i < board.length; i++){
      for(var j = 0; j < board[i].length; j++){
        if(board[i][j]){
          if(board[i][j] != "CHECKED"){
            var tempresult = [];
            var tempfailedcount = 0;
            checkLetters({x: i, y: j}, tempresult, board)
            console.log(tempresult);
            tempresult.forEach(function(pos){
            if(pos.x - 1 < 0 || !socket.board[pos.x - 1][pos.y]){
              var word = "";
              var wordindex = pos.x;
              while(socket.board[wordindex][pos.y]){
                word += socket.board[wordindex][pos.y];
                wordindex++;
              }
              if(word.length > 1){
                if(!findWord(word))
                  tempfailedcount += word.length;
              }
            }

            if(pos.y - 1 < 0 || !socket.board[pos.x][pos.y - 1]){
              var word = "";
              var wordindex = pos.y;
              while(socket.board[pos.x][wordindex]){
                word += socket.board[pos.x][wordindex];
                wordindex++;
              }
              if(word.length > 1){
                if(!findWord(word))
                  tempfailedcount += word.length;
              }
            }
          });
          if((tempresult.length - tempfailedcount) > largestResult){
            largestResult = tempresult.length - tempfailedcount;
          }
        }
      }
    }
  }



    //Total number of tiles
    return (boardLetterCount + socket.hand.length) - (largestResult);

  }

  function isBoardValid(socket){

    var start;
    var boardLetterCount = 0;
    var tempboard = [];

    /* CHECK EACH INDIVIDUAL WORD */


    for(var i = 0; i < socket.board.length; i++){
      for(var j = 0; j < socket.board[i].length; j++){
        if(socket.board[i][j]){
          if(!start)
            start = {x: i, y: j};
          if(!tempboard[i])
            tempboard[i] = [];
          tempboard[i][j] = socket.board[i][j];
          boardLetterCount++;

          //If [i-1] is empty OR out of bounds or if [j+1] is empty OR out of bounds (nothing left or nothing above)
          //Check the word either right or down
          //If any word fails, return false
          if(socket.board[i-1] && !socket.board[i-1][j] && socket.board[i+1] && socket.board[i+1][j]){
            var word = "";
            var wordindex = i;

            while(socket.board[wordindex] && socket.board[wordindex][j]){
              word += socket.board[wordindex][j];
              wordindex++;
            }
            console.log("Checking word: " + word);
            if(!findWord(word)){
              return false;
            }
          }

          if(!socket.board[i][j-1] && socket.board[i][j+1]){
            var word = "";
            var wordindex = j;
            while(socket.board[i][wordindex]){
              word += socket.board[i][wordindex];
              wordindex++;
            }
            console.log("Checking word: " + word);
            if(!findWord(word)){
              return false;
            }
          }

        }
      }
    }

    var totalLetters = [];

    checkLetters(start, totalLetters, tempboard);
    console.log("Letters In Group: " + totalLetters.length);
    console.log("Total Letters On Board: " + boardLetterCount);


    if(totalLetters.length == boardLetterCount){
      console.log("Board is Valid. Continue.");
      return true;
    }
  }

  function checkLetters(start, result, tempboard){
    if(tempboard[start.x + 1] && tempboard[start.x + 1][start.y] && tempboard[start.x + 1][start.y] != "CHECKED"){
      result.push({letter: tempboard[start.x + 1][start.y], x: start.x + 1, y: start.y});
      tempboard[start.x + 1][start.y] = "CHECKED";
      checkLetters({x: start.x + 1, y: start.y}, result, tempboard);
    }
    if(tempboard[start.x - 1] && tempboard[start.x - 1][start.y] && tempboard[start.x - 1][start.y] != "CHECKED"){
      result.push({letter: tempboard[start.x - 1][start.y], x: start.x - 1, y: start.y});
      tempboard[start.x - 1][start.y] = "CHECKED";
      checkLetters({x: start.x - 1, y: start.y}, result, tempboard);
    }
    if(tempboard[start.x][start.y + 1] && tempboard[start.x][start.y + 1] != "CHECKED"){
      result.push({letter: tempboard[start.x][start.y + 1], x: start.x, y: start.y + 1});
      tempboard[start.x][start.y + 1] = "CHECKED";
      checkLetters({x: start.x, y: start.y + 1}, result, tempboard);
    }
    if(tempboard[start.x][start.y - 1] && tempboard[start.x][start.y - 1] != "CHECKED"){
      result.push({letter: tempboard[start.x][start.y - 1], x: start.x, y: start.y - 1});
      tempboard[start.x][start.y - 1] = "CHECKED";
      checkLetters({x: start.x, y: start.y - 1}, result, tempboard);
    }
  }

  function handTiles(roomid, socket){
    var INITIAL_NUM_TILES = 15;
        for(var i = 0; i < INITIAL_NUM_TILES; i++){
          var tile = rooms[roomid].tiles.pop();
          socket.emit('give-tile', tile);
          socket.hand.push(tile)
        }
        for(var username in rooms[socket.roomid].players){
          rooms[socket.roomid].players[username].emit('tiles-remaining', rooms[socket.roomid].tiles.length);
        }
    }

  var Room = function (id, playername, playersocket, expectedPlayers){
    this.id = id;
    this.players = {};
    this.players[playername] =  playersocket;
    this.tiles = generateTiles();
    this.expectedPlayers = expectedPlayers;
    this.tilesHanded = false;
  }

  function getCreatedWords(board, x, y){
    /*
    board[x][y] is the letter that was changed
    traverse the board left from x (negative) until a blank square
    the word to check is everything from that blank square until another blank square or the end of the board
    repeat the process for y
    */

    var words = [];
    var checkx = x;
    var checky = y;
    while(board[checkx] && board[checkx][checky]){
      if(!board[checkx-1] || !board[checkx-1][checky]){
        var word = "";
        var wordindex = checkx;

        while(board[wordindex] && board[wordindex][checky]){
          word += board[wordindex][checky];
          wordindex++;
        }
        words.push({'word': word, beginX: checkx, beginY: checky, orientation: 'horizontal'})
        console.log(word + " X: " + checkx + " Y: " + checky);
      }
      checkx--;
    }

    checkx = x;

    while(board[checkx][checky]){
      if(!board[checkx][checky-1]){
        var word = "";
        var wordindex = checky;
        while(board[checkx][wordindex]){
          word += board[checkx][wordindex];
          wordindex++;
        }
        words.push({word: word, beginX: checkx, beginY: checky, orientation: 'vertical'})
        console.log(word + " X: " + checkx + " Y: " + checky);
      }
      checky--;
    }
    return words;
  }

  function generateTiles(){
    var numTiles = {'A': 9, 'B': 2, 'C': 2, 'D': 4, 'E': 12, 'F': 2, 'G': 3, 'H': 2, 'I': 9, 'J': 1, 'K': 1,
                    'L': 4, 'M': 2, 'N': 6, 'O': 8, 'P': 2, 'Q': 1, 'R': 6, 'S': 4, 'T': 6, 'U': 4, 'V': 2,
                    'W': 2, 'X': 1, 'Y': 2, 'Z': 1};
    var letters = [];

    for (var letter in numTiles){
      for(var i = 0; i < numTiles[letter]; i++){
        letters.push(letter);
      }
    }

    for(var i = letters.length - 1; i > 0; i--){
      var j = getRandomInt(0, i);
      var temp = letters[i];
      letters[i] = letters[j];
      letters[j] = temp;
    }

    return letters;
  }

  function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
  }


  function encryptProvidedKey(key, data, cb){
    var cipher = crypto.createCipher('aes256', key);
    var crypted = cipher.update(data['user'].toString() + data['room'].toString(), 'utf-8', 'hex');
    crypted += cipher.final('hex');

    return cb(crypted);
  }

  function findWord(word){
    if (dict[word.toLowerCase(0)]) return true;
    return false;
  }
}
