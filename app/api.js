var express = require('express')
var app = express()
var fs = require('fs')
var multiparty = require('connect-multiparty')
var multipartyMiddelware = multiparty()
 
var mysql = require('mysql')
var mysqlSettings = require('../config/db-config.json')
var mysqlPool = mysql.createPool(mysqlSettings)

var authorizedUsers = require('../config/autorized-users.json')


function authorizeAdmin (req) {
  if (!req.session || !req.session.user) { return false }
  if (authorizedUsers.admins.indexOf(req.session.user.username) === -1) { return false }
  return true
}
function authorizeMod (req) {
  if (!req.session || !req.session.user) { return false }
  if (authorizedUsers.mods.indexOf(req.session.user.username) === -1) { return false }
  return true
}


module.exports = app.post('/addVote', function (req, res) {
  if (!req.session || !req.session.user) { return res.json({error: 'Not logged in'}) }
  var username = req.session.user.username
  var number   = parseInt(req.body.vote)
  var comicId  = req.body.comicId

  var removeQuery = 'DELETE FROM ComicVote WHERE Username = ? AND ComicId = ?'
  var insertQuery = 'INSERT INTO ComicVote (Username, ComicId, Vote) VALUES (?, ?, ?)'
  var newRatingQuery = 'SELECT AVG(Vote) AS avg FROM ComicVote WHERE ComicId = ?'

  mysqlPool.getConnection(function (err, connection) {
    connection.query(removeQuery, [username, comicId], function (err2, results, fields) {
      if (err2) {return connection.release()}

      if (number > 0) {
        connection.query(insertQuery, [username, comicId, number], function (err3, results2, fields2) {
          if (err3) {return connection.release()}

          connection.query(newRatingQuery, [comicId], function (err4, results3, fields3) {
            if (err4) {return connection.release()}
            res.json(results3[0]['avg'])
            connection.release()
          })
        })
      }
      else {
        connection.query(newRatingQuery, [comicId], function (err4, results3, fields3) {
          if (err4) {return connection.release()}
          res.json(results3[0]['avg'])
          connection.release()
        })
      }
    })
  })
})


function returnError (errorCode, errorMessage, res, mysqlConnection, err) {
  if (err) {console.log(err)}
  if (res) { res.json({ error: errorMessage }) }
  if (mysqlConnection) { mysqlConnection.release() }
}


app.get('/listRagGetImages', (req, res) => {
  let query = 'SELECT Id AS id, Artist AS artist, Rating AS rating, Added AS added, Pup as pp FROM ListRagImage'
  mysqlPool.getConnection((err, connection) => {
    connection.query(query, (err, imageResults) => {
      if (err) { return returnError(500, 'MySql error: ' + err.toString(), res, connection, err) }

      let comeCountQuery = 'SELECT ImageId AS imageId, Count(*) AS count FROM ListRagComeCounts GROUP BY ImageId'
      connection.query(comeCountQuery, (err, results) => {
        if (err) { return returnError(500, 'MySql error: ' + err.toString(), res, connection, err) }

        resultsDict = {}
        for (var r of results) {
          resultsDict[r.imageId] = r.count
        }

        for (var i of imageResults) {
          if (resultsDict.hasOwnProperty(i.id)) { i.comeCount = resultsDict[i.id] }
          else { i.comeCount = 0 }
        }

        res.json(imageResults)     
        connection.release()
      })
    })
  })
})

app.post('/listRagLogClick', (req, res) => {
  if (req.session && req.session.user && req.session.user.username == 'malann') {
    return
  }
  let user
  let imageId = req.body.imageId
  if (req.session && req.session.user) {
    user = req.session.user.username
  }
  else {
    user = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || (req.connection.socket ? req.connection.socket.remoteAddress : 'none')
  }
  let query = 'INSERT INTO ListLog (imageId, userIp) VALUES (?, ?)' 

  mysqlPool.getConnection((err, connection) => {
    connection.query(query, [imageId, user], (err, results) => {
      if (err) { return returnError(500, 'MySql error: ' + err.toString(), res, connection, err) }
      res.json({status: 'ok'})
      connection.release()
    })
  })
})

app.post('/listRagRecordCome', (req, res) => {
  let user 
  if (req.session && req.session.user) {
    user = req.session.user.username
  }
  else {
    user = 'Guest'
  }
  let query = 'INSERT INTO ListRagComeCounts (ImageId, Username) VALUES (?, ?)'
  let queryParams = [req.body.imageId, user]

  mysqlPool.getConnection((err, connection) => {
    connection.query(query, queryParams, (err, results) => {
      if (err) { return returnError(500, 'MySql error', res, connection, err) }
      res.json({status: 'ok'})
      connection.release()
    })
  })
})

app.get('/listRagLog', (req, res) => {
  let query = 'SELECT * FROM ListLog order by tid desc'
  mysqlPool.getConnection((err, connection) => {
    connection.query(query, (err, results) => {
      if (err) { return returnError(500, 'MySql error: ' + err.toString(), res, connection, err) }
      res.json({log: results})
      connection.release()
    })
  })
})

app.post('/listRagAssignRating', (req, res) => {
  if (!req.session || !req.session.user || !req.session.user.username || req.session.user.username != 'malann') {
    return
  }
  let imageId = req.body.id
  let newRating = req.body.newRating
  let query = 'UPDATE ListRagImage SET Rating = ? WHERE Id = ?'
  mysqlPool.getConnection((err, connection) => {
    connection.query(query, [newRating, imageId], (err, results) => {
      if (err) { return returnError(500, 'MySql error: ' + err.toString(), res, connection, err) }
      res.json({status: 'ok'})
      connection.release()
      archiveNewRating(imageId, newRating)
    })
  })
})


app.post('/answerPoll', async (req, res) => {
  let user = (req.session && req.session.user) ? req.session.user.username : req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || (req.connection.socket ? req.connection.socket.remoteAddress : 'none')
  if (!req.body.dismissPoll) {
    let questionAnswers = req.body.questionAnswers
  
    let query = 'INSERT INTO surveyresponse (User, QuestionDescription, QuestionResponse, QuestionName) VALUES (?, ?, ?, ?)'
    let queryParams = questionAnswers.map(qa => [user, qa.title, qa.answer, qa.name])
    
    mysqlPool.getConnection(async (err, connection) => {
      try {
        for (var queryParam of queryParams) {
          await mysqlPool.query(query, queryParam)
        }
      }
      catch (err) {
        console.log(err)
      }
      connection.release()
      res.end('ok')
    })
  }
  else {
    let query = 'INSERT INTO surveyresponse (User, QuestionDescription, QuestionResponse, QuestionName) VALUES (?, ?, ?, ?)'
    let queryParams = [user, 'X', 'dismiss', 'X']
    mysqlPool.getConnection(async (err, connection) => {
    try {
      await mysqlPool.query(query, queryParams)
    }
      catch (err) {
      console.log(err)
    } 
      connection.release()
      res.end('ok')
  })
  }
})


function archiveNewRating (imageId, newRating) {
  let query = 'INSERT INTO ListRagRatingArchive (Id, Rating, Timestamp) VALUES (?, ?, NOW())'
  mysqlPool.getConnection((err, connection) => {
    connection.query(query, [imageId, newRating], (err, results) => {
      if (err) { return returnError(500, 'MySql error: ' + err.toString(), null, connection, err) }
      connection.release()
    })
  })
}


function logNode (req, message) {
  var time = (new Date()).toISOString()
  var user = false
  if (req.session && req.session.user) { user = req.session.user.username }
  var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || (req.connection.socket ? req.connection.socket.remoteAddress : 'none')

  var lengthOfUser = 0
  var maxPathLength = 50
  var maxStringLength = 15
  if (user) {lengthOfUser = (String(user)).length}
  else if (ip) {lengthOfUser = (String(ip)).length}

  var firstSpaceCount = (maxStringLength-lengthOfUser < 0) ? 1 : maxStringLength-lengthOfUser
  var secondSpaceLength = (maxPathLength-message.length < 0) ? 1 : maxPathLength-message.length

  console.log(`[${user||ip}] ${' '.repeat(firstSpaceCount)}${message} ${' '.repeat(secondSpaceLength)}[${time}]`)
}
