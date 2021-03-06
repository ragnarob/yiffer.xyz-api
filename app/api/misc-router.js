import FileSystemFacade from '../fileSystemFacade.js'
import BaseRouter, { ApiError } from './baseRouter.js'
import { processComicPage } from '../image-processing.js'

import multer from 'multer'
var storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads')
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now())
  }
})
var upload = multer({ storage: storage })

import dateFns from 'date-fns'
const { format } = dateFns

export default class MiscRouter extends BaseRouter {
  constructor (app, databaseFacade, modLogger) {
    super(app, databaseFacade, modLogger)
    this.setupRoutes()
  }

  setupRoutes () {
    this.app.get ('/api/comicsuggestions', this.authorizeMod.bind(this), (req, res) => this.getComicSuggestions(req, res))
    this.app.get ('/api/comicsuggestions/rejected', (req, res) => this.getRejectedComicSuggestions(req, res))
    this.app.post('/api/comicsuggestions', (req, res) => this.addComicSuggestion(req, res))
    this.app.post('/api/comicsuggestions/:id/process', this.authorizeMod.bind(this), (req, res) => this.processComicSuggestion(req, res))

    this.app.get ('/api/modlog', this.authorizeMod.bind(this), (req, res) => this.getModLog(req, res))
    this.app.get ('/api/modscores', this.authorizeMod.bind(this), (req, res) => this.getModScores(req, res))
  
    this.app.post('/api/swapcomicpages', this.authorizeMod.bind(this), (req, res) => this.swapComicPages(req, res))
    this.app.post('/api/insertcomicpage', this.authorizeMod.bind(this), upload.single('newPageFile'), (req, res) => this.insertComicPage(req, res))
    this.app.post('/api/deletecomicpage', this.authorizeMod.bind(this), (req, res) => this.deletecomicpage(req, res))

    this.app.post('/api/log-route', (req, res) => this.logRoute(req, res))
    this.app.post('/api/log-event', (req, res) => this.logEvent(req, res))

    this.app.get('/api/stats/routes', this.authorizeMod.bind(this), (req, res) => this.getRouteStats(req, res))
    this.app.get('/api/stats/visitors', this.authorizeMod.bind(this), (req, res) => this.getVisitorStats(req, res))
    this.app.get('/api/stats/comic-views', this.authorizeMod.bind(this), (req, res) => this.getComicViewStats(req, res))

    this.app.post('/api/mod-applications', (req, res) => this.createModApplication(req, res))
    this.app.get ('/api/mod-applications', this.authorizeAdmin.bind(this), (req, res) => this.getModApplications(req, res))
    this.app.post('/api/mod-applications/:id', this.authorizeAdmin.bind(this), (req, res) => this.processModApplication(req, res))
    this.app.get ('/api/mod-applications/me', this.authorizeUser.bind(this), (req, res) => this.getMyModApplicationStatus(req, res))

    this.app.post  ('/api/feedback', (req, res) => this.submitFeedback(req, res))
    this.app.get   ('/api/feedback', this.authorizeMod.bind(this), (req, res) => this.getFeedback(req, res))
    this.app.delete('/api/feedback/:id', this.authorizeMod.bind(this), (req, res) => this.deleteFeedback(req, res))
    this.app.patch ('/api/feedback/:id/read', this.authorizeMod.bind(this), (req, res) => this.markFeedbackRead(req, res))
  }

  async getComicSuggestions (req, res) {
    let query = 'SELECT comicsuggestion.Id AS id, Name AS name, ArtistName AS artist, Description AS description, user.username AS user, comicsuggestion.UserIP AS userIP FROM comicsuggestion LEFT JOIN user ON (comicsuggestion.User = user.Id) WHERE Processed=0 ORDER BY Timestamp ASC'
    try {
      let result = await this.databaseFacade.execute(query, null, 'Database query error')
      res.json(result)
    }
    catch(err) {
      return this.returnError(err.message, res, err.error)
    }
  }

  async getRejectedComicSuggestions (req, res) {
    let query = 'SELECT Name AS name, ArtistName AS artist, Reason AS reason FROM comicsuggestion WHERE Approved=0 AND ShowInList=1 ORDER BY Timestamp DESC'
    try {
      let result = await this.databaseFacade.execute(query, null, 'Database query error')
      res.json(result)
    }
    catch(err) {
      return this.returnError(err.message, res, err.error)
    }  
  }

  async addComicSuggestion (req, res) {
    try {
      let [comicName, artist, comment] = [req.body.comicName, req.body.artist, req.body.comment]

      let existingSuggestionsQuery = 'SELECT * FROM comicsuggestion WHERE Name LIKE ?'
      let existingSuggestions = await this.databaseFacade.execute(existingSuggestionsQuery, [comicName], 'Database error occurred when fetching existing suggestions list')
      if (existingSuggestions.length > 0) {
        return this.returnApiError(res, new ApiError('This comic name has already been suggested', 400))
      }

      let existingComicQuery = 'SELECT * FROM comic WHERE Name LIKE ?'
      let existingComics = await this.databaseFacade.execute(existingComicQuery, [comicName], 'Database error occurred when fetching list of comics')
      if (existingComics.length > 0) {
        return this.returnApiError(res, new ApiError('A comic with this name already exists!', 400))
      }

      let user = await this.getUser(req)
      let userParam = user ? user.id : req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || (req.connection.socket ? req.connection.socket.remoteAddress : null)
      let query = `INSERT INTO comicsuggestion (Name, ArtistName, Description, ${user ? 'User' : 'UserIP'}) VALUES (?, ?, ?, ?)`
      let queryParams = [comicName, artist, comment, userParam]

      await this.databaseFacade.execute(query, queryParams, 'Database error occurred when adding suggestion')
      res.status(204).end()
    }
    catch (err) {
      this.returnApiError(res, err)
    }
  }

  async processComicSuggestion (req, res) {
    let [isApproved, shouldShowInList, reason, suggestionId] = 
      [req.body.isApproved, req.body.shouldShowInList, req.body.reason, req.params.id]
      
    try {
      if (isApproved) {
        await this.processApprovedSuggestion(res, suggestionId)
      }
      else {
        await this.processNotApprovedSuggestion(res, suggestionId, shouldShowInList, reason)
      }

      let suggestionDetails = (await this.databaseFacade.execute('SELECT Name, ArtistName, Description FROM comicsuggestion WHERE Id=?', [suggestionId]))[0]

      let actionString = isApproved ? 'Approve' : (shouldShowInList ? 'Reject-list' : 'Reject-spam')
      let modReasonString = shouldShowInList ? ` \nMod reason: "${reason}".` : ''

      this.addModLog(req, 'Comic suggestion', `${actionString} ${suggestionDetails.Name}`, `${suggestionDetails.Name} by ${suggestionDetails.ArtistName}. User desc: "${suggestionDetails.Description}".${modReasonString}`)
    }
    catch (err) {
      return this.returnError(err.message, res, err.error)
    }
  }

  async processApprovedSuggestion (res, suggestionId) {
    let query = 'UPDATE comicsuggestion SET Processed=1, Approved=1 WHERE Id=?'
    let queryParams = [suggestionId]

    await this.databaseFacade.execute(query, queryParams, 'Database error')
    res.json({success: true})
  }

  async processNotApprovedSuggestion (res, suggestionId, shouldShowInList, reason) {
    let query = 'UPDATE comicsuggestion SET Processed=1, Approved=0, ShowInList=?, Reason=? WHERE Id=?'
    let queryParams = [shouldShowInList, reason, suggestionId]

    await this.databaseFacade.execute(query, queryParams, 'Database error')
    res.json({success: true})
  }

  async getModLog (req, res) {
    let query = 'SELECT modlog.Id AS id, user.Username AS username, ActionType AS actionType, ActionDescription AS actionDescription, ActionDetails AS actionDetails, Timestamp AS timestamp FROM modlog INNER JOIN user ON (modlog.User=user.Id) ORDER BY Timestamp DESC'
    try { 
      let result = await this.databaseFacade.execute(query)
      res.json(result)
    }
    catch (err) {
      return this.returnError(err.message, res, err.error)
    }
  }

  async getModScores (req, res) {
    let query = 'SELECT modlog.ActionType, modlog.ActionDescription, user.Username FROM modlog INNER JOIN user ON (user.Id=modlog.User)'
    try {
      let logs = await this.databaseFacade.execute(query)
      
      let userScores = {}
      for (var log of logs) {
        if (!(log.Username in userScores)) { userScores[log.Username] = 0 }
        userScores[log.Username] += this.getActionScore(log.ActionType, log.ActionDescription)
      }
      let userScoreList = Object.keys(userScores).map(us => 
        new Object({'username': us, 'score': userScores[us]}))
      userScoreList.sort((a, b) => a.score > b.score ? 1 : -1)
      res.json(userScoreList)
    }
    catch (err) {
      return this.returnError(err.message, res, err.error)
    }
  }

  getActionScore (actionType, actionDescription) {
    if (actionType === 'Comic') {
      if (actionDescription.includes('Append')) {
        return 30
      }
      if (actionDescription.includes('Update details of')) {
        return 15
      }
      if (actionDescription.includes('thumbnail to')) {
        return 30
      }
      if (actionDescription.includes('Swap pages')) {
        return 40
      }
      if (actionDescription.includes('Insert page')) {
        return 40
      }
      if (actionDescription.includes('Delete page')) {
        return 40
      }
    }
    else if (actionType === 'Create comic') {
      return 170
    }
    else if (actionType === 'Pending comic') {
      if (actionDescription.includes('Approve ') || actionDescription.includes('Reject ')) {
        return 15
      }
      if (actionDescription.includes('Add thumbnail to')) {
        return 30
      }
      if (actionDescription.includes(' keywords to ') || actionDescription.includes(' keywords from ')) {
        return 10
      }
      if (actionDescription.includes('Append ')) {
        return 30
      }
      if (actionDescription.includes('Delete old')) {
        return 70
      }
      if (actionDescription.includes('Update data of')) {
        return 15
      }
    }
    else if (actionType === 'Artist') {
      if (actionDescription.includes('Add ')) {
        return 10
      }
      if (actionDescription.includes('Update ')) {
        return 20
      }
    }
    else if (actionType === 'Keyword') {
      if (actionDescription.includes('Remove') && actionDescription.includes(' from ')) {
        return 10
      }
      if (actionDescription.includes('Add') && actionDescription.includes(' to ')) {
        return 10
      }
      if (actionDescription.includes('Add')) {
        return 20
      }
      if (actionDescription.includes('Approve') || actionDescription.includes('Reject')) {
        return 5
      }
    }
    else if (actionType === 'Comic suggestion') {
      return 15
    }
    else {
      console.log('Failed to get action score, type and desc: ', actionType, actionDescription)
      return 0
    }
    return 0
  }

  async swapComicPages (req, res) {
    let [comicName, pageNumber1, pageNumber2] = 
      [req.body.comicName, req.body.pageNumber1, req.body.pageNumber2]
    let pageName1 = this.getPageName(pageNumber1)
    let pageName2 = this.getPageName(pageNumber2)

    try {
      await FileSystemFacade.renameGoogleComicFile(
        `${comicName}/${pageName1}.jpg`,
        `${comicName}/temp.jpg`,
      )
      await FileSystemFacade.renameGoogleComicFile(
        `${comicName}/${pageName2}.jpg`,
        `${comicName}/${pageName1}.jpg`,
      )
      await FileSystemFacade.renameGoogleComicFile(
        `${comicName}/temp.jpg`,
        `${comicName}/${pageName2}.jpg`,
      )

      res.json({success: true})
      this.addModLog(req, 'Comic', `Swap pages in ${comicName}`, `Page ${pageNumber1} and ${pageNumber2}`)
    }
    catch (err) {
      return this.returnError(err.message, res, err.error, err)
    }
  }

  async insertComicPage (req, res) {
    let [comicName, comicId, newPageFile, insertAfterPageNumber] =
      [req.body.comicName, req.body.comicId, req.file, Number(req.body.insertAfterPageNumber)]

    try {
      if (!newPageFile) {
        return this.returnApiError('Uploaded file not found', 400)
      }

      let numberOfPagesQuery = 'SELECT NumberOfPages FROM comic WHERE Id=?'
      let numberOfPagesRes = await this.databaseFacade.execute(numberOfPagesQuery, [comicId])
      let numberOfPages = numberOfPagesRes[0].NumberOfPages

      await processComicPage(newPageFile)

      for (let pageNo=numberOfPages; pageNo >= insertAfterPageNumber+1; pageNo--) {
        await FileSystemFacade.renameGoogleComicFile(
          `${comicName}/${this.getPageName(pageNo)}.jpg`,
          `${comicName}/${this.getPageName(pageNo+1)}.jpg`,
        )
      }

      await FileSystemFacade.writeGoogleComicFile(
        newPageFile.path,
        comicName,
        `${this.getPageName(insertAfterPageNumber+1)}.jpg`,
      )

      let query = 'UPDATE comic SET NumberOfPages=? WHERE Id=?'
      let queryParams = [numberOfPages+1, comicId]
      await this.databaseFacade.execute(query, queryParams, 'Error updating number of pages')

      res.status(204).end()
      FileSystemFacade.deleteFile(newPageFile.path)
      this.addModLog(req, 'Comic', `Insert page in ${comicName}`, `Page at position ${insertAfterPageNumber+1}`)
    }
    catch (err) {
      return this.returnApiError(res, err)
    }
  }

  async deletecomicpage (req, res) {
    let [comicName, comicId, pageNumber] = [req.body.comicName, req.body.comicId, req.body.pageNumber]
    let numberOfPagesQuery = 'SELECT NumberOfPages FROM comic WHERE Id = ?'
    let updateQuery = 'UPDATE comic SET NumberOfPages = ? WHERE Id = ?'
    try {
      let numberOfPages = (await this.databaseFacade.execute(numberOfPagesQuery, [comicId]))[0].NumberOfPages
      let queryParams = [numberOfPages-1, comicId]

      await FileSystemFacade.deleteGoogleComicFile(`${comicName}/${this.getPageName(pageNumber)}.jpg`)

      for (var i=pageNumber+1; i<=numberOfPages; i++) {
        await FileSystemFacade.renameGoogleComicFile(
          `${comicName}/${this.getPageName(i)}.jpg`,
          `${comicName}/${this.getPageName(i-1)}.jpg`
        )
      }
      await this.databaseFacade.execute(updateQuery, queryParams, 'Error updating number of pages')

      res.json({success: true})
      this.addModLog(req, 'Comic', `Delete page in ${comicName}`, `Page ${pageNumber}`)
    }
    catch (err) {
      return this.returnError(err.message, res, err.error)
    }
  }

  async logEvent (req, res) {
    try {
      let query = 'INSERT INTO eventlog (event, description) VALUES (?, ?)'
      let queryParams = [req.body.event, req.body.description]

      await this.databaseFacade.execute(query, queryParams, 'Error logging event')
      res.status(204).end()
    }
    catch (err) {
      return this.returnApiError(res, err)
    }
  }

  async logRoute (req, res) {
    try {
      let query = 'INSERT INTO routelog (route, description, session) VALUES (?, ?, ?)'
      let queryParams = [req.body.route, req.body.description, req.sessionID]

      await this.databaseFacade.execute(query, queryParams, 'Error logging route')
      res.status(204).end()
    }
    catch (err) {
      return this.returnApiError(res, err)
    }
  }

  async getVisitorStats (req, res) {
    let interval = req.query.interval
    let query

    if (interval === 'All') {
      query = `
        SELECT COUNT(*) AS count, yr AS year, mnth AS month
        FROM (
          SELECT session, MONTH(timestamp) AS mnth, YEAR(timestamp) AS yr
          FROM routelog
          GROUP BY yr, mnth, session
          ORDER BY yr, mnth
        ) AS T1 
        GROUP BY yr, mnth ORDER BY year DESC, month DESC
      `
    }
    else if (interval === '1Y') {
      query = `
        SELECT COUNT(*) AS count, yr AS year, mnth AS month
        FROM (
          SELECT session, MONTH(timestamp) AS mnth, YEAR(timestamp) AS yr
          FROM routelog
          WHERE routelog.timestamp>DATE_SUB(now(), INTERVAL 1 YEAR)
          GROUP BY yr, mnth, session
          ORDER BY yr, mnth
        ) AS T1 
        GROUP BY yr, mnth ORDER BY year DESC, month DESC
      `
    }
    else if (interval === '1M') {
      query = `
        SELECT COUNT(*) AS count, dt AS dataKey 
        FROM (
          SELECT session, DATE(routelog.timestamp) AS dt 
          FROM routelog
          WHERE routelog.timestamp>DATE_SUB(now(), INTERVAL 1 MONTH)
          GROUP BY dt, session
          ORDER BY dt
        ) AS T1 
        GROUP BY dt ORDER BY dt DESC
      `
    }
    else if (interval === '1W') {
      query = `
        SELECT COUNT(*) AS count, dt AS dataKey 
        FROM (
          SELECT session, DATE(routelog.timestamp) AS dt 
          FROM routelog
          WHERE routelog.timestamp>DATE_SUB(now(), INTERVAL 1 WEEK)
          GROUP BY dt, session
          ORDER BY dt
        ) AS T1 
        GROUP BY dt ORDER BY dt DESC
      `
    }
    else if (interval === '24H') {
      query = `
        SELECT COUNT(*) AS count, dt AS date, hr AS hour 
        FROM (
          SELECT session, DATE(timestamp) AS dt, HOUR(routelog.timestamp) AS hr
          FROM routelog
          WHERE timestamp>DATE_SUB(now(), INTERVAL 1 DAY)
          GROUP BY dt, hr, session
          ORDER BY dt, hr
        ) AS T1 
        GROUP BY dt, hr ORDER BY dt DESC, hr DESC
      `
    }

    try {
      let results = await this.databaseFacade.execute(query, null)

      for (let result of results) {
        if (interval === '1Y' || interval === 'All') {
          result.dataKey = `${MONTH_NO_TO_STR[result.month]} ${result.year}`
          delete result.year
          delete result.month
        }
        else if (interval === '24H') {
          let resultDate = new Date(result.date)
          resultDate.setHours(result.hour)
          result.dataKey = format(resultDate, 'EEE HH:00')
        }
        else {
          // interval === '1M' || interval === '1W'
          let resultDate = new Date(result.dataKey)
          result.dataKey = format(resultDate, 'EEE d. MMM')
        }
      }

      res.json(results)
    }
    catch (err) {
      return this.returnError(err.message, res, err.error, err)
    }
  }

  async getComicViewStats (req, res) {
    let interval = req.query.interval
    let query

    if (interval === 'All') {
      query = `select COUNT(*) AS count, description AS dataKey from routelog where route='comic' GROUP BY description ORDER BY count DESC`
    }
    else {
      query = `select COUNT(*) AS count, description AS dataKey from routelog where route='comic' AND timestamp>DATE_SUB(now(), INTERVAL ${intervalToIntervalQueryString[interval]}) GROUP BY description ORDER BY count DESC`
    }

    try {
      let results = await this.databaseFacade.execute(query, null)
      res.json(results)
    }
    catch (err) {
      return this.returnError(err.message, res, err.error, err)
    }
  }

  async getRouteStats (req, res) {
    let interval = req.query.interval
    let query

    if (interval === 'All') {
      query = `select COUNT(*) AS count, route AS dataKey from routelog GROUP BY dataKey ORDER BY count DESC`
    }
    else {
      query = `select COUNT(*) AS count, route AS dataKey from routelog where timestamp>DATE_SUB(now(), INTERVAL ${intervalToIntervalQueryString[interval]}) GROUP BY route ORDER BY count DESC`
    }

    try {
      let results = await this.databaseFacade.execute(query, null)
      res.json(results)
    }
    catch (err) {
      return this.returnError(err.message, res, err.error)
    }
  }

  async createModApplication (req, res) {
    try {
      let [notes, competentAnswer, telegramUsername] = 
        [req.body.notes, req.body.competentAnswer, req.body.telegramUsername]
      let user = await this.getUser(req)

      if (!user) {
        return this.returnApiError(res, new ApiError('Not logged in', 401))
      }
      
      let existingApplicationQuery = 'SELECT * FROM modapplication WHERE UserId = ?'
      let existingApplication = await this.databaseFacade.execute(existingApplicationQuery, [user.id], 'Database error: Error listing existing applications')
      if (existingApplication.length > 0) {
        return this.returnApiError(res, new ApiError('You already have a pending application', 400))
      }

      let addApplicationQuery = 'INSERT INTO modapplication (UserId, Notes, CompetentAnswer, TelegramUsername) VALUES (?, ?, ?, ?)'
      let addApplicationQueryParams = [user.id, notes, competentAnswer, telegramUsername]
      await this.databaseFacade.execute(addApplicationQuery, addApplicationQueryParams, 'Database error: Error adding application')

      res.end()
    }
    catch (err) {
      this.returnApiError(res, err)
    }
  }

  async getModApplications (req, res) {
    let existingApplicationQuery = 'SELECT modapplication.Id AS id, user.Username AS username, Timestamp AS timestamp, Notes AS notes, CompetentAnswer AS competentAnswer, TelegramUsername AS telegramUsername, IsProcessed AS isProcessed, isRemoved AS isRemoved FROM modapplication INNER JOIN user ON (user.Id = modapplication.UserId)'

    try {
      let results = await this.databaseFacade.execute(existingApplicationQuery, null, 'Error getting mod applications')
      res.json(results)
    }
    catch (err) {
      return this.returnError(err.message, res, err.error, err)
    }
  }

  async processModApplication (req, res) {
    let [applicationId, isRemoved] = [req.params.id, req.body.isRemoved]

    let query = 'UPDATE modapplication SET IsProcessed=1, IsRemoved=? WHERE Id=?'
    let queryParams = [isRemoved ? '1' : '0', applicationId]

    try {
      await this.databaseFacade.execute(query, queryParams, 'Error processing application')
      res.json({success: true})
    }
    catch (err) {
      return this.returnError(err.message, res, err.error, err)
    }
  }

  async getMyModApplicationStatus (req, res) {
    let user = await this.getUser(req)
    if (!user) { return this.returnError('Not logged in', res, null, null) }

    let query = 'SELECT IsProcessed AS isProcessed, IsRemoved AS isRemoved FROM modapplication WHERE UserId=?'
    try {
      let result = await this.databaseFacade.execute(query, [user.id], 'Error getting mod application status')
      if (result.length === 0) {
        return res.json({ applicationStatus: MOD_APPLICATION_STATUSES.none })
      }
      if (result.length !== 1) {
        return this.returnError('Error getting mod application status - not a single application on this user-id', res, null, null)
      }
      let application = result[0]

      if (!application.isProcessed && !application.isRemoved) {
        return res.json({ applicationStatus: MOD_APPLICATION_STATUSES.pending })
      }
      else if (application.isProcessed && !application.isRemoved) {
        return res.json({ applicationStatus: MOD_APPLICATION_STATUSES.waiting })
      }
      else if (application.isRemoved) {
        return res.json({ applicationStatus: MOD_APPLICATION_STATUSES.removed })
      }
      return res.json({ applicationStatus: MOD_APPLICATION_STATUSES.none })
    }
    catch (err) {
      return this.returnError(err.message, res, err.error, err)
    }
  }

  getPageName (pageNumber) {
    return pageNumber<100 ? (pageNumber<10 ? '00'+pageNumber : '0'+pageNumber) : pageNumber
  }

  async submitFeedback (req, res) {
    try {
      let feedback = req.body.feedbackText
      let user = await this.getUser(req)
      
      let insertQuery = 'INSERT INTO feedback (Text, UserId) VALUES (?, ?)'
      await this.databaseFacade.execute(insertQuery, [feedback, user?.id], 'Error saving feedback')
      res.end()
    }
    catch (err) {
      return this.returnApiError(res, err)
    }
  }

  async getFeedback (req, res) {
    if (!this.authorizeAdmin(req, res)) {
      res.status(403).send()
    }

    let query = 'SELECT feedback.Id AS id, Text AS text, user.Username AS username, IsRead AS isRead, Timestamp AS timestamp FROM feedback LEFT JOIN user ON (user.Id = feedback.UserId) WHERE IsRemoved=0 ORDER BY feedback.Id DESC'

    try {
      let feedbacks = await this.databaseFacade.execute(query, null, 'Error fetching feedback')
      res.json(feedbacks)
    }
    catch (err) {
      return this.returnError(err.message, res, err.error, err)
    }
  }

  async deleteFeedback (req, res) {
    let feedbackId = req.params.id
    let query = 'DELETE FROM feedback WHERE Id = ?'
    
    try {
      await this.databaseFacade.execute(query, [feedbackId], 'Error deleteing feedback')
      res.json({success: true})
    }
    catch (err) {
      return this.returnError(err.message, res, err.error, err)
    }
  }

  async markFeedbackRead (req, res) {
    let feedbackId = req.params.id
    let query = 'UPDATE feedback SET IsRead=1 WHERE Id = ?'

    try {
      await this.databaseFacade.execute(query, [feedbackId], 'Error updating feedback')
      res.json({success: true})
    }
    catch (err) {
      return this.returnError(err.message, res, err.error, err)
    }
  }
}

const intervalToIntervalQueryString = {
  '24H': '1 DAY',
  '1W': '1 WEEK',
  '1M': '1 MONTH',
  '1Y': '1 YEAR',
}

const MOD_APPLICATION_STATUSES = {
  none: 'none',
  pending: 'pending',
  waiting: 'waiting',
  removed: 'removed'
}

const MONTH_NO_TO_STR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May,', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]
